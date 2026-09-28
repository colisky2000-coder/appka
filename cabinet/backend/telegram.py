"""Telegram-бот: отправка сообщений. Работает, если задан TELEGRAM_BOT_TOKEN."""
import hashlib
import json
import logging
import os
import threading
import urllib.request

log = logging.getLogger(__name__)


def token():
    return os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()


def bot_username():
    return os.environ.get("TELEGRAM_BOT_USERNAME", "").strip().lstrip("@")


def enabled():
    return bool(token())


def webhook_secret():
    """Секрет вебхука выводится из токена: одинаковый во всех процессах, хранить не нужно."""
    return hashlib.sha256(("webhook:" + token()).encode()).hexdigest()[:48]


def call(method, payload, timeout=10):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token()}/{method}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _bg(method, payload):
    """Запрос к Telegram в фоне, чтобы не тормозить ответ API и бота."""
    def run():
        try:
            call(method, payload)
        except Exception as e:  # сеть/блокировка бота — не критично
            log.warning("telegram %s failed: %s", method, e)

    threading.Thread(target=run, daemon=True).start()


def send(chat_id, text, html=False, buttons=None):
    """html=True — разметка <b>, <code>; buttons — строки инлайн-кнопок [[{text, callback_data | url}]]."""
    if not enabled() or not chat_id:
        return
    payload = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
    if html:
        payload["parse_mode"] = "HTML"
    if buttons:
        payload["reply_markup"] = {"inline_keyboard": buttons}
    _bg("sendMessage", payload)


def notify_user(user, text):
    if user and user.notify and user.chat_id:
        send(user.chat_id, text)


def set_webhook(url):
    return call("setWebhook", {"url": url, "secret_token": webhook_secret(), "allowed_updates": ["message"]})
