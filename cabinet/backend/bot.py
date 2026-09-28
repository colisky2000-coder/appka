"""
Telegram-бот кабинета:
  * вход на сайт: кнопка «Войти через Telegram» -> t.me/<бот>?start=in_<токен> -> бот присылает код ->
    человек вводит код на сайте. Код получает только тот, кто уже зарегистрирован, или новичок по действующей
    ссылке-приглашению (её тариф и программа достаются ему). Паролей у пользователей нет;
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
from .models import Invite, TgSignup, User
from .util import ApiError

log = logging.getLogger(__name__)

LOGIN_TTL = timedelta(minutes=15)  # сколько живут ссылка на вход и код
MAX_ATTEMPTS = 5
PREFIX = "in_"
OLD_PREFIX = "reg_"  # ссылки из старой версии
NOT_REGISTERED = ("Вы ещё не зарегистрированы. Регистрация — по ссылке-приглашению от администратора: "
                  "откройте её и нажмите «Войти через Telegram».")


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def code_hash(token, code):
    return hmac.new(token.encode(), code.encode(), hashlib.sha256).hexdigest()


def brand():
    return settings.get("brand_name").strip() or "Личный кабинет"


# ---------- вход ----------
def new_login(invite=None):
    """Создаёт запрос входа; токен уходит в ссылку на бота и остаётся у сайта для опроса."""
    db.query(TgSignup).filter(TgSignup.expires_at < utcnow() - timedelta(days=1)).delete()
    token = secrets.token_urlsafe(24)
    db.add(TgSignup(token_hash=_hash(token), invite_id=invite.id if invite else 0, expires_at=utcnow() + LOGIN_TTL))
    return token


def get_login(token):
    rec = db.query(TgSignup).filter_by(token_hash=_hash(str(token or ""))).first() if token else None
    if not rec or rec.used or rec.expires_at < utcnow():
        raise ApiError("Ссылка для входа устарела — нажмите «Войти через Telegram» ещё раз", 410)
    return rec


def _alive(rec):
    return rec and not rec.used and rec.expires_at >= utcnow()


def _start_login(token, chat_id, frm):
    """/start in_<токен>: проверяем, что этому Telegram можно войти, и присылаем код."""
    from .services import invite_usable
    rec = db.query(TgSignup).filter_by(token_hash=_hash(token)).first()
    if not _alive(rec):
        return telegram.send(chat_id, "Ссылка для входа устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.")
    tg_id = str(frm.get("id") or "")
    u = db.query(User).filter_by(tg_id=tg_id).first()
    inv = db.get(Invite, rec.invite_id) if rec.invite_id else None
    if u and u.is_blocked:
        rec.error = "Аккаунт заблокирован. Напишите администратору."
    elif not u and not invite_usable(inv):
        rec.error = NOT_REGISTERED if not rec.invite_id else "Ссылка-приглашение больше не действует. Попросите у администратора новую."
    if rec.error:
        db.commit()
        return telegram.send(chat_id, rec.error)
    code = f"{secrets.randbelow(10 ** 6):06d}"
    name = " ".join(x for x in (frm.get("first_name"), frm.get("last_name")) if x)
    rec.chat_id, rec.tg_id = chat_id, tg_id
    rec.tg_username, rec.tg_name = (frm.get("username") or "")[:64], name[:120]
    rec.code_hash, rec.attempts = code_hash(token, code), 0
    rec.expires_at = utcnow() + LOGIN_TTL
    db.commit()
    telegram.send(chat_id, f"Код для входа в кабинет «{escape(brand())}»:\n\n<code>{code}</code>\n\n"
                           "Введите его на сайте. Код действует 15 минут. Никому его не сообщайте.", html=True)


def check_code(rec, token, code):
    if not rec.code_hash:
        raise ApiError("Сначала откройте бота и нажмите «Запустить» — он пришлёт код")
    if rec.attempts >= MAX_ATTEMPTS:
        raise ApiError("Слишком много неверных попыток — нажмите «Получить новый код»", 429)
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if not hmac.compare_digest(rec.code_hash, code_hash(token, code)):
        rec.attempts += 1
        db.commit()
        raise ApiError("Неверный код")


def _new_login_name(username, tg_id):
    from .services import login_taken, suggest_login
    login = suggest_login(username)
    if login:
        return login
    base = f"tg{tg_id}"
    login, n = base, 1
    while login_taken(login):
        n += 1
        login = f"{base}_{n}"
    return login


def confirm_login(rec):
    """Код верный: находим или создаём пользователя. Возвращает (user | None, текст ошибки)."""
    from .auth import hash_password
    from .services import default_tariff, invite_usable, use_invite
    inv = db.get(Invite, rec.invite_id) if rec.invite_id else None
    u = db.query(User).filter_by(tg_id=rec.tg_id).first()
    if u:
        if u.is_blocked:
            return None, "Аккаунт заблокирован. Напишите администратору."
        # Вход по приглашению на другой тариф — переводим на него
        if invite_usable(inv) and (u.invite_id != inv.id or u.tariff_id != inv.tariff_id):
            use_invite(u, inv)
        u.chat_id = rec.chat_id or u.chat_id
        if rec.tg_username:
            u.username = rec.tg_username
        return u, ""
    if not invite_usable(inv):
        return None, (NOT_REGISTERED if not rec.invite_id
                      else "Ссылка-приглашение больше не действует. Попросите у администратора новую.")
    t = default_tariff()
    u = User(login=_new_login_name(rec.tg_username, rec.tg_id), password_hash=hash_password(secrets.token_urlsafe(32)),
             username=rec.tg_username, display_name=rec.tg_name, tg_id=rec.tg_id, chat_id=rec.chat_id,
             tariff_id=t.id if t else None, links_access=settings.get_bool("default_links_access"))
    use_invite(u, inv)
    db.add(u)
    db.flush()
    return u, ""


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
    for prefix in (PREFIX, OLD_PREFIX):
        if payload.startswith(prefix):
            return _start_login(payload[len(prefix):], chat_id, frm)
    if payload:
        user = db.query(User).filter_by(tg_link_code=payload).first()
        if user:
            return _link(user, chat_id, frm)
    me = db.query(User).filter_by(tg_id=str(frm["id"])).first()
    site = os.environ.get("PUBLIC_URL", "").strip()
    text = f"Это бот кабинета «{brand()}».\n\n"
    text += "Вы зарегистрированы. Чтобы войти, нажмите на сайте «Войти через Telegram»." if me else NOT_REGISTERED
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
