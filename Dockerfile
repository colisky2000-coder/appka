# Сборка фронтенда
FROM node:20-alpine AS frontend
WORKDIR /app
COPY app.jsx ./
COPY frontend/ ./frontend/
RUN cd frontend && npm install && npm run build

# Финальный образ. Ключ Google: переменная GOOGLE_CREDENTIALS_BASE64 в Railway.
FROM python:3.11-slim
WORKDIR /app
COPY server.py requirements.txt ./
# Ключ Google только из переменной GOOGLE_CREDENTIALS_BASE64 на Railway (файл не в репо)
COPY --from=frontend /app/frontend/dist ./frontend/dist
RUN pip install --no-cache-dir -r requirements.txt
ENV PORT=5000
EXPOSE 5000
CMD gunicorn server:app --bind 0.0.0.0:${PORT} --workers 1 --timeout 60