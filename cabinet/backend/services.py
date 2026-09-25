"""Общая бизнес-логика и сериализация, используется кабинетом и админкой."""
import os
from datetime import timedelta

from flask import request
from sqlalchemy import func, update

from . import features, partner_api, telegram
from .db import db, utcnow
from .models import (
    CONVERSION_STATUSES, BalanceTx, Conversion, Offer, OfferLink, Tariff, User,
)
from .util import ApiError, iso, new_code, rub


# ---------- пользователь / тариф ----------
def user_rate(user):
    return user.tariff.rate if user.tariff else 100


def payout_for(offer, user):
    return offer.payout * user_rate(user) // 100


def public_name(user):
    return user.display_name or (("@" + user.username.lstrip("@")) if user.username else user.email.split("@")[0])


def ser_user(u, admin=False):
    d = {
        "id": u.id, "email": u.email, "username": u.username, "display_name": u.display_name,
        "name": public_name(u), "role": u.role, "balance": rub(u.balance),
        "tariff": ser_tariff(u.tariff) if u.tariff else None, "tariff_until": iso(u.tariff_until),
        "links_access": u.links_access, "telegram_linked": bool(u.chat_id),
        "show_in_top": u.show_in_top, "notify": u.notify, "created_at": iso(u.created_at),
        "features": features.user_features(u),
        "program_id": u.tariff.program_id if u.tariff else None,
    }
    if admin:
        d.update(is_blocked=u.is_blocked, admin_note=u.admin_note, chat_id=u.chat_id)
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
    return (os.environ.get("PUBLIC_URL") or request.host_url).rstrip("/")


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
        d["user"] = {"id": c.user.id, "email": c.user.email, "name": public_name(c.user)}
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
