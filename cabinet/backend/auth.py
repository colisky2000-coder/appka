from __future__ import annotations  # Python 3.9 на хостинге

import hashlib
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta
from functools import wraps

from flask import g, request
from werkzeug.security import check_password_hash, generate_password_hash

from .db import db, utcnow
from .models import Tariff, User, UserSession
from .util import ApiError

COOKIE = "cab_sid"
SESSION_DAYS = 30


def hash_password(p):
    return generate_password_hash(p)


def check_password(user, p):
    return check_password_hash(user.password_hash, p)


def validate_password(p):
    if len(p or "") < 8:
        raise ApiError("Пароль: минимум 8 символов")
    if len(p) > 200:
        raise ApiError("Пароль слишком длинный")


def _hash_token(t):
    return hashlib.sha256(t.encode()).hexdigest()


def client_ip():
    return (request.remote_addr or "")[:64]


def start_session(user):
    token = secrets.token_urlsafe(32)
    db.add(UserSession(user_id=user.id, token_hash=_hash_token(token),
                       user_agent=(request.headers.get("User-Agent") or "")[:300], ip=client_ip()))
    return token


def cookie_path():
    # Кабинет может жить в подпапке сайта (/secret/...): cookie только для неё
    return (request.script_root or "") + "/"


def set_cookie(resp, token):
    secure = os.environ.get("COOKIE_SECURE", "auto")
    is_secure = request.is_secure if secure == "auto" else secure == "1"
    resp.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="Lax", secure=is_secure,
                    path=cookie_path())
    return resp


def load_user():
    """Вызывается перед каждым /api запросом: находит пользователя по cookie."""
    g.user = None
    g.session = None
    token = request.cookies.get(COOKIE)
    if not token:
        return
    s = db.query(UserSession).filter_by(token_hash=_hash_token(token), revoked=False).first()
    if not s:
        return
    now = utcnow()
    if s.last_active < now - timedelta(days=SESSION_DAYS) or s.user.is_blocked:
        return
    if (now - s.last_active).total_seconds() > 60:
        s.last_active = now
        s.ip = client_ip()
        db.commit()
    expire_tariff(s.user)
    g.user = s.user
    g.session = s


def expire_tariff(user):
    """Истёкший платный тариф возвращается на тариф по умолчанию."""
    if user.tariff_until and user.tariff_until < utcnow():
        default = db.query(Tariff).filter_by(is_default=True).first()
        user.tariff_id = default.id if default else None
        user.tariff_until = None
        db.commit()


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not g.get("user"):
            raise ApiError("Требуется вход", 401)
        return fn(*a, **kw)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not g.get("user"):
            raise ApiError("Требуется вход", 401)
        if not g.user.is_admin:
            raise ApiError("Доступ только для администратора", 403)
        return fn(*a, **kw)
    return wrapper


# Простая защита от перебора паролей (на один процесс).
_attempts: dict[str, deque] = defaultdict(deque)
LIMIT, WINDOW = 10, 600


def check_rate(key, limit=LIMIT):
    now = time.time()
    q = _attempts[key]
    while q and q[0] < now - WINDOW:
        q.popleft()
    if len(q) >= limit:
        raise ApiError("Слишком много попыток. Попробуйте через 10 минут", 429)
    q.append(now)


def reset_rate(key):
    _attempts.pop(key, None)


def ensure_admin_from_env():
    """Первый администратор: ADMIN_LOGIN (или ADMIN_EMAIL) и ADMIN_PASSWORD."""
    from .services import norm_login
    login = norm_login(os.environ.get("ADMIN_LOGIN") or os.environ.get("ADMIN_EMAIL"))
    password = os.environ.get("ADMIN_PASSWORD") or ""
    if not login or not password:
        return
    u = db.query(User).filter_by(login=login).first()
    if u:
        if u.role != "admin":
            u.role = "admin"
    else:
        default = db.query(Tariff).filter_by(is_default=True).first()
        db.add(User(login=login, password_hash=hash_password(password), role="admin",
                    links_access=True, tariff_id=default.id if default else None))
    db.commit()
