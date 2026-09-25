import logging
import os

import click
from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from .auth import ensure_admin_from_env, hash_password, load_user, validate_password
from .db import Base, db, init_engine
from .util import ApiError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
log = logging.getLogger(__name__)


def create_app(database_url=None):
    app = Flask(__name__, static_folder=STATIC, static_url_path="/static")
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    data_dir = os.environ.get("DATA_DIR", os.path.join(ROOT, "instance"))
    url = database_url or os.environ.get("DATABASE_URL") or f"sqlite:///{os.path.join(data_dir, 'cabinet.db')}"
    engine = init_engine(url)

    from . import models  # noqa: F401 — регистрирует таблицы
    Base.metadata.create_all(engine)

    from .seed import seed_defaults, seed_demo
    seed_defaults()
    seed_demo()
    ensure_admin_from_env()
    db.remove()

    from .admin import bp as admin_bp
    from .api import bp as api_bp
    from .public import bp as public_bp
    app.register_blueprint(api_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(public_bp)

    @app.before_request
    def _before():
        g.user = g.session = None
        if request.path.startswith("/api/"):
            # Защита от CSRF: изменяющие запросы принимаются только от нашего фронтенда
            if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("X-Requested-With") != "fetch":
                raise ApiError("Некорректный запрос", 400)
            load_user()

    @app.after_request
    def _headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        if request.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    @app.teardown_appcontext
    def _teardown(exc):
        if exc:
            db.rollback()
        db.remove()

    @app.errorhandler(ApiError)
    def _api_error(e):
        db.rollback()
        return jsonify({"ok": False, "error": e.message}), e.status

    @app.errorhandler(HTTPException)
    def _http_error(e):
        if request.path.startswith("/api/"):
            msg = "Файл слишком большой (макс. 25 МБ)" if e.code == 413 else e.description
            return jsonify({"ok": False, "error": msg}), e.code
        return e

    @app.errorhandler(Exception)
    def _error(e):
        db.rollback()
        log.exception("Unhandled error")
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "Внутренняя ошибка сервера"}), 500
        return "Внутренняя ошибка сервера", 500

    @app.get("/")
    def index():
        return send_from_directory(STATIC, "index.html", max_age=0)

    @app.get("/healthz")
    def health():
        return {"ok": True}

    @app.cli.command("create-admin")
    @click.argument("email")
    @click.argument("password")
    def create_admin(email, password):
        """Создать администратора или выдать права существующему пользователю."""
        from .models import Tariff, User
        validate_password(password)
        email = email.strip().lower()
        u = db.query(User).filter_by(email=email).first()
        if u:
            u.role, u.password_hash = "admin", hash_password(password)
        else:
            t = db.query(Tariff).filter_by(is_default=True).first()
            db.add(User(email=email, password_hash=hash_password(password), role="admin",
                        links_access=True, tariff_id=t.id if t else None))
        db.commit()
        click.echo(f"Администратор {email} готов")

    return app
