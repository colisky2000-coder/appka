# Запусти: python to_base64.py
# Скопируй вывод и вставь в Railway как значение переменной GOOGLE_CREDENTIALS_BASE64
import base64
import os
path = os.path.join(os.path.dirname(__file__), "debet-485119-31d092561d4c.json")
with open(path, "rb") as f:
    print(base64.b64encode(f.read()).decode())
