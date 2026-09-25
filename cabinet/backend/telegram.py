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


def send(chat_id, text, html=False):
    """Отправка в фоне, чтобы не тормозить ответ API. html=True — разметка <b>, <code>."""
    if not enabled() or not chat_id:
        return
    payload = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
    if html:
        payload["parse_mode"] = "HTML"

    def run():
        try:
            call("sendMessage", payload)
        except Exception as e:  # сеть/блокировка бота — не критично
            log.warning("telegram send failed: %s", e)

    threading.Thread(target=run, daemon=True).start()


def notify_user(user, text):
    if user and user.notify and user.chat_id:
        send(user.chat_id, text)


def set_webhook(url):
    return call("setWebhook", {"url": url, "secret_token": webhook_secret(), "allowed_updates": ["message"]})
