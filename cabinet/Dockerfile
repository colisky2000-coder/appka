FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD gunicorn wsgi:app --bind 0.0.0.0:${PORT:-8000} --workers 2 --threads 4 --timeout 60
