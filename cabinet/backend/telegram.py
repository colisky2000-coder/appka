"""Необязательные уведомления в Telegram. Работают, если задан TELEGRAM_BOT_TOKEN."""
import json
import logging
import os
import threading
import urllib.request

log = logging.getLogger(__name__)

# Ключ в таблице settings, где хранится секрет вебхука
SECRET_KEY = "_tg_webhook_secret"


def token():
    return os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()


def bot_username():
    return os.environ.get("TELEGRAM_BOT_USERNAME", "").strip().lstrip("@")


def enabled():
    return bool(token())


def _call(method, payload):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token()}/{method}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def send(chat_id, text):
    """Отправка в фоне, чтобы не тормозить ответ API."""
    if not enabled() or not chat_id:
        return

    def run():
        try:
            _call("sendMessage", {"chat_id": chat_id, "text": text, "disable_web_page_preview": True})
        except Exception as e:  # сеть/блокировка бота — не критично
            log.warning("telegram send failed: %s", e)

    threading.Thread(target=run, daemon=True).start()


def notify_user(user, text):
    if user and user.notify and user.chat_id:
        send(user.chat_id, text)


def set_webhook(url, secret):
    return _call("setWebhook", {"url": url, "secret_token": secret, "allowed_updates": ["message"]})
