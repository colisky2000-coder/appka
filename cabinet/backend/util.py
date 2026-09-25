import re
import secrets
from datetime import datetime

from flask import jsonify


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def ok(data=None, **kw):
    payload = {"ok": True}
    if data is not None:
        payload["data"] = data
    payload.update(kw)
    return jsonify(payload)


def rub(kop):
    return round((kop or 0) / 100, 2)


def to_kop(value, field="Сумма", allow_negative=False):
    try:
        v = round(float(str(value).replace(",", ".").replace(" ", "")) * 100)
    except (TypeError, ValueError):
        raise ApiError(f"{field}: введите число")
    if v < 0 and not allow_negative:
        raise ApiError(f"{field}: не может быть отрицательной")
    return v


def iso(dt: datetime | None):
    return dt.isoformat(timespec="seconds") + "Z" if dt else None


def parse_date(s, field="Дата"):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s)[:10])
    except ValueError:
        raise ApiError(f"{field}: неверный формат")


def clean_str(value, field, max_len=200, required=False):
    v = str(value or "").strip()
    if required and not v:
        raise ApiError(f"Заполните поле «{field}»")
    if len(v) > max_len:
        raise ApiError(f"Поле «{field}» слишком длинное (макс. {max_len})")
    return v


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean_email(value):
    v = clean_str(value, "Email", 255, required=True).lower()
    if not EMAIL_RE.match(v):
        raise ApiError("Неверный email")
    return v


def clean_inn(value):
    v = re.sub(r"\D", "", str(value or ""))
    if len(v) not in (10, 12):
        raise ApiError("ИНН должен содержать 10 или 12 цифр")
    return v


def clean_url(value, field="Ссылка", required=False):
    v = clean_str(value, field, 2000, required)
    if v and not re.match(r"^https?://", v, re.I):
        raise ApiError(f"{field}: ссылка должна начинаться с http:// или https://")
    return v


def new_code(n=8):
    alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(n))
