"""Общая бизнес-логика и сериализация, используется кабинетом и админкой."""
import os
import re
from datetime import timedelta

from flask import request
from sqlalchemy import func, or_, update

from . import features, partner_api, telegram
from .db import db, utcnow
from .models import (
    CONVERSION_STATUSES, BalanceTx, Conversion, Invite, OfferLink, Tariff, User,
)
from .util import ApiError, iso, new_code, rub


# ---------- пользователь / тариф ----------
def user_rate(user):
    return user.tariff.rate if user.tariff else 100


def payout_for(offer, user):
    return offer.payout * user_rate(user) // 100


def public_name(user):
    return user.display_name or (("@" + user.username.lstrip("@")) if user.username else user.login.split("@")[0])


# ---------- логин ----------
LOGIN_RE = re.compile(r"^[a-z0-9_.-]{3,32}$")


def norm_login(value):
    """«@Ivan » -> «ivan». У старых аккаунтов логин — email, его не трогаем."""
    v = str(value or "").strip().lower()
    if v.startswith("@") and v.count("@") == 1:
        v = v[1:]
    return v


def login_taken(login, exclude_id=None):
    q = db.query(User.id).filter(User.login == login)
    if exclude_id:
        q = q.filter(User.id != exclude_id)
    return q.first() is not None


def clean_login(value, exclude_id=None):
    v = norm_login(value)
    if not LOGIN_RE.match(v):
        raise ApiError("Логин: от 3 до 32 символов — латинские буквы, цифры, точка, дефис или подчёркивание")
    if login_taken(v, exclude_id):
        raise ApiError("Такой логин уже занят — придумайте другой")
    return v


def suggest_login(tg_username):
    """Логин по умолчанию — username из Telegram, если он подходит и свободен."""
    v = norm_login(tg_username)
    return v if LOGIN_RE.match(v) and not login_taken(v) else ""


# ---------- приглашения ----------
def invite_usable(inv):
    return bool(inv and inv.is_active and inv.tariff
                and (not inv.max_uses or inv.uses < inv.max_uses)
                and (not inv.expires_at or inv.expires_at > utcnow()))


def get_invite(code):
    code = str(code or "").strip()
    inv = db.query(Invite).filter_by(code=code).first() if code else None
    if not invite_usable(inv):
        raise ApiError("Ссылка-приглашение недействительна или закончилась. Попросите у администратора новую", 404)
    return inv


def use_invite(user, inv):
    """Переводит пользователя на тариф приглашения и засчитывает использование ссылки."""
    res = db.execute(update(Invite)
                     .where(Invite.id == inv.id, or_(Invite.max_uses == 0, Invite.uses < Invite.max_uses))
                     .values(uses=Invite.uses + 1))
    if res.rowcount != 1:
        raise ApiError("Лимит регистраций по этой ссылке исчерпан")
    user.tariff_id = inv.tariff_id
    user.tariff_until = utcnow() + timedelta(days=inv.days) if inv.days else None
    user.invite_id = inv.id


def invite_url(inv):
    return f"{public_base()}/join/{inv.code}"


def ser_invite(inv):
    return {"id": inv.id, "code": inv.code, "url": invite_url(inv), "tariff_id": inv.tariff_id,
            "tariff": inv.tariff.name if inv.tariff else "—", "title": inv.title, "max_uses": inv.max_uses,
            "uses": inv.uses, "days": inv.days, "expires_at": iso(inv.expires_at), "is_active": inv.is_active,
            # последний день, когда ссылка работает (в базе хранится начало следующего дня)
            "expires_on": (inv.expires_at - timedelta(days=1)).date().isoformat() if inv.expires_at else "",
            "usable": invite_usable(inv), "created_at": iso(inv.created_at)}


def ser_user(u, admin=False):
    d = {
        "id": u.id, "login": u.login, "username": u.username, "display_name": u.display_name,
        "name": public_name(u), "role": u.role, "balance": rub(u.balance),
        "tariff": ser_tariff(u.tariff) if u.tariff else None, "tariff_until": iso(u.tariff_until),
        "links_access": u.links_access, "telegram_linked": bool(u.chat_id),
        "show_in_top": u.show_in_top, "notify": u.notify, "created_at": iso(u.created_at),
        "features": features.user_features(u),
        "program_id": u.tariff.program_id if u.tariff else None,
    }
    if admin:
        d.update(is_blocked=u.is_blocked, admin_note=u.admin_note, chat_id=u.chat_id, tg_id=u.tg_id, invite_id=u.invite_id)
    return d


def ser_tariff(t):
    return {"id": t.id, "code": t.code, "name": t.name, "price": rub(t.price), "period_days": t.period_days,
            "rate": t.rate, "description": t.description, "level": t.level,
            "is_default": t.is_default, "is_public": t.is_public,
            "features": features.parse(t.features), "program_id": t.program_id}


def default_tariff():
    return db.query(Tariff).filter_by(is_default=True).first()


def change_balance(user_id, amount, kind, note="", require_funds=True):
    """Атомарное изменение баланса. amount в копейках, может быть отрицательным."""
    stmt = update(User).where(User.id == user_id)
    if amount < 0 and require_funds:
        stmt = stmt.where(User.balance >= -amount)
    res = db.execute(stmt.values(balance=User.balance + amount))
    if res.rowcount != 1:
        raise ApiError("Недостаточно средств на балансе")
    db.add(BalanceTx(user_id=user_id, amount=amount, kind=kind, note=note[:300]))
    db.flush()
    db.expire_all()


# ---------- ссылки ----------
def public_base():
    # url_root учитывает подпапку (https://site.ru/secret/), host_url — нет
    return (os.environ.get("PUBLIC_URL") or request.url_root).rstrip("/")


def tracked_url(link):
    return f"{public_base()}/go/{link.code}"


def issue_link(user, offer):
    """
    Находит или создаёт персональную ссылку пользователя на оффер.
    Реальный адрес берётся из partner_api (пока заглушка); если он не получен,
    ссылка остаётся «запрошенной» и её можно заполнить вручную в админке.
    """
    link = db.query(OfferLink).filter_by(user_id=user.id, offer_id=offer.id).first()
    if not link:
        code = new_code()
        while db.query(OfferLink).filter_by(code=code).first():
            code = new_code()
        link = OfferLink(user_id=user.id, offer_id=offer.id, code=code, limit=offer.limit_default)
        db.add(link)
    if link.status == "requested":
        url = partner_api.get_offer_link(user, offer)
        if url:
            link.url, link.status = url, "active"
    db.flush()
    return link


def link_counts(link_ids):
    if not link_ids:
        return {}
    rows = (db.query(Conversion.link_id, func.count(Conversion.id))
            .filter(Conversion.link_id.in_(link_ids), Conversion.status != "rejected")
            .group_by(Conversion.link_id).all())
    return dict(rows)


def ser_link(link, used=0, clicks=None):
    d = {"id": link.id, "offer_id": link.offer_id, "offer_name": link.offer.name if link.offer else "",
         "status": link.status, "limit": link.limit, "used": used,
         "url": tracked_url(link) if link.status == "active" else "",
         "created_at": iso(link.created_at)}
    if clicks is not None:
        d["clicks"] = clicks
    return d


# ---------- заявки ----------
def ser_conversion(c, admin=False):
    d = {"id": c.id, "offer_id": c.offer_id, "offer_name": c.offer.name if c.offer else "—",
         "inn": c.inn, "fio": c.fio, "phone": c.phone, "subid": c.subid, "status": c.status,
         "status_name": CONVERSION_STATUSES.get(c.status, (c.status,))[0], "amount": rub(c.amount),
         "comment": c.comment, "source": c.source,
         "created_at": iso(c.created_at), "status_changed_at": iso(c.status_changed_at)}
    if admin:
        d["user"] = {"id": c.user.id, "login": c.user.login, "name": public_name(c.user)}
    return d


def create_conversion(user, offer, inn, fio, phone="", subid="", link=None, source="manual"):
    c = Conversion(user_id=user.id, offer_id=offer.id, link_id=link.id if link else None, inn=inn, fio=fio,
                   phone=phone, subid=subid, amount=payout_for(offer, user), source=source)
    db.add(c)
    db.flush()
    return c


def set_conversion_status(c, status, amount=None, comment=None):
    if status not in CONVERSION_STATUSES:
        raise ApiError("Неизвестный статус")
    changed = c.status != status
    c.status = status
    if amount is not None:
        c.amount = amount
    if comment is not None:
        c.comment = comment
    if changed:
        c.status_changed_at = utcnow()
        telegram.notify_user(c.user, f"Заявка #{c.id} ({c.fio or c.inn}): статус «{CONVERSION_STATUSES[status][0]}»")


def money_summary(query):
    """Суммы по группам статусов для запроса заявок."""
    sums = dict(query.with_entities(Conversion.status, func.coalesce(func.sum(Conversion.amount), 0))
                .group_by(Conversion.status).all())
    out = {"work": 0, "hold": 0, "available": 0, "paid": 0}
    for st, total in sums.items():
        grp = CONVERSION_STATUSES.get(st, (None, None))[1]
        if grp in out:
            out[grp] += total
    return {k: rub(v) for k, v in out.items()}


# ---------- топ ----------
def top_participants(me, days=None, limit=3):
    q = db.query(Conversion.user_id, func.sum(Conversion.amount).label("s")).filter(Conversion.status.in_(("hold", "approved", "paid")))
    if days:
        q = q.filter(Conversion.created_at >= utcnow() - timedelta(days=days))
    rows = q.group_by(Conversion.user_id).order_by(func.sum(Conversion.amount).desc()).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_([r[0] for r in rows[:limit]] + [me.id])).all()}
    top = []
    for i, (uid, s) in enumerate(rows[:limit], 1):
        u = users[uid]
        own = uid == me.id
        top.append({"place": i, "me": own,
                    "name": public_name(u) if (own or u.show_in_top) else f"Участник #{i}",
                    "sum": rub(s) if own else round(rub(s) / 1000) * 1000})
    mine = next(({"place": i, "sum": rub(s)} for i, (uid, s) in enumerate(rows, 1) if uid == me.id), None)
    return {"top": top, "me": mine}
