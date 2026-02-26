"""
Установить кнопку меню бота «Открыть приложение» (Web App).
Запуск: python set_menu_button.py https://твой-ngrok-или-домен.ngrok-free.dev
Или: set WEBAPP_URL=https://... и python set_menu_button.py
"""
import os
import sys
import requests

BOT_TOKEN = "8005452418:AAHq0dhlehYHuTSVXdI68BOP7AKlhDfzVa0"

def main():
    url = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("WEBAPP_URL", "")).strip()
    if not url:
        print("Укажи URL приложения: python set_menu_button.py https://твой-адрес.ngrok-free.dev")
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
