"""
Telegram-бот кабинета:
  * код подтверждения при регистрации (ссылка t.me/<бот>?start=reg_<токен>);
  * привязка Telegram к аккаунту для уведомлений (t.me/<бот>?start=<код из профиля>).

Сообщения приходят через вебхук /tg/webhook (хостинг с HTTPS) или опросом getUpdates
(локальный запуск: python wsgi.py).
"""
import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from datetime import timedelta
from html import escape

from . import settings, telegram
from .db import db, utcnow
from .models import TgSignup, User
from .util import ApiError

log = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=15)      # сколько живёт ссылка/код
VERIFIED_TTL = timedelta(minutes=30)  # сколько после ввода кода можно задать логин и пароль
MAX_ATTEMPTS = 5
PREFIX = "reg_"


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def code_hash(token, code):
    return hmac.new(token.encode(), code.encode(), hashlib.sha256).hexdigest()


def brand():
    s = settings.get_all()
    return f"{s['brand_name']} {s['brand_accent']}".strip() or "Личный кабинет"


# ---------- регистрация ----------
def new_signup(invite):
    """Создаёт запрос регистрации; токен уходит в ссылку на бота."""
    db.query(TgSignup).filter(TgSignup.expires_at < utcnow() - timedelta(days=1)).delete()
    token = secrets.token_urlsafe(24)
    db.add(TgSignup(token_hash=_hash(token), invite_id=invite.id, expires_at=utcnow() + CODE_TTL))
    return token


def get_signup(token):
    rec = db.query(TgSignup).filter_by(token_hash=_hash(str(token or ""))).first() if token else None
    if not rec or rec.used or rec.expires_at < utcnow():
        raise ApiError("Код устарел — нажмите «Получить код» ещё раз")
    return rec


def check_code(rec, token, code):
    if not rec.code_hash:
        raise ApiError("Сначала откройте бота и нажмите «Запустить» — он пришлёт код")
    if rec.attempts >= MAX_ATTEMPTS:
        raise ApiError("Слишком много неверных попыток — получите новый код", 429)
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if not hmac.compare_digest(rec.code_hash, code_hash(token, code)):
        rec.attempts += 1
        db.commit()
        raise ApiError("Неверный код")
    rec.verified = True
    rec.expires_at = utcnow() + VERIFIED_TTL
    db.commit()


def _signup_code(token, chat_id, frm):
    rec = db.query(TgSignup).filter_by(token_hash=_hash(token)).first()
    if not rec or rec.used or rec.expires_at < utcnow():
        return telegram.send(chat_id, "Ссылка устарела. Вернитесь на сайт и нажмите «Получить код» ещё раз.")
    tg_id = str(frm.get("id") or "")
    existing = db.query(User).filter_by(tg_id=tg_id).first()
    if existing:
        return telegram.send(chat_id, f"Этот Telegram уже зарегистрирован в кабинете, ваш логин: {existing.login}\n"
                                      "Войдите на сайте по логину и паролю. Забыли пароль — напишите администратору.")
    code = f"{secrets.randbelow(10 ** 6):06d}"
    name = " ".join(x for x in (frm.get("first_name"), frm.get("last_name")) if x)
    rec.chat_id, rec.tg_id = chat_id, tg_id
    rec.tg_username, rec.tg_name = (frm.get("username") or "")[:64], name[:120]
    rec.code_hash, rec.attempts, rec.verified = code_hash(token, code), 0, False
    rec.expires_at = utcnow() + CODE_TTL
    db.commit()
    telegram.send(chat_id, f"Код для регистрации в кабинете «{escape(brand())}»:\n\n<code>{code}</code>\n\n"
                           "Введите его на сайте. Код действует 15 минут. Никому его не сообщайте.", html=True)


# ---------- привязка уведомлений ----------
def _link(user, chat_id, frm):
    tg_id = str(frm.get("id") or "")
    other = db.query(User).filter(User.tg_id == tg_id, User.id != user.id).first()
    if other:
        return telegram.send(chat_id, "Этот Telegram уже привязан к другому аккаунту кабинета.")
    user.chat_id, user.tg_id, user.tg_link_code = chat_id, tg_id, ""
    if not user.username and frm.get("username"):
        user.username = frm["username"][:64]
    db.commit()
    telegram.send(chat_id, "Telegram привязан к кабинету. Сюда будут приходить уведомления.")


def handle_update(update):
    msg = update.get("message") or {}
    chat = msg.get("chat") or {}
    frm = msg.get("from") or {}
    chat_id = str(chat.get("id") or "")
    if not chat_id or not frm.get("id") or chat.get("type", "private") != "private":
        return
    text = (msg.get("text") or "").strip()
    payload = text.split(maxsplit=1)[1].strip() if text.startswith("/start") and " " in text else ""
    if payload.startswith(PREFIX):
        return _signup_code(payload[len(PREFIX):], chat_id, frm)
    if payload:
        user = db.query(User).filter_by(tg_link_code=payload).first()
        if user:
            return _link(user, chat_id, frm)
    me = db.query(User).filter_by(tg_id=str(frm["id"])).first()
    site = os.environ.get("PUBLIC_URL", "").strip()
    text = f"Это бот кабинета «{brand()}».\n\n"
    text += (f"Вы зарегистрированы, ваш логин: {me.login}. Входите на сайте по логину и паролю."
             if me else "Регистрация — только по ссылке-приглашению от администратора: откройте её и нажмите «Получить код».")
    telegram.send(chat_id, text + (f"\n\nСайт: {site}" if site else ""))


# ---------- получение сообщений ----------
def use_webhook():
    return os.environ.get("PUBLIC_URL", "").strip().startswith("https://")


def setup_webhook_async():
    """На хостинге с HTTPS вебхук подключается сам при запуске."""
    url = os.environ["PUBLIC_URL"].strip().rstrip("/") + "/tg/webhook"

    def run():
        try:
            telegram.set_webhook(url)
        except Exception as e:
            log.warning("telegram setWebhook failed: %s", e)

    threading.Thread(target=run, daemon=True).start()


def start_polling(app):
    """Локальный запуск без HTTPS: бот сам забирает сообщения у Telegram."""
    def loop():
        offset = 0
        try:
            telegram.call("deleteWebhook", {})
        except Exception as e:
            log.warning("telegram deleteWebhook failed: %s", e)
        while True:
            try:
                res = telegram.call("getUpdates", {"offset": offset, "timeout": 25, "allowed_updates": ["message"]}, timeout=35)
            except Exception as e:
                log.warning("telegram getUpdates failed: %s", e)
                time.sleep(5)
                continue
            for upd in res.get("result", []):
                offset = upd["update_id"] + 1
                with app.app_context():
                    try:
                        handle_update(upd)
                    except Exception:
                        log.exception("telegram update failed")
                        db.rollback()
                    finally:
                        db.remove()

    threading.Thread(target=loop, daemon=True, name="tg-polling").start()
