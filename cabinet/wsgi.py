import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env(path=os.path.join(HERE, ".env")):
    """Переменные из файла .env (КЛЮЧ=значение). Уже заданные в системе не перезаписываются."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()

from backend import create_app  # noqa: E402

app = create_app()

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG") == "1"
    # Локально (без HTTPS-адреса) бот забирает сообщения сам. При debug-перезагрузчике — только в рабочем процессе.
    if not debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        from backend import bot, telegram
        if telegram.enabled() and not bot.use_webhook():
            bot.start_polling(app)
            print("Telegram-бот запущен (опрос getUpdates)")
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=debug)
