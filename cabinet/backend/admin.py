"""API админки: /api/admin/..."""
import csv
import io
import os
import secrets
from datetime import timedelta

from flask import Blueprint, Response, g, request
from sqlalchemy import func, or_

from . import partner_api, settings, telegram
from .api import conversions_query, ser_ticket
from .auth import admin_required, hash_password, validate_password
from .db import db, utcnow
from .models import (
    Article, Click, Conversion, Material, News, Offer, OfferLink, Purchase, Setting, Tariff, TeamMember,
    Ticket, TicketMessage, TopUpRequest, TrafficRow, User, UserSession,
)
from .services import (
    change_balance, create_conversion, ser_conversion, ser_link, ser_tariff, ser_user,
    set_conversion_status, link_counts,
)
from .util import ApiError, clean_email, clean_inn, clean_str, clean_url, iso, ok, parse_date, rub, to_kop

bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@bp.before_request
@admin_required
def _guard():
    pass


def body():
    return request.get_json(silent=True) or {}


def paginate(q, default=50):
    page = max(1, request.args.get("page", 1, type=int))
    per = min(500, max(1, request.args.get("per", default, type=int)))
    total = q.order_by(None).count()
    return q.offset((page - 1) * per).limit(per).all(), {"page": page, "per": per, "total": total}


# ================= обзор =================
@bp.get("/overview")
def overview():
    return ok({
        "users": db.query(func.count(User.id)).scalar(),
        "new_users_7d": db.query(func.count(User.id)).filter(User.created_at >= utcnow() - timedelta(days=7)).scalar(),
        "topups_pending": db.query(func.count(TopUpRequest.id)).filter_by(status="pending").scalar(),
        "tickets_open": db.query(func.count(Ticket.id)).filter_by(status="open").scalar(),
        "links_requested": db.query(func.count(OfferLink.id)).filter_by(status="requested").scalar(),
        "conversions_new": db.query(func.count(Conversion.id)).filter(Conversion.status.in_(("new", "in_work"))).scalar(),
        "traffic_available": db.query(func.count(TrafficRow.id)).filter(TrafficRow.purchase_id.is_(None)).scalar(),
        "offers_active": db.query(func.count(Offer.id)).filter_by(is_active=True).scalar(),
        "partner_api": partner_api.is_configured(),
        "telegram": telegram.enabled(),
    })


# ================= пользователи =================
@bp.get("/users")
def users():
    q = db.query(User)
    s = (request.args.get("q") or "").strip()
    if s:
        like = f"%{s}%"
        q = q.filter(or_(User.email.ilike(like), User.username.ilike(like), User.display_name.ilike(like)))
    if request.args.get("role"):
        q = q.filter(User.role == request.args["role"])
    items, meta = paginate(q.order_by(User.created_at.desc()))
    return ok([ser_user(u, admin=True) for u in items], meta=meta)


def get_user(uid):
    u = db.get(User, uid)
    if not u:
        raise ApiError("Пользователь не найден", 404)
    return u


@bp.post("/users")
def user_create():
    d = body()
    email = clean_email(d.get("email"))
    validate_password(d.get("password"))
    if db.query(User).filter_by(email=email).first():
        raise ApiError("Такой email уже зарегистрирован")
    tariff = db.query(Tariff).filter_by(is_default=True).first()
    u = User(email=email, password_hash=hash_password(d["password"]),
             username=clean_str(d.get("username"), "Telegram", 64).lstrip("@"),
             role="admin" if d.get("role") == "admin" else "user",
             tariff_id=tariff.id if tariff else None, links_access=bool(d.get("links_access")))
    db.add(u)
    db.commit()
    return ok(ser_user(u, admin=True))


@bp.get("/users/<int:uid>")
def user_detail(uid):
    u = get_user(uid)
    conv = db.query(Conversion).filter_by(user_id=uid)
    sessions = db.query(UserSession).filter_by(user_id=uid, revoked=False).order_by(UserSession.last_active.desc()).limit(10).all()
    return ok({**ser_user(u, admin=True),
               "conversions": conv.count(),
               "links": db.query(func.count(OfferLink.id)).filter_by(user_id=uid).scalar(),
               "purchases": db.query(func.count(Purchase.id)).filter_by(user_id=uid).scalar(),
               "sessions": [{"id": s.id, "ip": s.ip, "user_agent": s.user_agent, "last_active": iso(s.last_active)} for s in sessions]})


@bp.patch("/users/<int:uid>")
def user_update(uid):
    u, d = get_user(uid), body()
    if "email" in d:
        email = clean_email(d["email"])
        if email != u.email and db.query(User).filter_by(email=email).first():
            raise ApiError("Такой email уже зарегистрирован")
        u.email = email
    if "username" in d:
        u.username = clean_str(d["username"], "Telegram", 64).lstrip("@")
    if "display_name" in d:
        u.display_name = clean_str(d["display_name"], "Имя", 120)
    if "admin_note" in d:
        u.admin_note = clean_str(d["admin_note"], "Заметка", 2000)
    if "role" in d:
        if u.id == g.user.id and d["role"] != "admin":
            raise ApiError("Нельзя снять права администратора с самого себя")
        u.role = "admin" if d["role"] == "admin" else "user"
    if "is_blocked" in d:
        if u.id == g.user.id and d["is_blocked"]:
            raise ApiError("Нельзя заблокировать самого себя")
        u.is_blocked = bool(d["is_blocked"])
        if u.is_blocked:
            db.query(UserSession).filter_by(user_id=u.id).update({"revoked": True})
    if "links_access" in d:
        if d["links_access"] and not u.links_access:
            telegram.notify_user(u, "Вам открыт доступ к ссылкам на офферы.")
            for t in db.query(Ticket).filter_by(user_id=u.id, topic="access").filter(Ticket.status != "closed"):
                t.status = "closed"
        u.links_access = bool(d["links_access"])
    if "tariff_id" in d:
        if d["tariff_id"] and not db.get(Tariff, int(d["tariff_id"])):
            raise ApiError("Тариф не найден")
        u.tariff_id = int(d["tariff_id"]) if d["tariff_id"] else None
    if "tariff_until" in d:
        u.tariff_until = parse_date(d["tariff_until"], "Тариф до")
    db.commit()
    return ok(ser_user(u, admin=True))


@bp.post("/users/<int:uid>/balance")
def user_balance(uid):
    u, d = get_user(uid), body()
    amount = to_kop(d.get("amount"), allow_negative=True)
    if not amount:
        raise ApiError("Сумма не может быть нулевой")
    change_balance(u.id, amount, "adjust", clean_str(d.get("note"), "Комментарий", 300) or "Корректировка администратором",
                   require_funds=False)
    db.commit()
    return ok(ser_user(db.get(User, uid), admin=True))


@bp.post("/users/<int:uid>/password")
def user_password(uid):
    u, d = get_user(uid), body()
    validate_password(d.get("password"))
    u.password_hash = hash_password(d["password"])
    db.query(UserSession).filter_by(user_id=u.id).update({"revoked": True})
    db.commit()
    return ok()


@bp.delete("/users/<int:uid>")
def user_delete(uid):
    u = get_user(uid)
    if u.id == g.user.id:
        raise ApiError("Нельзя удалить самого себя")
    db.delete(u)
    db.commit()
    return ok()


# ================= универсальный CRUD =================
# поле: (имя, тип, подпись, обязательное)
RESOURCES = {
    "offers": (Offer, [
        ("partner", "str", "Партнёр", True), ("name", "str", "Название", True), ("type", "str", "Тип", False),
        ("payout", "money", "Базовая выплата, ₽", False), ("tax_note", "str", "Метка налога", False),
        ("description", "text", "Описание и целевое действие", False),
        ("external_id", "str", "ID во внешней системе", False),
        ("limit_default", "int", "Лимит заявок на ссылку (0 — нет)", False),
        ("is_active", "bool", "Опубликован", False), ("sort", "int", "Порядок", False),
    ], (Offer.sort, Offer.id)),
    "articles": (Article, [
        ("title", "str", "Заголовок", True), ("description", "str", "Краткое описание", False),
        ("category", "str", "Категория", False), ("body", "text", "Текст статьи", False),
        ("url", "url", "Внешняя ссылка (вместо текста)", False),
        ("min_tariff_id", "tariff", "Минимальный тариф", False),
        ("is_published", "bool", "Опубликована", False), ("sort", "int", "Порядок", False),
    ], (Article.sort, Article.created_at.desc())),
    "news": (News, [
        ("title", "str", "Заголовок", True), ("body", "text", "Текст", True),
    ], (News.created_at.desc(),)),
    "team": (TeamMember, [
        ("name", "str", "Имя", True), ("role", "str", "Роль", False),
        ("links", "text", "Ссылки / контакты (по одной на строку)", False), ("sort", "int", "Порядок", False),
    ], (TeamMember.sort, TeamMember.id)),
    "tariffs": (Tariff, [
        ("code", "str", "Код (латиницей)", True), ("name", "str", "Название", True),
        ("price", "money", "Цена, ₽", False), ("period_days", "int", "Срок, дней", False),
        ("rate", "int", "Ставка, % от базовой выплаты", False), ("level", "int", "Уровень доступа", False),
        ("description", "text", "Описание", False),
        ("is_default", "bool", "Тариф по умолчанию", False), ("is_public", "bool", "Доступен для покупки", False),
    ], (Tariff.level, Tariff.id)),
}


def res_config(name):
    if name not in RESOURCES:
        raise ApiError("Неизвестный раздел", 404)
    return RESOURCES[name]


def ser_generic(obj, fields):
    d = {"id": obj.id}
    for name, typ, *_ in fields:
        v = getattr(obj, name)
        d[name] = rub(v) if typ == "money" else v
    if hasattr(obj, "created_at"):
        d["created_at"] = iso(obj.created_at)
    return d


def apply_fields(obj, fields, data, creating):
    for name, typ, label, required in fields:
        if name not in data:
            if creating and required:
                raise ApiError(f"Заполните поле «{label}»")
            continue
        v = data[name]
        if typ == "str":
            v = clean_str(v, label, 300, required)
        elif typ == "text":
            v = clean_str(v, label, 50000, required)
        elif typ == "url":
            v = clean_url(v, label, required)
        elif typ == "money":
            v = to_kop(v or 0, label)
        elif typ == "int":
            try:
                v = int(v or 0)
            except (TypeError, ValueError):
                raise ApiError(f"«{label}»: введите целое число")
        elif typ == "bool":
            v = bool(v)
        elif typ == "tariff":
            v = int(v) if v else None
            if v and not db.get(Tariff, v):
                raise ApiError("Тариф не найден")
        setattr(obj, name, v)


@bp.get("/schema")
def schema():
    return ok({name: [{"name": f[0], "type": f[1], "label": f[2], "required": f[3]} for f in cfg[1]]
               for name, cfg in RESOURCES.items()})


@bp.get("/r/<name>")
def res_list(name):
    model, fields, order = res_config(name)
    return ok([ser_generic(o, fields) for o in db.query(model).order_by(*order).all()])


@bp.post("/r/<name>")
def res_create(name):
    model, fields, _ = res_config(name)
    obj = model()
    for name_, typ, *_ in fields:  # значения по умолчанию для bool
        if typ == "bool" and name_ in ("is_active", "is_published", "is_public"):
            setattr(obj, name_, True)
    d = body()
    apply_fields(obj, fields, d, creating=True)
    db.add(obj)
    db.flush()
    after_save(name, obj, d, created=True)
    db.commit()
    return ok(ser_generic(obj, fields))


@bp.put("/r/<name>/<int:oid>")
def res_update(name, oid):
    model, fields, _ = res_config(name)
    obj = db.get(model, oid)
    if not obj:
        raise ApiError("Запись не найдена", 404)
    d = body()
    apply_fields(obj, fields, d, creating=False)
    after_save(name, obj, d, created=False)
    db.commit()
    return ok(ser_generic(obj, fields))


@bp.delete("/r/<name>/<int:oid>")
def res_delete(name, oid):
    model, _, _ = res_config(name)
    obj = db.get(model, oid)
    if not obj:
        raise ApiError("Запись не найдена", 404)
    if name == "tariffs" and obj.is_default:
        raise ApiError("Нельзя удалить тариф по умолчанию")
    db.delete(obj)
    db.commit()
    return ok()


def after_save(name, obj, data, created):
    if name == "tariffs":
        if db.query(Tariff).filter(Tariff.code == obj.code, Tariff.id != obj.id).first():
            raise ApiError("Тариф с таким кодом уже есть")
        if obj.is_default:
            db.query(Tariff).filter(Tariff.id != obj.id).update({"is_default": False})
    if name == "news" and created and data.get("broadcast") and telegram.enabled():
        text = f"{obj.title}\n\n{obj.body}"[:4000]
        for u in db.query(User).filter(User.chat_id != "", User.notify.is_(True), User.is_blocked.is_(False)):
            telegram.send(u.chat_id, text)


# ================= материалы (файлы) =================
def ser_material(m):
    return {"id": m.id, "title": m.title, "description": m.description, "url": m.url, "filename": m.filename,
            "size": m.size, "sort": m.sort, "created_at": iso(m.created_at)}


def fill_material(m, creating):
    f = request.form
    if creating or "title" in f:
        m.title = clean_str(f.get("title"), "Название", 200, True)
    if "description" in f:
        m.description = clean_str(f.get("description"), "Описание", 300)
    if "url" in f:
        m.url = clean_url(f.get("url"), "Ссылка")
    if "sort" in f:
        m.sort = int(f.get("sort") or 0)
    file = request.files.get("file")
    if file and file.filename:
        data = file.read()
        m.filename, m.mime, m.size, m.data = file.filename[:255], (file.mimetype or "")[:120], len(data), data
    if f.get("remove_file") == "1":
        m.filename, m.mime, m.size, m.data = "", "", 0, None
    if not m.url and not m.filename:
        raise ApiError("Загрузите файл или укажите ссылку")


@bp.get("/materials")
def materials():
    return ok([ser_material(m) for m in db.query(Material).order_by(Material.sort, Material.created_at.desc())])


@bp.post("/materials")
def material_create():
    m = Material()
    fill_material(m, True)
    db.add(m)
    db.commit()
    return ok(ser_material(m))


@bp.post("/materials/<int:mid>")
def material_update(mid):
    m = db.get(Material, mid)
    if not m:
        raise ApiError("Материал не найден", 404)
    fill_material(m, False)
    db.commit()
    return ok(ser_material(m))


@bp.delete("/materials/<int:mid>")
def material_delete(mid):
    m = db.get(Material, mid)
    if m:
        db.delete(m)
        db.commit()
    return ok()


# ================= ссылки =================
@bp.get("/links")
def links():
    q = db.query(OfferLink).join(User, User.id == OfferLink.user_id)
    if request.args.get("status"):
        q = q.filter(OfferLink.status == request.args["status"])
    if request.args.get("q"):
        like = f"%{request.args['q'].strip()}%"
        q = q.filter(or_(User.email.ilike(like), User.username.ilike(like)))
    items, meta = paginate(q.order_by(OfferLink.created_at.desc()))
    ids = [l.id for l in items]
    counts = link_counts(ids)
    clicks = dict(db.query(Click.link_id, func.count(Click.id)).filter(Click.link_id.in_(ids)).group_by(Click.link_id).all()) if ids else {}
    out = []
    for l in items:
        d = ser_link(l, counts.get(l.id, 0), clicks.get(l.id, 0))
        d.update(target_url=l.url, user={"id": l.user.id, "email": l.user.email, "username": l.user.username})
        out.append(d)
    return ok(out, meta=meta)


@bp.patch("/links/<int:lid>")
def link_update(lid):
    l = db.get(OfferLink, lid)
    if not l:
        raise ApiError("Ссылка не найдена", 404)
    d = body()
    old_status = l.status
    if "url" in d:
        l.url = clean_url(d["url"], "Адрес оффера")
        if l.url and l.status == "requested":
            l.status = "active"
            telegram.notify_user(l.user, f"Ваша ссылка на оффер «{l.offer.name}» готова.")
    if "status" in d and d["status"] != old_status:
        if d["status"] not in ("requested", "active", "disabled"):
            raise ApiError("Неверный статус")
        if d["status"] == "active" and not l.url:
            raise ApiError("Сначала укажите адрес оффера")
        l.status = d["status"]
    if "limit" in d:
        l.limit = max(0, int(d["limit"] or 0))
    db.commit()
    return ok()


@bp.delete("/links/<int:lid>")
def link_delete(lid):
    l = db.get(OfferLink, lid)
    if l:
        db.delete(l)
        db.commit()
    return ok()


@bp.post("/partner/sync")
def partner_sync():
    if not partner_api.is_configured():
        raise ApiError("Интеграция с партнёрским API ещё не подключена")
    n = partner_api.sync_conversions()
    db.commit()
    return ok({"updated": n})


# ================= заявки =================
def admin_conv_query():
    q = conversions_query(request.args)
    if request.args.get("user"):
        q = q.filter(Conversion.user_id == int(request.args["user"]))
    return q


@bp.get("/conversions")
def conversions():
    q = admin_conv_query().order_by(Conversion.created_at.desc())
    items, meta = paginate(q, 100)
    return ok([ser_conversion(c, admin=True) for c in items], meta=meta)


@bp.post("/conversions")
def conversion_create():
    d = body()
    u = get_user(int(d.get("user_id") or 0))
    offer = db.get(Offer, int(d.get("offer_id") or 0))
    if not offer:
        raise ApiError("Оффер не найден")
    link = db.query(OfferLink).filter_by(user_id=u.id, offer_id=offer.id).first()
    c = create_conversion(u, offer, clean_inn(d.get("inn")), clean_str(d.get("fio"), "ФИО", 200),
                          clean_str(d.get("phone"), "Телефон", 40), clean_str(d.get("subid"), "Субметка", 80), link, "admin")
    if d.get("amount") not in (None, ""):
        c.amount = to_kop(d["amount"])
    if d.get("status"):
        set_conversion_status(c, d["status"])
    db.commit()
    return ok(ser_conversion(c, admin=True))


@bp.patch("/conversions/<int:cid>")
def conversion_update(cid):
    c = db.get(Conversion, cid)
    if not c:
        raise ApiError("Заявка не найдена", 404)
    d = body()
    if "inn" in d:
        c.inn = clean_inn(d["inn"])
    if "fio" in d:
        c.fio = clean_str(d["fio"], "ФИО", 200)
    set_conversion_status(c, d.get("status", c.status),
                          amount=to_kop(d["amount"]) if d.get("amount") not in (None, "") else None,
                          comment=clean_str(d["comment"], "Комментарий", 2000) if "comment" in d else None)
    db.commit()
    return ok(ser_conversion(c, admin=True))


@bp.post("/conversions/bulk")
def conversion_bulk():
    d = body()
    ids = [int(x) for x in d.get("ids") or []]
    if not ids:
        raise ApiError("Не выбраны заявки")
    items = db.query(Conversion).filter(Conversion.id.in_(ids)).all()
    for c in items:
        set_conversion_status(c, d.get("status"))
    db.commit()
    return ok({"updated": len(items)})


@bp.delete("/conversions/<int:cid>")
def conversion_delete(cid):
    c = db.get(Conversion, cid)
    if c:
        db.delete(c)
        db.commit()
    return ok()


@bp.get("/conversions.csv")
def conversions_csv():
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["ID", "Дата", "Пользователь", "Оффер", "ИНН", "ФИО", "Телефон", "Субметка", "Статус", "Сумма", "Комментарий"])
    for c in admin_conv_query().order_by(Conversion.created_at.desc()).all():
        s = ser_conversion(c, admin=True)
        w.writerow([c.id, s["created_at"], c.user.email, s["offer_name"], c.inn, c.fio, c.phone, c.subid,
                    s["status_name"], str(s["amount"]).replace(".", ","), c.comment])
    return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=conversions.csv"})


# ================= трафик =================
@bp.get("/traffic")
def traffic():
    purchases = db.query(Purchase).order_by(Purchase.created_at.desc()).limit(200).all()
    return ok({
        "available": db.query(func.count(TrafficRow.id)).filter(TrafficRow.purchase_id.is_(None)).scalar(),
        "sold": db.query(func.count(TrafficRow.id)).filter(TrafficRow.purchase_id.isnot(None)).scalar(),
        "price": float(settings.get("traffic_price") or 0),
        "purchases": [{"id": p.id, "rows": p.rows, "total": rub(p.total), "created_at": iso(p.created_at),
                       "user": {"id": p.user.id, "email": p.user.email}} for p in purchases],
    })


@bp.post("/traffic/rows")
def traffic_upload():
    if request.files.get("file"):
        text = request.files["file"].read().decode("utf-8-sig", errors="replace")
    else:
        text = body().get("text") or ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if request.args.get("skip_header") == "1" and lines:
        lines = lines[1:]
    if not lines:
        raise ApiError("Нет строк для загрузки")
    if len(lines) > 200000:
        raise ApiError("Слишком много строк за раз (макс. 200 000)")
    db.bulk_save_objects([TrafficRow(data=ln[:2000]) for ln in lines])
    db.commit()
    return ok({"added": len(lines)})


@bp.delete("/traffic/rows")
def traffic_clear():
    n = db.query(TrafficRow).filter(TrafficRow.purchase_id.is_(None)).delete()
    db.commit()
    return ok({"deleted": n})


# ================= пополнения =================
@bp.get("/topups")
def topups():
    q = db.query(TopUpRequest)
    if request.args.get("status"):
        q = q.filter_by(status=request.args["status"])
    items, meta = paginate(q.order_by(TopUpRequest.created_at.desc()))
    return ok([{"id": t.id, "amount": rub(t.amount), "note": t.note, "status": t.status, "admin_note": t.admin_note,
                "created_at": iso(t.created_at), "processed_at": iso(t.processed_at),
                "user": {"id": t.user.id, "email": t.user.email, "username": t.user.username}} for t in items], meta=meta)


@bp.post("/topups/<int:tid>/<action>")
def topup_process(tid, action):
    t = db.get(TopUpRequest, tid)
    if not t:
        raise ApiError("Заявка не найдена", 404)
    if t.status != "pending":
        raise ApiError("Заявка уже обработана")
    if action not in ("approve", "reject"):
        raise ApiError("Неизвестное действие", 404)
    d = body()
    t.admin_note = clean_str(d.get("note"), "Комментарий", 300)
    t.processed_at = utcnow()
    if action == "approve":
        amount = to_kop(d["amount"]) if d.get("amount") not in (None, "") else t.amount
        t.amount, t.status = amount, "approved"
        change_balance(t.user_id, amount, "topup", f"Пополнение #{t.id}", require_funds=False)
        telegram.notify_user(t.user, f"Баланс пополнен на {rub(amount)} ₽.")
    else:
        t.status = "rejected"
        telegram.notify_user(t.user, f"Заявка на пополнение отклонена. {t.admin_note}".strip())
    db.commit()
    return ok()


# ================= поддержка =================
@bp.get("/tickets")
def tickets():
    q = db.query(Ticket)
    if request.args.get("status"):
        q = q.filter_by(status=request.args["status"])
    items, meta = paginate(q.order_by(Ticket.updated_at.desc()))
    return ok([ser_ticket(t, admin=True) for t in items], meta=meta)


@bp.get("/tickets/<int:tid>")
def ticket(tid):
    t = db.get(Ticket, tid)
    if not t:
        raise ApiError("Обращение не найдено", 404)
    return ok(ser_ticket(t, messages=True, admin=True))


@bp.post("/tickets/<int:tid>/messages")
def ticket_reply(tid):
    t = db.get(Ticket, tid)
    if not t:
        raise ApiError("Обращение не найдено", 404)
    text = clean_str(body().get("body"), "Сообщение", 5000, True)
    t.messages.append(TicketMessage(body=text, is_admin=True))
    t.status, t.updated_at = "answered", utcnow()
    telegram.notify_user(t.user, f"Ответ поддержки по обращению «{t.subject}»:\n\n{text[:3000]}")
    db.commit()
    return ok(ser_ticket(t, messages=True, admin=True))


@bp.post("/tickets/<int:tid>/status")
def ticket_status(tid):
    t = db.get(Ticket, tid)
    if not t:
        raise ApiError("Обращение не найдено", 404)
    st = body().get("status")
    if st not in ("open", "answered", "closed"):
        raise ApiError("Неверный статус")
    t.status, t.updated_at = st, utcnow()
    db.commit()
    return ok()


# ================= настройки =================
@bp.get("/settings")
def get_settings():
    values = settings.get_all()
    return ok([{"key": k, "label": l, "type": t, "group": grp, "value": values[k]} for k, l, t, _, grp in settings.SCHEMA])


@bp.put("/settings")
def put_settings():
    settings.update(body())
    db.commit()
    return ok()


@bp.post("/telegram/webhook")
def tg_webhook():
    if not telegram.enabled():
        raise ApiError("Не задан TELEGRAM_BOT_TOKEN")
    base = (os.environ.get("PUBLIC_URL") or request.host_url).rstrip("/")
    if not base.startswith("https://"):
        raise ApiError("Telegram требует HTTPS-адрес. Укажите PUBLIC_URL")
    secret = secrets.token_hex(16)
    row = db.get(Setting, telegram.SECRET_KEY)
    if row:
        row.value = secret
    else:
        db.add(Setting(key=telegram.SECRET_KEY, value=secret))
    db.commit()
    try:
        res = telegram.set_webhook(f"{base}/tg/webhook", secret)
    except Exception as e:
        raise ApiError(f"Telegram: {e}")
    return ok(res)
