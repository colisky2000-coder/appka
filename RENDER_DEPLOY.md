# Деплой на Render.com

## Вариант 1: Blueprint (рекомендуется)

1. Зайди на https://dashboard.render.com
2. **New +** → **Blueprint**
3. Подключи **GitHub** (если ещё не подключён) и выбери репозиторий **appka**
4. Render подхватит `render.yaml` из корня. Нажми **Apply**
5. Создастся сервис **appka**. Зайди в него → **Environment**
6. Добавь переменные (значения задаёшь сам):
   - **GOOGLE_CREDENTIALS_JSON** — весь JSON ключа одной строкой (из `debet-485119-8db3a76f5c13.json`)
   - **BOT_TOKEN** — токен бота (или оставь пусто — в коде есть дефолт)
   - **SPREADSHEET_ID** — ID таблицы (или оставь пусто)
7. **Save Changes** → Render сделает деплой
8. Ссылка на приложение: `https://appka-xxxx.onrender.com` (в шапке сервиса)

## Вариант 2: Ручное создание Web Service

1. **New +** → **Web Service**
2. Подключи репо **appka**, ветка **main**
3. **Runtime:** Docker (Render найдёт Dockerfile в корне)
4. **Instance Type:** Free
5. В **Environment** добавь переменные (как выше)
6. **Create Web Service**

## Проверка

После деплоя открой:
- `https://твой-сервис.onrender.com/api/check_table` — должно быть `"ok": true`
- `https://твой-сервис.onrender.com` — фронт приложения

На бесплатном тарифе сервис засыпает после ~15 мин без запросов; первый запрос после сна может идти 30–60 сек (cold start).
