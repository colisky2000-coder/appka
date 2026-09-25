"""Публичные адреса: редирект по ссылке, вебхук Telegram, обложки, приглашения."""
import hashlib
import hmac
from datetime import timedelta

from flask import Blueprint, Response, abort, g, redirect, render_template_string, request
from markupsafe import escape

from . import telegram
from .auth import client_ip, load_user
from .db import db, utcnow
from .models import Article, Click, Lesson, Material, OfferLink, Program, Setting, User

bp = Blueprint("public", __name__)


def visitor_id():
    raw = f"{client_ip()}|{request.headers.get('User-Agent', '')}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def active_link(code):
    link = db.query(OfferLink).filter_by(code=code).first()
    if not link or link.status != "active" or not link.url or not link.offer or not link.offer.is_active:
        return None
    return link


@bp.get("/go/<code>")
def go(code):
    link = active_link(code)
    if not link:
        return render_page("Ссылка недоступна", "<p>Ссылка отключена или ещё не активирована.</p>"), 404
    subid = (request.args.get("sub") or request.args.get("s") or "")[:80]
    vid = visitor_id()
    seen = db.query(Click.id).filter(Click.link_id == link.id, Click.visitor == vid,
                                     Click.created_at >= utcnow() - timedelta(hours=24)).first()
    db.add(Click(link_id=link.id, visitor=vid, is_unique=seen is None, subid=subid))
    db.commit()
    return redirect(link.url, code=302)


PAGE = """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{{ title }}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fafaf8;color:#1c1c1c;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.card{background:#fff;border:1px solid #2a2a2a;border-radius:14px;padding:24px;width:100%;max-width:420px;box-sizing:border-box}
h1{font-size:20px;margin:0 0 4px}.muted{color:#7a7a7a}.small{font-size:12px}
label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7a7a7a;margin:14px 0}
input{font:inherit;font-size:15px;color:#1c1c1c;padding:10px 12px;border:1px solid #2a2a2a;border-radius:8px}
button{width:100%;padding:12px;border:0;border-radius:8px;background:#8a6420;color:#fff;font:inherit;font-weight:600;cursor:pointer;margin-top:6px}
.err{background:#fdf1f1;color:#d23b3b;border:1px solid #f3c7c7;border-radius:8px;padding:10px;margin-top:12px}
.hp{position:absolute;left:-9999px}
</style></head><body>{{ content|safe }}</body></html>"""


def render_page(title, content_html):
    content_html = f'<div class="card"><h1>{escape(title)}</h1>{content_html}</div>'
    return render_template_string(PAGE, title=title, content=content_html)


@bp.post("/tg/webhook")
def tg_webhook():
    row = db.get(Setting, telegram.SECRET_KEY)
    got = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not row or not hmac.compare_digest(row.value, got):
        abort(403)
    msg = (request.get_json(silent=True) or {}).get("message") or {}
    text = (msg.get("text") or "").strip()
    chat_id = str((msg.get("chat") or {}).get("id") or "")
    if chat_id and text.startswith("/start"):
        parts = text.split(maxsplit=1)
        code = parts[1].strip() if len(parts) > 1 else ""
        user = db.query(User).filter_by(tg_link_code=code).first() if code else None
        if user:
            user.chat_id, user.tg_link_code = chat_id, ""
            if not user.username and (msg.get("from") or {}).get("username"):
                user.username = msg["from"]["username"]
            db.commit()
            telegram.send(chat_id, "Telegram привязан к кабинету. Сюда будут приходить уведомления.")
        else:
            telegram.send(chat_id, "Чтобы привязать Telegram, нажмите «Привязать» в профиле личного кабинета.")
    return {"ok": True}


COVER_KINDS = {"articles": Article, "materials": Material, "lessons": Lesson, "programs": Program}


@bp.get("/media/<kind>/<int:oid>/cover")
def cover(kind, oid):
    load_user()
    model = COVER_KINDS.get(kind)
    if not g.user or not model:
        abort(404)
    obj = db.get(model, oid)
    if not obj or not obj.cover_mime or not obj.cover_data:
        abort(404)
    # Адрес содержит ?v=версия, поэтому картинку можно долго кешировать
    return Response(obj.cover_data, mimetype=obj.cover_mime,
                    headers={"Cache-Control": "private, max-age=31536000, immutable"})


@bp.get("/join/<code>")
def join(code):
    return redirect(f"/#/join/{code}", code=302)
