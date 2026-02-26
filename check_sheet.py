# -*- coding: utf-8 -*-
import os
import sys
import gspread
from oauth2client.service_account import ServiceAccountCredentials

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JSON = os.path.join(SCRIPT_DIR, "debet-485119-31d092561d4c.json")
SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "") or (sys.argv[1] if len(sys.argv) > 1 else "")
if not SPREADSHEET_ID:
    print("Задай ID таблицы: set SPREADSHEET_ID=твой_id или python check_sheet.py твой_id")
    sys.exit(1)

scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
creds = ServiceAccountCredentials.from_json_keyfile_name(JSON, scope)
client = gspread.authorize(creds)
sh = client.open_by_key(SPREADSHEET_ID)

for name in ["Список офферов X", "Список офферов Y"]:
    try:
        ws = sh.worksheet(name)
        rows = ws.get_all_values()[1:]
        active = [r for r in rows if len(r) >= 5 and (r[4] or "").strip().lower() == "да" and (r[0] or "").strip()]
        print(f"{name}: всего строк {len(rows)}, активных (статус 'да') {len(active)}")
    except Exception as e:
        print(f"{name}: ОШИБКА - {e}")

print("\nДоступ к таблице есть. Если на Railway пусто — проверь переменную GOOGLE_CREDENTIALS_JSON.")
