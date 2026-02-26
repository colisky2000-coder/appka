"""
Установить кнопку меню бота «Открыть приложение» (Web App).
Запуск: set BOT_TOKEN=твой_токен && python set_menu_button.py https://твой-домен.up.railway.app
Или задай BOT_TOKEN в .env.
"""
import os
import sys
import requests

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")

def main():
    if not BOT_TOKEN:
        print("Задай BOT_TOKEN: set BOT_TOKEN=твой_токен && python set_menu_button.py <url>")
        sys.exit(1)
    url = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("WEBAPP_URL", "")).strip()
    if not url:
        print("Укажи URL приложения: python set_menu_button.py https://твой-адрес.up.railway.app")
        sys.exit(1)
    if not url.startswith("https://"):
        print("URL должен начинаться с https://")
        sys.exit(1)

    r = requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/setChatMenuButton",
        json={
            "menu_button": {
                "type": "web_app",
                "text": "Открыть приложение",
                "web_app": {"url": url}
            }
        },
        timeout=10
    )
    data = r.json()
    if data.get("ok"):
        print("Готово. Кнопка «Открыть приложение» установлена. Открой бота в Telegram — кнопка будет рядом с полем ввода.")
    else:
        print("Ошибка:", data.get("description", r.text))
        sys.exit(1)

if __name__ == "__main__":
    main()
