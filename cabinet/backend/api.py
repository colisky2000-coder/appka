"""API личного кабинета: /api/..."""
import csv
import io
from datetime import timedelta

from flask import Blueprint, Response, g, make_response, request, send_file
from sqlalchemy import func, or_

from . import settings, telegram
from .auth import (
    COOKIE, admin_required, check_password, check_rate, client_ip, hash_password, login_required,
    reset_rate, set_cookie, start_session, validate_password,
)
from .db import db, utcnow
from .models import (
    CONVERSION_STATUSES, Article, BalanceTx, Click, Conversion, Favorite, Material, News, NewsRead,
    Offer, OfferLink, Purchase, Tariff, TeamMember, Ticket, TicketMessage, TopUpRequest, TrafficRow,
    User, UserSession,
)
from .services import (
    change_balance, create_conversion, default_tariff, issue_link, link_counts, money_summary,
    payout_for, ser_conversion, ser_link, ser_tariff, ser_user, top_participants,
)
from .util import ApiError, clean_email, clean_inn, clean_str, iso, new_code, ok, parse_date, rub, to_kop

bp = Blueprint("api", __name__, url_prefix="/api")


def body():
    return request.get_json(silent=True) or {}


def section(name):
    if not settings.get_bool(f"section_{name}") and not (g.user and g.user.is_admin):
        raise ApiError("Раздел отключён администратором", 404)


# ================= auth =================
@bp.get("/config")
def config():
    return ok({"settings": settings.public_view(), "me": ser_user(g.user) if g.user else None,
               "statuses": {k: v[0] for k, v in CONVERSION_STATUSES.items()},
               "telegram_bot": telegram.bot_username() if telegram.enabled() else ""})


@bp.post("/auth/register")
def register():
    if not settings.get_bool("allow_registration"):
        raise ApiError("Регистрация закрыта. Обратитесь к администратору", 403)
    check_rate("reg:" + client_ip())
    d = body()
    email = clean_email(d.get("email"))
    validate_password(d.get("password"))
    if db.query(User).filter_by(email=email).first():
        raise ApiError("Пользователь с таким email уже есть")
    t = default_tariff()
    u = User(email=email, password_hash=hash_password(d["password"]),
             username=clean_str(d.get("username"), "Telegram", 64).lstrip("@"),
             tariff_id=t.id if t else None, links_access=settings.get_bool("default_links_access"))
    db.add(u)
    db.flush()
    token = start_session(u)
    db.commit()
    return set_cookie(make_response(ok(ser_user(u))), token)


@bp.post("/auth/login")
def login():
    d = body()
    key = "login:" + client_ip()
    check_rate(key)
    email = str(d.get("email") or "").strip().lower()
    u = db.query(User).filter_by(email=email).first()
    if not u or not check_password(u, d.get("password") or ""):
        raise ApiError("Неверный email или пароль", 401)
    if u.is_blocked:
        raise ApiError("Аккаунт заблокирован", 403)
    reset_rate(key)
    token = start_session(u)
    db.commit()
    return set_cookie(make_response(ok(ser_user(u))), token)


@bp.post("/auth/logout")
def logout():
    if g.session:
        g.session.revoked = True
        db.commit()
    resp = make_response(ok())
    resp.delete_cookie(COOKIE, path="/")
    return resp


@bp.post("/auth/password")
@login_required
def change_password():
    d = body()
    if not check_password(g.user, d.get("current") or ""):
        raise ApiError("Текущий пароль указан неверно")
    validate_password(d.get("password"))
    g.user.password_hash = hash_password(d["password"])
    # Завершаем все остальные сессии
    db.query(UserSession).filter(UserSession.user_id == g.user.id, UserSession.id != g.session.id).update({"revoked": True})
    db.commit()
    return ok()


# ================= профиль =================
@bp.get("/me")
@login_required
def me():
    return ok(ser_user(g.user))


@bp.patch("/me")
@login_required
def update_me():
    d, u = body(), g.user
    if "display_name" in d:
        u.display_name = clean_str(d["display_name"], "Отображаемое имя", 120)
    if "username" in d:
        u.username = clean_str(d["username"], "Telegram", 64).lstrip("@")
    for f in ("show_in_top", "notify"):
        if f in d:
            setattr(u, f, bool(d[f]))
    db.commit()
    return ok(ser_user(u))


@bp.get("/me/sessions")
@login_required
def sessions():
    rows = (db.query(UserSession).filter_by(user_id=g.user.id, revoked=False)
            .filter(UserSession.last_active >= utcnow() - timedelta(days=30))
            .order_by(UserSession.last_active.desc()).all())
    return ok([{"id": s.id, "user_agent": s.user_agent, "ip": s.ip, "last_active": iso(s.last_active),
                "current": s.id == g.session.id} for s in rows])


@bp.delete("/me/sessions/<int:sid>")
@login_required
def revoke_session(sid):
    s = db.query(UserSession).filter_by(id=sid, user_id=g.user.id).first()
    if not s:
        raise ApiError("Сессия не найдена", 404)
    s.revoked = True
    db.commit()
    return ok()


@bp.post("/me/sessions/revoke-others")
@login_required
def revoke_others():
    db.query(UserSession).filter(UserSession.user_id == g.user.id, UserSession.id != g.session.id).update({"revoked": True})
    db.commit()
    return ok()


@bp.post("/me/telegram")
@login_required
def telegram_link():
    if not telegram.enabled() or not telegram.bot_username():
        raise ApiError("Telegram-бот не настроен администратором")
    g.user.tg_link_code = new_code(16)
    db.commit()
    return ok({"url": f"https://t.me/{telegram.bot_username()}?start={g.user.tg_link_code}"})


@bp.delete("/me/telegram")
@login_required
def telegram_unlink():
    g.user.chat_id = ""
    db.commit()
    return ok()


# ================= главная / новости =================
@bp.get("/dashboard")
@login_required
def dashboard():
    u = g.user
    since = utcnow() - timedelta(days=30)
    clicks30 = (db.query(func.count(Click.id)).join(OfferLink, OfferLink.id == Click.link_id)
                .filter(OfferLink.user_id == u.id, Click.created_at >= since).scalar())
    conv_q = db.query(Conversion).filter(Conversion.user_id == u.id)
    team = db.query(TeamMember).order_by(TeamMember.sort, TeamMember.id).all()
    return ok({
        "top30": top_participants(u, days=30),
        "top_all": top_participants(u),
        "team": [{"id": t.id, "name": t.name, "role": t.role,
                  "links": [x.strip() for x in t.links.splitlines() if x.strip()]} for t in team],
        "stats": {
            "offers": db.query(func.count(Offer.id)).filter_by(is_active=True).scalar(),
            "conversions30": conv_q.filter(Conversion.created_at >= since, Conversion.status != "rejected").count(),
            "clicks30": clicks30,
            "conversions_total": conv_q.count(),
        },
        "unread": unread_count(u),
    })


def unread_count(u):
    read = db.query(NewsRead.news_id).filter_by(user_id=u.id)
    return db.query(func.count(News.id)).filter(~News.id.in_(read), News.created_at >= u.created_at - timedelta(days=90)).scalar()


@bp.get("/news")
@login_required
def news_list():
    read = {r[0] for r in db.query(NewsRead.news_id).filter_by(user_id=g.user.id)}
    items = db.query(News).order_by(News.created_at.desc()).limit(50).all()
    return ok([{"id": n.id, "title": n.title, "body": n.body, "created_at": iso(n.created_at), "read": n.id in read} for n in items])


@bp.post("/news/<int:nid>/read")
@login_required
def news_read(nid):
    if db.get(News, nid) and not db.get(NewsRead, (g.user.id, nid)):
        db.add(NewsRead(user_id=g.user.id, news_id=nid))
        db.commit()
    return ok()


@bp.post("/news/read-all")
@login_required
def news_read_all():
    read = {r[0] for r in db.query(NewsRead.news_id).filter_by(user_id=g.user.id)}
    for (nid,) in db.query(News.id).all():
        if nid not in read:
            db.add(NewsRead(user_id=g.user.id, news_id=nid))
    db.commit()
    return ok()


# ================= база знаний =================
def visible_articles():
    level = g.user.tariff.level if g.user.tariff else 0
    q = db.query(Article).outerjoin(Tariff, Tariff.id == Article.min_tariff_id)
    if not g.user.is_admin:
        q = q.filter(Article.is_published.is_(True), or_(Article.min_tariff_id.is_(None), Tariff.level <= level))
    return q


@bp.get("/articles")
@login_required
def articles():
    section("manuals")
    items = visible_articles().order_by(Article.sort, Article.created_at.desc()).all()
    return ok([{"id": a.id, "title": a.title, "description": a.description, "category": a.category,
                "url": a.url, "created_at": iso(a.created_at)} for a in items])


@bp.get("/articles/<int:aid>")
@login_required
def article(aid):
    section("manuals")
    a = visible_articles().filter(Article.id == aid).first()
    if not a:
        raise ApiError("Статья не найдена", 404)
    return ok({"id": a.id, "title": a.title, "description": a.description, "category": a.category,
               "body": a.body, "url": a.url, "created_at": iso(a.created_at)})


@bp.get("/materials")
@login_required
def materials():
    section("manuals")
    items = db.query(Material).order_by(Material.sort, Material.created_at.desc()).all()
    return ok([{"id": m.id, "title": m.title, "description": m.description, "url": m.url,
                "filename": m.filename, "size": m.size, "created_at": iso(m.created_at)} for m in items])


@bp.get("/materials/<int:mid>/download")
@login_required
def material_download(mid):
    section("manuals")
    m = db.get(Material, mid)
    if not m or not m.filename:
        raise ApiError("Файл не найден", 404)
    return send_file(io.BytesIO(m.data or b""), mimetype=m.mime or "application/octet-stream",
                     as_attachment=True, download_name=m.filename)


# ================= партнёрка =================
@bp.get("/offers")
@login_required
def offers():
    section("partner")
    u = g.user
    items = db.query(Offer).filter_by(is_active=True).order_by(Offer.sort, Offer.id).all()
    favs = {f.offer_id for f in db.query(Favorite).filter_by(user_id=u.id)}
    links = {l.offer_id: l for l in db.query(OfferLink).filter_by(user_id=u.id)}
    counts = link_counts([l.id for l in links.values()])
    out = []
    for o in items:
        l = links.get(o.id)
        out.append({"id": o.id, "partner": o.partner, "name": o.name, "type": o.type,
                    "payout": rub(payout_for(o, u)), "tax_note": o.tax_note, "description": o.description,
                    "favorite": o.id in favs,
                    "link": ser_link(l, counts.get(l.id, 0)) if l else None})
    return ok({"offers": out, "links_access": u.links_access})


def get_offer(oid):
    o = db.get(Offer, oid)
    if not o or not o.is_active:
        raise ApiError("Оффер не найден", 404)
    return o


@bp.post("/offers/<int:oid>/favorite")
@login_required
def toggle_favorite(oid):
    get_offer(oid)
    f = db.get(Favorite, (g.user.id, oid))
    if f:
        db.delete(f)
    else:
        db.add(Favorite(user_id=g.user.id, offer_id=oid))
    db.commit()
    return ok({"favorite": not f})


@bp.post("/offers/<int:oid>/link")
@login_required
def get_link(oid):
    section("partner")
    if not g.user.links_access:
        raise ApiError("Доступ к ссылкам ещё не открыт — отправьте заявку на доступ", 403)
    link = issue_link(g.user, get_offer(oid))
    db.commit()
    return ok(ser_link(link, link_counts([link.id]).get(link.id, 0)))


@bp.patch("/links/<int:lid>")
@login_required
def update_link(lid):
    link = db.query(OfferLink).filter_by(id=lid, user_id=g.user.id).first()
    if not link:
        raise ApiError("Ссылка не найдена", 404)
    d = body()
    if "form_enabled" in d:
        if link.status != "active":
            raise ApiError("Ссылка ещё не активна")
        link.form_enabled = bool(d["form_enabled"])
    db.commit()
    return ok(ser_link(link, link_counts([link.id]).get(link.id, 0)))


@bp.get("/links")
@login_required
def my_links():
    links = db.query(OfferLink).filter_by(user_id=g.user.id).order_by(OfferLink.created_at.desc()).all()
    ids = [l.id for l in links]
    clicks = dict(db.query(Click.link_id, func.count(Click.id)).filter(Click.link_id.in_(ids)).group_by(Click.link_id).all()) if ids else {}
    counts = link_counts(ids)
    return ok([ser_link(l, counts.get(l.id, 0), clicks.get(l.id, 0)) for l in links])


@bp.post("/access-request")
@login_required
def access_request():
    if g.user.links_access:
        return ok({"already": True})
    exists = db.query(Ticket).filter_by(user_id=g.user.id, topic="access").filter(Ticket.status != "closed").first()
    if not exists:
        t = Ticket(user_id=g.user.id, subject="Заявка на доступ к ссылкам", topic="access")
        t.messages.append(TicketMessage(body=clean_str(body().get("message"), "Сообщение", 2000) or "Прошу открыть доступ к ссылкам."))
        db.add(t)
        db.commit()
    return ok({"requested": True})


# ================= заявки (конверсии) =================
def conversions_query(args, user_id=None):
    q = db.query(Conversion)
    if user_id:
        q = q.filter(Conversion.user_id == user_id)
    if args.get("status"):
        q = q.filter(Conversion.status == args["status"])
    if args.get("offer"):
        q = q.filter(Conversion.offer_id == int(args["offer"]))
    if args.get("subid"):
        q = q.filter(Conversion.subid == args["subid"])
    if args.get("from"):
        q = q.filter(Conversion.created_at >= parse_date(args["from"]))
    if args.get("to"):
        q = q.filter(Conversion.created_at < parse_date(args["to"]) + timedelta(days=1))
    if args.get("q"):
        s = f"%{args['q'].strip()}%"
        q = q.filter(or_(Conversion.inn.ilike(s), Conversion.fio.ilike(s), Conversion.phone.ilike(s)))
    return q


@bp.get("/conversions")
@login_required
def conversions():
    q = conversions_query(request.args, g.user.id).order_by(Conversion.created_at.desc())
    return ok([ser_conversion(c) for c in q.limit(500).all()])


@bp.post("/conversions")
@login_required
def create_conv():
    d = body()
    offer = get_offer(int(d.get("offer_id") or 0))
    link = db.query(OfferLink).filter_by(user_id=g.user.id, offer_id=offer.id).first()
    c = create_conversion(g.user, offer, clean_inn(d.get("inn")), clean_str(d.get("fio"), "ФИО", 200, True),
                          clean_str(d.get("phone"), "Телефон", 40), clean_str(d.get("subid"), "Субметка", 80), link)
    db.commit()
    return ok(ser_conversion(c))


# ================= статистика =================
def stats_data(args, user):
    start = parse_date(args.get("from")) or (utcnow() - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
    end = (parse_date(args.get("to")) or utcnow()).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    group = args.get("group", "day")
    offer_id = int(args["offer"]) if args.get("offer") else None
    subid = args.get("subid") or ""

    cq = (db.query(Click).join(OfferLink, OfferLink.id == Click.link_id)
          .filter(OfferLink.user_id == user.id, Click.created_at >= start, Click.created_at < end))
    if offer_id:
        cq = cq.filter(OfferLink.offer_id == offer_id)
    if subid:
        cq = cq.filter(Click.subid == subid)
    if args.get("unique") in ("1", "true"):
        cq = cq.filter(Click.is_unique.is_(True))

    vq = conversions_query({**args, "from": start.date().isoformat(), "to": (end - timedelta(days=1)).date().isoformat()}, user.id)

    if group == "offer":
        ck, vk = OfferLink.offer_id, Conversion.offer_id
    elif group == "subid":
        ck, vk = Click.subid, Conversion.subid
    else:
        ck, vk = func.date(Click.created_at), func.date(Conversion.created_at)

    rows = {}
    for key, n in cq.with_entities(ck, func.count(Click.id)).group_by(ck).all():
        rows.setdefault(str(key), {"clicks": 0, "conversions": 0, "amount": 0})["clicks"] = n
    for key, n, s in vq.with_entities(vk, func.count(Conversion.id), func.coalesce(func.sum(Conversion.amount), 0)).group_by(vk).all():
        r = rows.setdefault(str(key), {"clicks": 0, "conversions": 0, "amount": 0})
        r["conversions"], r["amount"] = n, rub(s)

    if group == "offer":
        names = {o.id: o.name for o in db.query(Offer).all()}
        label = lambda k: names.get(int(k), "—") if k not in ("None", "") else "—"
    elif group == "subid":
        label = lambda k: k or "(без метки)"
    else:
        label = lambda k: k
    table = [{"key": label(k), **v} for k, v in sorted(rows.items(), reverse=(group == "day"))]

    total_clicks = cq.count()
    total_conv = vq.filter(Conversion.status != "rejected").count()
    approved = vq.filter(Conversion.status.in_(("approved", "paid", "hold"))).count()
    return {
        "rows": table,
        "totals": {"clicks": total_clicks, "conversions": total_conv,
                   "cr": round(total_conv / total_clicks * 100, 2) if total_clicks else 0,
                   "ar": round(approved / total_conv * 100, 2) if total_conv else 0,
                   **money_summary(vq)},
        "subids": sorted({s for (s,) in db.query(Conversion.subid).filter(Conversion.user_id == user.id).distinct() if s}
                         | {s for (s,) in db.query(Click.subid).join(OfferLink, OfferLink.id == Click.link_id)
                            .filter(OfferLink.user_id == user.id).distinct() if s}),
    }


@bp.get("/stats")
@login_required
def stats():
    section("partner")
    return ok(stats_data(request.args, g.user))


@bp.get("/stats.csv")
@login_required
def stats_csv():
    section("partner")
    data = stats_data(request.args, g.user)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Группа", "Переходы", "Заявки", "Сумма, ₽"])
    for r in data["rows"]:
        w.writerow([r["key"], r["clicks"], r["conversions"], str(r["amount"]).replace(".", ",")])
    return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=stats.csv"})


@bp.get("/income")
@login_required
def income():
    q = db.query(Conversion).filter(Conversion.user_id == g.user.id)
    recent = q.filter(Conversion.status.in_(("hold", "approved", "paid"))).order_by(Conversion.status_changed_at.desc()).limit(100).all()
    tx = db.query(BalanceTx).filter_by(user_id=g.user.id).order_by(BalanceTx.created_at.desc()).limit(100).all()
    return ok({"summary": money_summary(q), "balance": rub(g.user.balance),
               "conversions": [ser_conversion(c) for c in recent],
               "transactions": [{"amount": rub(t.amount), "kind": t.kind, "note": t.note, "created_at": iso(t.created_at)} for t in tx]})


# ================= трафик / баланс =================
def traffic_price():
    return to_kop(settings.get("traffic_price"))


@bp.get("/traffic")
@login_required
def traffic():
    section("traffic")
    purchases = db.query(Purchase).filter_by(user_id=g.user.id).order_by(Purchase.created_at.desc()).all()
    topups = db.query(TopUpRequest).filter_by(user_id=g.user.id).order_by(TopUpRequest.created_at.desc()).limit(20).all()
    return ok({
        "balance": rub(g.user.balance), "price": rub(traffic_price()),
        "available": db.query(func.count(TrafficRow.id)).filter(TrafficRow.purchase_id.is_(None)).scalar(),
        "format": settings.get("traffic_format"), "topup_instructions": settings.get("topup_instructions"),
        "bought_rows": sum(p.rows for p in purchases), "spent": rub(sum(p.total for p in purchases)),
        "purchases": [{"id": p.id, "rows": p.rows, "total": rub(p.total), "created_at": iso(p.created_at)} for p in purchases],
        "topups": [{"id": t.id, "amount": rub(t.amount), "status": t.status, "admin_note": t.admin_note,
                    "created_at": iso(t.created_at)} for t in topups],
    })


@bp.post("/traffic/buy")
@login_required
def traffic_buy():
    section("traffic")
    try:
        n = int(body().get("rows"))
    except (TypeError, ValueError):
        raise ApiError("Укажите количество строк")
    if n < 1 or n > 100000:
        raise ApiError("Некорректное количество строк")
    price = traffic_price()
    rows = (db.query(TrafficRow).filter(TrafficRow.purchase_id.is_(None)).order_by(TrafficRow.id)
            .limit(n).with_for_update(skip_locked=True).all())
    if len(rows) < n:
        raise ApiError(f"Столько строк нет в наличии: свободно {len(rows)}")
    total = price * n
    change_balance(g.user.id, -total, "purchase", f"Покупка {n} строк трафика")
    p = Purchase(user_id=g.user.id, rows=n, price=price, total=total)
    db.add(p)
    db.flush()
    for r in rows:
        r.purchase_id = p.id
    db.commit()
    return ok({"id": p.id})


@bp.get("/traffic/purchases/<int:pid>/download")
@login_required
def purchase_download(pid):
    p = db.query(Purchase).filter_by(id=pid, user_id=g.user.id).first()
    if not p and g.user.is_admin:
        p = db.get(Purchase, pid)
    if not p:
        raise ApiError("Покупка не найдена", 404)
    lines = [r.data for r in db.query(TrafficRow).filter_by(purchase_id=p.id).order_by(TrafficRow.id)]
    return Response("\n".join(lines) + "\n", mimetype="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename=traffic_{p.id}.txt"})


@bp.post("/topups")
@login_required
def topup_request():
    d = body()
    amount = to_kop(d.get("amount"))
    if amount < 100:
        raise ApiError("Минимальная сумма — 1 ₽")
    if db.query(TopUpRequest).filter_by(user_id=g.user.id, status="pending").count() >= 5:
        raise ApiError("У вас уже есть необработанные заявки на пополнение")
    db.add(TopUpRequest(user_id=g.user.id, amount=amount, note=clean_str(d.get("note"), "Комментарий", 300)))
    db.commit()
    return ok()


# ================= тарифы =================
@bp.get("/tariffs")
@login_required
def tariffs():
    section("billing")
    items = db.query(Tariff).filter_by(is_public=True).order_by(Tariff.level, Tariff.id).all()
    return ok({"tariffs": [ser_tariff(t) for t in items], "current": g.user.tariff_id,
               "until": iso(g.user.tariff_until), "balance": rub(g.user.balance)})


@bp.post("/tariffs/<int:tid>/buy")
@login_required
def tariff_buy(tid):
    section("billing")
    t = db.get(Tariff, tid)
    if not t or not t.is_public:
        raise ApiError("Тариф не найден", 404)
    u = g.user
    if t.price <= 0:
        u.tariff_id, u.tariff_until = t.id, None
        db.commit()
        return ok(ser_user(u))
    change_balance(u.id, -t.price, "tariff", f"Тариф {t.name} на {t.period_days} дн.")
    start = u.tariff_until if (u.tariff_id == t.id and u.tariff_until and u.tariff_until > utcnow()) else utcnow()
    u.tariff_id, u.tariff_until = t.id, start + timedelta(days=t.period_days)
    db.commit()
    return ok(ser_user(u))


# ================= поддержка =================
def ser_ticket(t, messages=False, admin=False):
    d = {"id": t.id, "subject": t.subject, "topic": t.topic, "conversion_id": t.conversion_id, "status": t.status,
         "created_at": iso(t.created_at), "updated_at": iso(t.updated_at)}
    if messages:
        d["messages"] = [{"id": m.id, "is_admin": m.is_admin, "body": m.body, "created_at": iso(m.created_at)} for m in t.messages]
    if admin:
        d["user"] = {"id": t.user.id, "email": t.user.email, "name": t.user.display_name or t.user.username}
    return d


@bp.get("/tickets")
@login_required
def tickets():
    q = db.query(Ticket).filter_by(user_id=g.user.id)
    if request.args.get("topic"):
        q = q.filter_by(topic=request.args["topic"])
    return ok([ser_ticket(t) for t in q.order_by(Ticket.updated_at.desc()).all()])


@bp.post("/tickets")
@login_required
def ticket_create():
    d = body()
    topic = d.get("topic") if d.get("topic") in ("general", "conversion") else "general"
    conv_id = None
    if d.get("conversion_id"):
        c = db.query(Conversion).filter_by(id=int(d["conversion_id"]), user_id=g.user.id).first()
        if not c:
            raise ApiError("Заявка не найдена")
        conv_id = c.id
    t = Ticket(user_id=g.user.id, subject=clean_str(d.get("subject"), "Тема", 200, True), topic=topic, conversion_id=conv_id)
    t.messages.append(TicketMessage(body=clean_str(d.get("body"), "Сообщение", 5000, True)))
    db.add(t)
    db.commit()
    return ok(ser_ticket(t))


def own_ticket(tid):
    t = db.query(Ticket).filter_by(id=tid, user_id=g.user.id).first()
    if not t:
        raise ApiError("Обращение не найдено", 404)
    return t


@bp.get("/tickets/<int:tid>")
@login_required
def ticket_get(tid):
    return ok(ser_ticket(own_ticket(tid), messages=True))


@bp.post("/tickets/<int:tid>/messages")
@login_required
def ticket_reply(tid):
    t = own_ticket(tid)
    t.messages.append(TicketMessage(body=clean_str(body().get("body"), "Сообщение", 5000, True)))
    t.status, t.updated_at = "open", utcnow()
    db.commit()
    return ok(ser_ticket(t, messages=True))


@bp.post("/tickets/<int:tid>/close")
@login_required
def ticket_close(tid):
    t = own_ticket(tid)
    t.status, t.updated_at = "closed", utcnow()
    db.commit()
    return ok()
