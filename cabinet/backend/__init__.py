import logging
import os

import click
from flask import Flask, g, jsonify, redirect, request
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from .auth import ensure_admin_from_env, hash_password, load_user, validate_password
from .db import Base, auto_migrate, db, drop_obsolete, init_engine
from .util import ApiError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
log = logging.getLogger(__name__)


class PrefixMiddleware:
    """
    Кабинет в подпапке сайта (URL_PREFIX=/secret): адреса /secret/... обслуживаются приложением.
    Если сервер уже выставил SCRIPT_NAME (Passenger с PassengerBaseURI), ничего не меняется.
    """

    def __init__(self, app, prefix):
        self.app, self.prefix = app, "/" + prefix.strip("/")

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")
        if self.prefix != "/" and (path == self.prefix or path.startswith(self.prefix + "/")):
            environ["SCRIPT_NAME"] = environ.get("SCRIPT_NAME", "").rstrip("/") + self.prefix
            environ["PATH_INFO"] = path[len(self.prefix):]
        return self.app(environ, start_response)


def static_version():
    """Версия статики для ?v= в index.html: после обновления браузер не возьмёт старые JS/CSS из кеша."""
    latest = 0
    for root, _, files in os.walk(STATIC):
        for f in files:
            latest = max(latest, int(os.path.getmtime(os.path.join(root, f))))
    return str(latest)


def create_app(database_url=None):
    app = Flask(__name__, static_folder=STATIC, static_url_path="/static")
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    if os.environ.get("URL_PREFIX", "").strip("/"):
        app.wsgi_app = PrefixMiddleware(app.wsgi_app, os.environ["URL_PREFIX"])

    data_dir = os.environ.get("DATA_DIR", os.path.join(ROOT, "instance"))
    url = database_url or os.environ.get("DATABASE_URL") or f"sqlite:///{os.path.join(data_dir, 'cabinet.db')}"
    engine = init_engine(url)

    from . import models  # noqa: F401 — регистрирует таблицы
    Base.metadata.create_all(engine)
    auto_migrate(engine)
    drop_obsolete(engine)

    from .seed import seed_defaults, seed_demo
    seed_defaults()
    seed_demo()
    ensure_admin_from_env()
    db.remove()

    from . import bot, telegram
    if telegram.enabled() and bot.use_webhook():
        bot.setup_webhook_async()

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
        resp.headers.setdefault("X-Robots-Tag", "noindex, nofollow")  # кабинет не нужен в поиске
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

    with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
        index_html = f.read().replace("__V__", static_version())

    @app.get("/")
    def index():
        # В подпапке страница должна открываться со слешем на конце: /secret/ — иначе
        # относительные адреса (api/..., static/...) уйдут в корень сайта
        if request.script_root and not request.environ.get("PATH_INFO"):
            return redirect(request.script_root + "/", code=301)
        return app.response_class(index_html, mimetype="text/html", headers={"Cache-Control": "no-cache"})

    @app.get("/healthz")
    def health():
        return {"ok": True}

    @app.cli.command("create-admin")
    @click.argument("login")
    @click.argument("password")
    def create_admin(login, password):
        """Создать администратора или выдать права существующему пользователю."""
        from .models import Tariff, User
        from .services import norm_login
        validate_password(password)
        login = norm_login(login)
        u = db.query(User).filter_by(login=login).first()
        if u:
            u.role, u.password_hash = "admin", hash_password(password)
        else:
            t = db.query(Tariff).filter_by(is_default=True).first()
            db.add(User(login=login, password_hash=hash_password(password), role="admin",
                        links_access=True, tariff_id=t.id if t else None))
        db.commit()
        click.echo(f"Администратор {login} готов")

    return app
