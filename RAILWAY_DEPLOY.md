# Деплой на Railway — по шагам

## 1. Переменные в Railway

В проекте Railway → **Variables** добавь (или проверь):

| Переменная | Значение |
|------------|----------|
| `GOOGLE_CREDENTIALS_BASE64` | Скопируй **целиком** содержимое файла `railway_base64.txt` (одной строкой, без переносов). |
| `BOT_TOKEN` | Токен бота (если не задан — в коде есть дефолт). |
| `SPREADSHEET_ID` | ID таблицы (если не задан — в коде есть дефолт). |

Файл `railway_base64.txt` лежит в корне проекта; он в `.gitignore` и не попадает в репозиторий. Открой его и вставь значение в переменную `GOOGLE_CREDENTIALS_BASE64` в Railway.

## 2. Таблица Google

У таблицы должен быть доступ **Редактор** для:
`debet-73@debet-485119.iam.gserviceaccount.com`

## 3. Деплой

- Нажми **Redeploy** в Railway (или пуш в `main` — если настроен автодеплой).

## 4. Проверка

Открой в браузере:
- https://appka-production-3107.up.railway.app/api/check_table  

Ожидается: `{"ok": true, "message": "Связь с таблицей есть.", ...}`

Если `ok: false` — проверь переменную `GOOGLE_CREDENTIALS_BASE64` (без пробелов/переносов в начале и конце).

---

**Локально:** положи в корень проекта файл `google-credentials.json` (ключ сервисного аккаунта) — он в `.gitignore`. Либо задай `GOOGLE_CREDENTIALS_FILE` путь к JSON.
