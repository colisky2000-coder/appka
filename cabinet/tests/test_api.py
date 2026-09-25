import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import create_app  # noqa: E402
from backend.db import db  # noqa: E402
from backend.models import TrafficRow, User  # noqa: E402

H = {"X-Requested-With": "fetch"}


@pytest.fixture()
def app(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "admin@test.ru")
    monkeypatch.setenv("ADMIN_PASSWORD", "adminpass123")
    monkeypatch.delenv("SEED_DEMO", raising=False)
    from backend import auth
    auth._attempts.clear()
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


def login(app, email, password):
    c = client(app)
    r = post(c, "/api/auth/login", {"email": email, "password": password})
    assert r.status_code == 200, r.json
    return c


def register(app, email="user@test.ru", password="userpass123"):
    c = client(app)
    r = post(c, "/api/auth/register", {"email": email, "password": password, "username": "@tester"})
    assert r.status_code == 200, r.json
    return c


def test_auth_flow(app):
    c = client(app)
    assert c.get("/api/me").status_code == 401
    assert post(c, "/api/auth/register", {"email": "bad", "password": "12345678"}).status_code == 400
    assert post(c, "/api/auth/register", {"email": "a@b.ru", "password": "short"}).status_code == 400
    c = register(app)
    me = c.get("/api/me").json["data"]
    assert me["email"] == "user@test.ru" and me["username"] == "tester" and me["role"] == "user"
    assert me["tariff"]["code"] == "basic"
    # CSRF: без заголовка изменяющий запрос отклоняется
    assert c.post("/api/auth/logout").status_code == 400
    assert post(c, "/api/auth/logout").status_code == 200
    assert c.get("/api/me").status_code == 401
    assert post(client(app), "/api/auth/login", {"email": "user@test.ru", "password": "wrong"}).status_code == 401


def test_password_change_and_sessions(app):
    c1 = register(app)
    c2 = login(app, "user@test.ru", "userpass123")
    assert len(c1.get("/api/me/sessions").json["data"]) == 2
    r = post(c1, "/api/auth/password", {"current": "userpass123", "password": "newpass12345"})
    assert r.status_code == 200
    assert c2.get("/api/me").status_code == 401  # другие сессии завершены
    assert c1.get("/api/me").status_code == 200
    login(app, "user@test.ru", "newpass12345")


def test_non_admin_blocked_from_admin(app):
    c = register(app)
    assert c.get("/api/admin/overview").status_code == 403


def test_offers_links_and_form(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    r = post(admin, "/api/admin/r/offers", {"partner": "Банк", "name": "РКО", "type": "РКО", "payout": "10000", "limit_default": 100})
    assert r.status_code == 200, r.json
    oid = r.json["data"]["id"]

    u = register(app)
    offers = u.get("/api/offers").json["data"]
    assert offers["offers"][0]["payout"] == 10000
    assert offers["links_access"] is False
    assert post(u, f"/api/offers/{oid}/link").status_code == 403
    assert post(u, "/api/access-request", {}).status_code == 200

    uid = admin.get("/api/admin/users?q=user@").json["data"][0]["id"]
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

    # форма выключена -> 404, включаем
    assert anon.get(f"/f/{code}").status_code == 404
    assert u.patch(f"/api/links/{link['id']}", json={"form_enabled": True}, headers=H).status_code == 200
    assert anon.get(f"/f/{code}").status_code == 200
    r = anon.post(f"/f/{code}", data={"inn": "123", "fio": "Иван"})
    assert "ИНН" in r.get_data(as_text=True)
    r = anon.post(f"/f/{code}", data={"inn": "7707083893", "fio": "Иванов Иван"})
    assert r.status_code == 302

    convs = u.get("/api/conversions").json["data"]
    assert len(convs) == 1 and convs[0]["source"] == "form" and convs[0]["amount"] == 10000

    stats = u.get("/api/stats").json["data"]
    assert stats["totals"]["clicks"] == 2 and stats["totals"]["conversions"] == 1
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


def test_traffic_topup_and_purchase(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    assert post(admin, "/api/admin/traffic/rows", {"text": "a,1\nb,2\nc,3\n\n"}).json["data"]["added"] == 3
    u = register(app)
    t = u.get("/api/traffic").json["data"]
    assert t["available"] == 3 and t["price"] == 15
    assert "Недостаточно" in post(u, "/api/traffic/buy", {"rows": 2}).json["error"]
    assert "свободно 3" in post(u, "/api/traffic/buy", {"rows": 5}).json["error"]

    assert post(u, "/api/topups", {"amount": 100}).status_code == 200
    tid = admin.get("/api/admin/topups?status=pending").json["data"][0]["id"]
    assert post(admin, f"/api/admin/topups/{tid}/approve", {}).status_code == 200
    assert post(admin, f"/api/admin/topups/{tid}/approve", {}).status_code == 400  # повторно нельзя

    r = post(u, "/api/traffic/buy", {"rows": 2})
    assert r.status_code == 200, r.json
    t = u.get("/api/traffic").json["data"]
    assert t["balance"] == 70 and t["available"] == 1 and t["bought_rows"] == 2
    dl = u.get(f"/api/traffic/purchases/{r.json['data']['id']}/download").get_data(as_text=True)
    assert dl.splitlines() == ["a,1", "b,2"]


def test_tariff_purchase(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    tid = post(admin, "/api/admin/r/tariffs", {"code": "pro", "name": "PRO", "price": "50", "rate": 120, "level": 1}).json["data"]["id"]
    oid = post(admin, "/api/admin/r/offers", {"partner": "Б", "name": "О", "payout": "1000"}).json["data"]["id"]
    u = register(app)
    assert post(u, f"/api/tariffs/{tid}/buy").status_code == 400
    uid = admin.get("/api/admin/users?q=user@").json["data"][0]["id"]
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
    other = register(app, "other@test.ru")
    assert other.get(f"/api/tickets/{tid}").status_code == 404


def test_settings_and_tariff_features(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    assert admin.put("/api/admin/settings", json={"brand_name": "Тест"}, headers=H).status_code == 200
    u = register(app)
    cfg = u.get("/api/config").json["data"]
    assert cfg["settings"]["brand_name"] == "Тест"
    assert "traffic" in cfg["me"]["features"] and "learning" not in cfg["me"]["features"]
    assert u.get("/api/traffic").status_code == 200

    # Снимаем галочку «Закуп трафика» у тарифа по умолчанию
    basic = next(t for t in admin.get("/api/admin/r/tariffs").json["data"] if t["is_default"])
    feats = [f for f in basic["features"] if f != "traffic"]
    assert admin.put(f"/api/admin/r/tariffs/{basic['id']}", json={"features": feats}, headers=H).status_code == 200
    assert "traffic" not in u.get("/api/me").json["data"]["features"]
    assert u.get("/api/traffic").status_code == 403

    admin.put("/api/admin/settings", json={"allow_registration": False}, headers=H)
    assert post(client(app), "/api/auth/register", {"email": "x@y.ru", "password": "12345678"}).status_code == 403


def test_block_user(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    u = register(app)
    uid = admin.get("/api/admin/users?q=user@").json["data"][0]["id"]
    admin.patch(f"/api/admin/users/{uid}", json={"is_blocked": True}, headers=H)
    assert u.get("/api/me").status_code == 401
    assert post(client(app), "/api/auth/login", {"email": "user@test.ru", "password": "userpass123"}).status_code == 403
    me = admin.get("/api/me").json["data"]["id"]
    assert admin.patch(f"/api/admin/users/{me}", json={"role": "user"}, headers=H).status_code == 400
