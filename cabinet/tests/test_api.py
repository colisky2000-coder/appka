import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import create_app  # noqa: E402
from backend.db import db  # noqa: E402

H = {"X-Requested-With": "fetch"}


SENT = []  # сообщения, которые «отправил» бот: (chat_id, text)


@pytest.fixture()
def app(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "admin@test.ru")
    monkeypatch.setenv("ADMIN_PASSWORD", "adminpass123")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:test")
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "test_bot")
    for k in ("SEED_DEMO", "PUBLIC_URL", "URL_PREFIX", "ADMIN_LOGIN"):
        monkeypatch.delenv(k, raising=False)
    from backend import auth, telegram
    auth._attempts.clear()
    SENT.clear()
    monkeypatch.setattr(telegram, "send", lambda chat_id, text, html=False: SENT.append((str(chat_id), text)))
    # TEST_DATABASE_URL=postgresql://... — прогнать тесты на Postgres
    url = os.environ.get("TEST_DATABASE_URL", "sqlite://")
    if url != "sqlite://":
        from backend import models  # noqa: F401
        from backend.db import Base, init_engine
        Base.metadata.drop_all(init_engine(url))
    return create_app(url)


def client(app):
    return app.test_client()


def post(c, url, json=None, **kw):
    return c.post(url, json=json, headers=H, **kw)


def login(app, login_, password):
    c = client(app)
    r = post(c, "/api/auth/login", {"login": login_, "password": password})
    assert r.status_code == 200, r.json
    return c


def admin_client(app):
    return login(app, "admin@test.ru", "adminpass123")


def make_invite(app, tariff_code=None, **kw):
    """Ссылка-приглашение (по умолчанию — на тариф по умолчанию); возвращает код."""
    admin = admin_client(app)
    tariffs = admin.get("/api/admin/r/tariffs").json["data"]
    t = next(t for t in tariffs if (t["code"] == tariff_code if tariff_code else t["is_default"]))
    r = post(admin, "/api/admin/invites", {"tariff_id": t["id"], **kw})
    assert r.status_code == 200, r.json
    return r.json["data"]["code"]


def tg_message(app, tg_id, text, username="tester", first_name="Тест"):
    from backend import bot
    with app.app_context():
        bot.handle_update({"message": {"text": text, "chat": {"id": tg_id, "type": "private"},
                                       "from": {"id": tg_id, "username": username, "first_name": first_name}}})
        db.remove()


def last_code(tg_id):
    for chat, text in reversed(SENT):
        m = re.search(r"<code>(\d{6})</code>", text)
        if chat == str(tg_id) and m:
            return m.group(1)
    return None


def signup(app, invite, tg_id=555, username="tester"):
    """Шаги 1–2 регистрации: ссылка на бота и «Запустить» в боте. Возвращает (клиент, токен)."""
    c = client(app)
    r = post(c, "/api/auth/tg/start", {"invite": invite})
    assert r.status_code == 200, r.json
    d = r.json["data"]
    assert d["url"] == f"https://t.me/test_bot?start=reg_{d['token']}"
    tg_message(app, tg_id, f"/start reg_{d['token']}", username)
    return c, d["token"]


def register(app, login_="user", password="userpass123", tg_id=555, invite=None, username="tester"):
    c, token = signup(app, invite or make_invite(app), tg_id, username)
    r = post(c, "/api/auth/tg/check", {"token": token, "code": last_code(tg_id)})
    assert r.status_code == 200, r.json
    r = post(c, "/api/auth/register", {"token": token, "login": login_, "password": password})
    assert r.status_code == 200, r.json
    return c


def test_auth_flow(app):
    c = client(app)
    assert c.get("/api/me").status_code == 401
    # Без приглашения зарегистрироваться нельзя
    assert post(c, "/api/auth/tg/start", {}).status_code == 404
    assert post(c, "/api/auth/tg/start", {"invite": "nope"}).status_code == 404
    assert post(c, "/api/auth/register", {"login": "x", "password": "12345678"}).status_code == 400

    c, token = signup(app, make_invite(app), username="Tester")
    code = last_code(555)
    assert code and len(code) == 6
    # Пока код не введён, логин и пароль задать нельзя
    assert post(c, "/api/auth/register", {"token": token, "login": "user", "password": "userpass123"}).status_code == 400
    assert post(c, "/api/auth/tg/check", {"token": token, "code": "000000" if code != "000000" else "111111"}).status_code == 400
    r = post(c, "/api/auth/tg/check", {"token": token, "code": code})
    assert r.status_code == 200 and r.json["data"]["login"] == "tester"  # логин по умолчанию — username
    assert post(c, "/api/auth/register", {"token": token, "login": "Плохой логин", "password": "userpass123"}).status_code == 400
    assert post(c, "/api/auth/register", {"token": token, "login": "admin@test.ru", "password": "userpass123"}).status_code == 400
    assert post(c, "/api/auth/register", {"token": token, "login": "user", "password": "short"}).status_code == 400
    r = post(c, "/api/auth/register", {"token": token, "login": "@User", "password": "userpass123"})
    assert r.status_code == 200, r.json
    me = c.get("/api/me").json["data"]
    assert me["login"] == "user" and me["username"] == "Tester" and me["role"] == "user"
    assert me["tariff"]["code"] == "basic" and me["telegram_linked"] and me["display_name"] == "Тест"
    # Токен одноразовый
    assert post(client(app), "/api/auth/register", {"token": token, "login": "user2", "password": "userpass123"}).status_code == 400
    # Тот же Telegram второй раз не регистрируется: бот не присылает код
    c2, token2 = signup(app, make_invite(app))
    assert "уже зарегистрирован" in SENT[-1][1]
    assert post(c2, "/api/auth/tg/check", {"token": token2, "code": "123456"}).status_code == 400
    # CSRF: без заголовка изменяющий запрос отклоняется
    assert c.post("/api/auth/logout").status_code == 400
    assert post(c, "/api/auth/logout").status_code == 200
    assert c.get("/api/me").status_code == 401
    # Вход — по логину и паролю
    assert post(client(app), "/api/auth/login", {"login": "user", "password": "wrong"}).status_code == 401
    login(app, "@USER", "userpass123")


def test_code_attempts_limited(app):
    c, token = signup(app, make_invite(app))
    code = last_code(555)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert post(c, "/api/auth/tg/check", {"token": token, "code": wrong}).status_code == 400
    assert post(c, "/api/auth/tg/check", {"token": token, "code": code}).status_code == 429
    # Новая ссылка на бота — новый код
    c, token = signup(app, make_invite(app))
    assert post(c, "/api/auth/tg/check", {"token": token, "code": last_code(555)}).status_code == 200


def test_invites(app):
    admin = admin_client(app)
    one = make_invite(app, max_uses=1, days=10, title="Поток 1")
    register(app, invite=one)
    me = login(app, "user", "userpass123").get("/api/me").json["data"]
    assert me["tariff_until"]  # доступ на 10 дней
    # Лимит исчерпан
    assert post(client(app), "/api/auth/tg/start", {"invite": one}).status_code == 404
    inv = next(i for i in admin.get("/api/admin/invites").json["data"] if i["code"] == one)
    assert inv["uses"] == 1 and not inv["usable"] and inv["url"].endswith(f"/join/{one}")
    assert [u["login"] for u in admin.get(f"/api/admin/users?invite={inv['id']}").json["data"]] == ["user"]
    # Выключенная и просроченная ссылки не работают
    two = make_invite(app)
    inv2 = next(i for i in admin.get("/api/admin/invites").json["data"] if i["code"] == two)
    assert admin.patch(f"/api/admin/invites/{inv2['id']}", json={"is_active": False}, headers=H).status_code == 200
    assert client(app).get(f"/api/invite/{two}").status_code == 404
    assert admin.patch(f"/api/admin/invites/{inv2['id']}", json={"is_active": True, "expires_at": "2020-01-01"}, headers=H).status_code == 200
    assert client(app).get(f"/api/invite/{two}").status_code == 404
    admin.patch(f"/api/admin/invites/{inv2['id']}", json={"expires_at": ""}, headers=H)
    assert client(app).get(f"/api/invite/{two}").json["data"]["tariff"] == "BASIC"
    # Удаление ссылки не трогает пользователей
    assert admin.delete(f"/api/admin/invites/{inv['id']}", headers=H).status_code == 200
    assert admin.get(f"/api/admin/users?invite={inv['id']}").json["data"] == []
    assert login(app, "user", "userpass123").get("/api/me").status_code == 200


def test_old_tariff_invite_is_migrated(app):
    from backend.models import Invite, Setting, Tariff
    from backend.seed import INVITES_FLAG, migrate_invites
    with app.app_context():
        t = db.query(Tariff).filter_by(code="basic").first()
        t.invite_enabled, t.invite_code, t.invite_days = True, "oldcode123", 7
        db.delete(db.get(Setting, INVITES_FLAG))
        db.commit()
        migrate_invites()
        inv = db.query(Invite).filter_by(code="oldcode123").first()
        assert inv and inv.tariff_id == t.id and inv.days == 7
        db.remove()
    assert client(app).get("/api/invite/oldcode123").status_code == 200


def test_telegram_link_for_old_account(app):
    admin = admin_client(app)
    url = post(admin, "/api/me/telegram").json["data"]["url"]
    tg_message(app, 777, "/start " + url.rsplit("=", 1)[1], username="boss")
    me = admin.get("/api/me").json["data"]
    assert me["telegram_linked"] and me["username"] == "boss"
    assert "привязан" in SENT[-1][1]
    # Этот Telegram уже занят — зарегистрировать им новый аккаунт нельзя
    signup(app, make_invite(app), tg_id=777)
    assert "уже зарегистрирован" in SENT[-1][1]
    # Сообщение без ссылки — подсказка
    tg_message(app, 999, "привет")
    assert "по ссылке-приглашению" in SENT[-1][1]


def test_webhook_secret(app, monkeypatch):
    from backend import telegram
    c = client(app)
    upd = {"message": {"text": "/start", "chat": {"id": 1, "type": "private"}, "from": {"id": 1}}}
    assert c.post("/tg/webhook", json=upd).status_code == 403
    r = c.post("/tg/webhook", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": telegram.webhook_secret()})
    assert r.status_code == 200 and SENT[-1][0] == "1"


def test_password_change_and_sessions(app):
    c1 = register(app)
    c2 = login(app, "user", "userpass123")
    assert len(c1.get("/api/me/sessions").json["data"]) == 2
    r = post(c1, "/api/auth/password", {"current": "userpass123", "password": "newpass12345"})
    assert r.status_code == 200
    assert c2.get("/api/me").status_code == 401  # другие сессии завершены
    assert c1.get("/api/me").status_code == 200
    login(app, "user", "newpass12345")


def test_non_admin_blocked_from_admin(app):
    c = register(app)
    assert c.get("/api/admin/overview").status_code == 403


def test_offers_and_links(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    r = post(admin, "/api/admin/r/offers", {"partner": "Банк", "name": "Карта", "type": "Карта", "payout": "10000", "limit_default": 100})
    assert r.status_code == 200, r.json
    oid = r.json["data"]["id"]

    u = register(app)
    offers = u.get("/api/offers").json["data"]
    assert offers["offers"][0]["payout"] == 10000
    assert offers["links_access"] is False
    assert post(u, f"/api/offers/{oid}/link").status_code == 403
    assert post(u, "/api/access-request", {}).status_code == 200

    uid = admin.get("/api/admin/users?q=user").json["data"][0]["id"]
    assert admin.patch(f"/api/admin/users/{uid}", json={"links_access": True}, headers=H).status_code == 200

    link = post(u, f"/api/offers/{oid}/link").json["data"]
    assert link["status"] == "requested"  # партнёрский API — заглушка

    admin_links = admin.get("/api/admin/links?status=requested").json["data"]
    assert admin.patch(f"/api/admin/links/{admin_links[0]['id']}", json={"url": "https://partner.example/ref"}, headers=H).status_code == 200

    link = post(u, f"/api/offers/{oid}/link").json["data"]
    assert link["status"] == "active" and "/go/" in link["url"]
    code = link["url"].rsplit("/", 1)[1]

    anon = client(app)
    r = anon.get(f"/go/{code}?sub=tg")
    assert r.status_code == 302 and r.headers["Location"] == "https://partner.example/ref"
    anon.get(f"/go/{code}")

    # публичной формы заявки больше нет
    assert anon.get(f"/f/{code}").status_code == 404

    stats = u.get("/api/stats").json["data"]
    assert stats["totals"]["clicks"] == 2
    assert u.get("/api/stats?unique=1").json["data"]["totals"]["clicks"] == 1
    assert u.get("/api/stats.csv").status_code == 200

    # избранное
    assert post(u, f"/api/offers/{oid}/favorite").json["data"]["favorite"] is True
    assert u.get("/api/offers").json["data"]["offers"][0]["favorite"] is True


def test_conversion_status_and_income_and_top(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    oid = post(admin, "/api/admin/r/offers", {"partner": "Б", "name": "Карта", "payout": "1500"}).json["data"]["id"]
    u = register(app)
    r = post(u, "/api/conversions", {"offer_id": oid, "inn": "7707083893", "fio": "Петров П.П."})
    assert r.status_code == 200, r.json
    cid = r.json["data"]["id"]
    assert post(u, "/api/conversions", {"offer_id": oid, "inn": "12", "fio": "x"}).status_code == 400

    assert admin.patch(f"/api/admin/conversions/{cid}", json={"status": "approved", "amount": "2000"}, headers=H).status_code == 200
    inc = u.get("/api/income").json["data"]
    assert inc["summary"]["available"] == 2000
    dash = u.get("/api/dashboard").json["data"]
    assert dash["top30"]["top"][0]["me"] is True and dash["top30"]["top"][0]["sum"] == 2000

    assert post(admin, "/api/admin/conversions/bulk", {"ids": [cid], "status": "paid"}).status_code == 200
    assert u.get("/api/income").json["data"]["summary"]["paid"] == 2000
    assert admin.get("/api/admin/conversions.csv").status_code == 200


def test_topup_balance(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    u = register(app)
    assert u.get("/api/traffic").status_code == 404
    assert post(u, "/api/topups", {"amount": 100}).status_code == 200
    tid = admin.get("/api/admin/topups?status=pending").json["data"][0]["id"]
    assert post(admin, f"/api/admin/topups/{tid}/approve", {}).status_code == 200
    assert post(admin, f"/api/admin/topups/{tid}/approve", {}).status_code == 400  # повторно нельзя
    b = u.get("/api/balance").json["data"]
    assert b["balance"] == 100 and b["topups"][0]["status"] == "approved"


def test_tariff_purchase(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    tid = post(admin, "/api/admin/r/tariffs", {"code": "pro", "name": "PRO", "price": "50", "rate": 120, "level": 1}).json["data"]["id"]
    oid = post(admin, "/api/admin/r/offers", {"partner": "Б", "name": "О", "payout": "1000"}).json["data"]["id"]
    u = register(app)
    assert post(u, f"/api/tariffs/{tid}/buy").status_code == 400
    uid = admin.get("/api/admin/users?q=user").json["data"][0]["id"]
    post(admin, f"/api/admin/users/{uid}/balance", {"amount": "60"})
    me = post(u, f"/api/tariffs/{tid}/buy").json["data"]
    assert me["tariff"]["code"] == "pro" and me["balance"] == 10 and me["tariff_until"]
    assert u.get("/api/offers").json["data"]["offers"][0]["payout"] == 1200


def test_articles_by_tariff_and_materials(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    tid = post(admin, "/api/admin/r/tariffs", {"code": "pro", "name": "PRO", "level": 1}).json["data"]["id"]
    post(admin, "/api/admin/r/articles", {"title": "Открытая", "body": "текст"})
    post(admin, "/api/admin/r/articles", {"title": "Закрытая", "min_tariff_id": tid})
    post(admin, "/api/admin/r/articles", {"title": "Черновик", "is_published": False})
    import io
    r = admin.post("/api/admin/materials", headers=H, content_type="multipart/form-data",
                   data={"title": "Файл", "file": (io.BytesIO(b"hello"), "f.txt")})
    assert r.status_code == 200, r.json
    u = register(app)
    titles = [a["title"] for a in u.get("/api/articles").json["data"]]
    assert titles == ["Открытая"]
    mid = u.get("/api/materials").json["data"][0]["id"]
    assert u.get(f"/api/materials/{mid}/download").data == b"hello"


def test_tickets_and_news(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    post(admin, "/api/admin/r/news", {"title": "Новость", "body": "текст"})
    u = register(app)
    assert u.get("/api/dashboard").json["data"]["unread"] == 1
    nid = u.get("/api/news").json["data"][0]["id"]
    post(u, f"/api/news/{nid}/read")
    assert u.get("/api/dashboard").json["data"]["unread"] == 0

    tid = post(u, "/api/tickets", {"subject": "Вопрос", "body": "Помогите"}).json["data"]["id"]
    post(admin, f"/api/admin/tickets/{tid}/messages", {"body": "Ответ"})
    t = u.get(f"/api/tickets/{tid}").json["data"]
    assert t["status"] == "answered" and t["messages"][-1]["is_admin"] is True
    other = register(app, "other", tg_id=556, username="other")
    assert other.get(f"/api/tickets/{tid}").status_code == 404


def test_settings_and_tariff_features(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    assert admin.put("/api/admin/settings", json={"brand_name": "Тест"}, headers=H).status_code == 200
    u = register(app)
    cfg = u.get("/api/config").json["data"]
    assert cfg["settings"]["brand_name"] == "Тест"
    assert "support" in cfg["me"]["features"] and "learning" not in cfg["me"]["features"]
    assert "traffic" not in cfg["me"]["features"]
    assert u.get("/api/tickets").status_code == 200

    # Снимаем галочку «Поддержка» у тарифа по умолчанию
    basic = next(t for t in admin.get("/api/admin/r/tariffs").json["data"] if t["is_default"])
    feats = [f for f in basic["features"] if f != "support"]
    assert admin.put(f"/api/admin/r/tariffs/{basic['id']}", json={"features": feats}, headers=H).status_code == 200
    assert "support" not in u.get("/api/me").json["data"]["features"]
    assert u.get("/api/tickets").status_code == 403
    # Открытой регистрации больше нет — настройка ни на что не влияет
    assert "allow_registration" not in cfg["settings"]


def test_block_user(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    u = register(app)
    uid = admin.get("/api/admin/users?q=user").json["data"][0]["id"]
    admin.patch(f"/api/admin/users/{uid}", json={"is_blocked": True}, headers=H)
    assert u.get("/api/me").status_code == 401
    assert post(client(app), "/api/auth/login", {"login": "user", "password": "userpass123"}).status_code == 403
    me = admin.get("/api/me").json["data"]["id"]
    assert admin.patch(f"/api/admin/users/{me}", json={"role": "user"}, headers=H).status_code == 400
