# Деплой на Railway (бесплатный HTTPS без ngrok)

После деплоя получишь ссылку вида `https://твой-проект.up.railway.app` — её вставляешь в BotFather, страницы «You are about to visit» не будет.

---

## 1. Репозиторий на GitHub

1. Зайди на https://github.com/new
2. Создай репозиторий (например `earnings-calc-bot`), можно приватный
3. В папке проекта выполни (подставь свой логин и имя репо):

```bash
cd d:\appka
git init
git add .
git commit -m "Deploy"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/ИМЯ_РЕПО.git
git push -u origin main
```

**Важно:** файл `debet-485119-31d092561d4c.json` лучше не коммитить. Добавь в `.gitignore` строку:
```
debet-485119-31d092561d4c.json
```
Потом credentials задашь в Railway через переменную (шаг 3).

---

## 2. Регистрация и проект в Railway

1. Зайди на https://railway.app
2. Войди через **Login with GitHub**
3. **New Project** → **Deploy from GitHub repo**
4. Выбери свой репозиторий
5. Railway сам найдёт `Dockerfile` и начнёт сборку

---

## 3. Учётные данные Google и переменные в Railway

**Вариант А — через переменную (рекомендуется)**  
В проекте открой свой сервис → вкладка **Variables** → **Add Variable**:

| Переменная | Значение |
|------------|----------|
| `GOOGLE_CREDENTIALS_JSON` | **Весь текст** из файла `debet-485119-31d092561d4c.json` (от `{` до `}`). Скопируй целиком. |
| или `GOOGLE_CREDENTIALS_BASE64` | Содержимое файла `railway_base64.txt` (ключ в Base64). |

При желании можно переопределить: `BOT_TOKEN`, `SPREADSHEET_ID`.

**Вариант Б — ключ из файла в репо (обход, если переменные не доходят)**  
Только для **приватного** репо. В корне проекта лежит файл `google-credentials.json` (заглушка). Замени его содержимое на полный JSON из `debet-485119-31d092561d4c.json`, сохрани, закоммить и запушь. Тогда переменные не нужны — приложение возьмёт ключ из файла при сборке.

После сохранения переменных или пуша с подменённым файлом Railway пересоберёт/перезапустит приложение.

---

## 4. Получить ссылку

1. В Railway открой свой сервис
2. Вкладка **Settings** → **Networking** → **Generate Domain**
3. Появится домен вида `твой-проект.up.railway.app`
4. Ссылка будет: **`https://твой-проект.up.railway.app`**

---

## 5. Настроить бота в Telegram

1. В **BotFather** в настройках бота укажи **Mini App URL**:  
   `https://твой-проект.up.railway.app`
2. Установи кнопку меню (один раз с нового URL):

```bash
cd d:\appka
python set_menu_button.py https://твой-проект.up.railway.app
```

Готово. В Telegram открываешь бота → «Открыть приложение» — откроется твой домен на Railway без страницы ngrok.

---

## Если сборка в Railway падает

- Проверь, что в репозитории есть: `Dockerfile`, `server.py`, `app.jsx`, папка `frontend/` с `package.json` и `index.html`.
- В логах сборки (Railway → Deployments → View Logs) смотри, на каком шаге ошибка (часто это `npm run build` в `frontend`).
- Убедись, что переменная `GOOGLE_CREDENTIALS_JSON` задана и содержит валидный JSON без лишних пробелов в начале/конце.
