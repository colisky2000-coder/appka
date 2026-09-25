"""Разделы сайта, которые включаются галочками в тарифе."""
import json

from flask import g

from .util import ApiError

# (ключ, название в админке)
FEATURES = [
    ("dashboard", "Дашборд (главная, топ, новости)"),
    ("learning", "Обучение (роадмап, уроки, материалы)"),
    ("manuals", "Мануалы (база знаний)"),
    ("offers", "Партнёрка: офферы"),
    ("favorites", "Партнёрка: избранное и ссылки"),
    ("conversions", "Партнёрка: заявки"),
    ("stats", "Партнёрка: статистика"),
    ("income", "Доходы"),
    ("support", "Поддержка"),
    ("billing", "Подписка (смена тарифа)"),
]
KEYS = [k for k, _ in FEATURES]
# Если в тарифе галочки ещё не настраивали — всё, кроме обучения
DEFAULT = [k for k in KEYS if k != "learning"]


def parse(raw):
    if not raw:
        return list(DEFAULT)
    try:
        items = json.loads(raw)
    except ValueError:
        return list(DEFAULT)
    return [k for k in items if k in KEYS]


def dump(items):
    return json.dumps([k for k in KEYS if k in set(items or [])])


def user_features(user):
    if user is None:
        return []
    if user.is_admin:
        return list(KEYS)
    return parse(user.tariff.features if user.tariff else "")


def has(user, *keys):
    """True, если у пользователя есть хотя бы один из разделов."""
    feats = user_features(user)
    return any(k in feats for k in keys)


def require(*keys):
    if not has(g.user, *keys):
        raise ApiError("Раздел недоступен на вашем тарифе", 403)
