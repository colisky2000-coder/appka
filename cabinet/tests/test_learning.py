import io
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import media  # noqa: E402
from test_api import H, app, client, login, post, register  # noqa: E402,F401

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def intensive(admin):
    return next(t for t in admin.get("/api/admin/r/tariffs").json["data"] if t["code"] == "intensive")


def test_intensive_seeded_and_invite(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    t = intensive(admin)
    assert t["features"] == ["learning", "support"] and t["program_id"] and t["invite_enabled"]
    # Регистрация по приглашению работает даже при закрытой регистрации
    admin.put("/api/admin/settings", json={"allow_registration": False}, headers=H)
    c = client(app)
    assert c.get(f"/api/invite/{t['invite_code']}").json["data"]["tariff"] == "Интенсив"
    r = post(c, "/api/auth/register", {"email": "st@test.ru", "password": "student123", "invite": t["invite_code"]})
    assert r.status_code == 200, r.json
    me = c.get("/api/me").json["data"]
    assert me["tariff"]["code"] == "intensive" and me["features"] == ["learning", "support"]
    assert c.get("/api/dashboard").status_code == 403
    assert c.get("/api/offers").status_code == 403
    assert c.get("/api/learn").status_code == 200
    assert client(app).get(f"/join/{t['invite_code']}").headers["Location"].endswith(f"/#/join/{t['invite_code']}")
    # Перевыпуск кода — старая ссылка перестаёт работать
    post(admin, f"/api/admin/tariffs/{t['id']}/invite")
    assert client(app).get(f"/api/invite/{t['invite_code']}").status_code == 404


def test_invite_activates_for_existing_user(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    t = intensive(admin)
    admin.put(f"/api/admin/r/tariffs/{t['id']}", json={"invite_days": 30}, headers=H)
    u = register(app)
    me = post(u, f"/api/invite/{t['invite_code']}/activate").json["data"]
    assert me["tariff"]["code"] == "intensive" and me["tariff_until"]


def student(app, admin):
    t = intensive(admin)
    c = client(app)
    post(c, "/api/auth/register", {"email": "st@test.ru", "password": "student123", "invite": t["invite_code"]})
    return c


def test_roadmap_progress(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    s = student(app, admin)
    d = s.get("/api/learn").json["data"]
    assert d["program"]["title"] == "Интенсив"
    assert [st["title"] for st in d["steps"]] == ["Знакомство", "Первая практика", "Итоги"]
    assert d["progress"] == {"steps_done": 0, "steps_total": 3, "lessons_done": 0, "lessons_total": 2}
    first, second = d["steps"][0], d["steps"][1]
    assert first["target"]["type"] == "lesson" and first["target"]["title"].startswith("Урок 1.")
    assert d["current_step_id"] == first["id"]

    # Урок 1 пройден -> шаг без задач «Знакомство» закрывается сам
    l1 = first["target"]["id"]
    assert post(s, f"/api/lessons/{l1}/done", {"done": True}).status_code == 200
    d = s.get("/api/learn").json["data"]
    assert d["steps"][0]["done"] and d["current_step_id"] == second["id"]

    # Урок 2 показывает задачи шага; отмечаем их
    l2 = second["target"]["id"]
    lesson = s.get(f"/api/lessons/{l2}").json["data"]
    assert lesson["num"] == 2 and lesson["prev_id"] == l1 and lesson["next_id"] is None
    assert len(lesson["todo"]) == 2
    for t in lesson["todo"]:
        assert post(s, f"/api/tasks/{t['id']}/done", {"done": True}).status_code == 200
    d = s.get("/api/learn").json["data"]
    assert d["steps"][1]["done"] and d["progress"]["steps_done"] == 2

    # Снять отметку
    post(s, f"/api/tasks/{lesson['todo'][0]['id']}/done", {"done": False})
    assert not s.get("/api/learn").json["data"]["steps"][1]["done"]

    # Шаг с задачами нельзя закрыть «целиком»
    assert post(s, f"/api/steps/{second['id']}/done", {"done": True}).status_code == 400


def test_admin_builds_program(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    pid = post(admin, "/api/admin/r/programs", {"title": "Наставничество"}).json["data"]["id"]
    lid = post(admin, "/api/admin/r/lessons", {"program_id": pid, "title": "Вводный",
                                                "video_url": "https://rutube.ru/video/0123456789abcdef0123456789abcdef/"}).json["data"]["id"]
    r = post(admin, f"/api/admin/programs/{pid}/steps", {"title": "Шаг 1", "target_type": "lesson", "target_id": lid,
                                                          "tasks": [{"text": "Задача А"}, {"text": "Задача Б"}]})
    assert r.status_code == 200, r.json
    step = r.json["data"]
    ta, tb = step["tasks"]
    # Правка: переименовали А, удалили Б, добавили В — id А сохраняется
    r = admin.put(f"/api/admin/steps/{step['id']}", headers=H, json={
        "title": "Шаг 1", "target_type": "lesson", "target_id": lid,
        "tasks": [{"id": ta["id"], "text": "Задача А2"}, {"text": "Задача В"}]})
    tasks = r.json["data"]["tasks"]
    assert tasks[0] == {"id": ta["id"], "text": "Задача А2"} and tasks[1]["text"] == "Задача В"
    assert post(admin, f"/api/admin/programs/{pid}/steps", {"title": "Без цели", "target_type": "lesson"}).status_code == 400

    # Тариф с этой программой и только обучением
    tid = post(admin, "/api/admin/r/tariffs", {"code": "mentor", "name": "Наставничество", "features": ["learning"],
                                               "program_id": pid, "invite_enabled": True}).json["data"]["id"]
    code = next(t for t in admin.get("/api/admin/r/tariffs").json["data"] if t["id"] == tid)["invite_code"]
    c = client(app)
    post(c, "/api/auth/register", {"email": "m@test.ru", "password": "student123", "invite": code})
    d = c.get("/api/learn").json["data"]
    assert d["program"]["title"] == "Наставничество" and len(d["lessons"]) == 1
    les = c.get(f"/api/lessons/{lid}").json["data"]
    assert les["embed"] == "https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef?autoplay=1"
    # Чужой программы урок недоступен
    other_lesson = admin.get("/api/admin/r/lessons").json["data"]
    foreign = next(l for l in other_lesson if l["program_id"] != pid)
    assert c.get(f"/api/lessons/{foreign['id']}").status_code == 404

    # Порядок шагов
    s2 = post(admin, f"/api/admin/programs/{pid}/steps", {"title": "Шаг 2"}).json["data"]
    post(admin, "/api/admin/reorder/steps", {"ids": [s2["id"], step["id"]]})
    assert [x["title"] for x in admin.get(f"/api/admin/programs/{pid}/steps").json["data"]] == ["Шаг 2", "Шаг 1"]


def test_article_placement(app):
    admin = login(app, "admin@test.ru", "adminpass123")
    pid = intensive(admin)["program_id"]
    post(admin, "/api/admin/r/articles", {"title": "Только в мануалах"})
    post(admin, "/api/admin/r/articles", {"title": "Только в интенсиве", "show_in_manuals": False, "program_ids": [pid]})
    post(admin, "/api/admin/r/articles", {"title": "Везде", "program_ids": [pid]})
    r = admin.post("/api/admin/materials", headers=H, content_type="multipart/form-data",
                   data={"title": "Файл курса", "show_in_manuals": "0", "program_ids": [str(pid)],
                         "file": (io.BytesIO(b"x"), "a.txt")})
    assert r.status_code == 200, r.json
    u = register(app)
    assert sorted(a["title"] for a in u.get("/api/articles").json["data"]) == ["Везде", "Только в мануалах"]
    assert u.get("/api/materials").json["data"] == []
    s = student(app, admin)
    titles = sorted(x["title"] for x in s.get("/api/learn/materials").json["data"])
    assert titles == ["Везде", "Только в интенсиве", "Файл курса"]
    art = next(x for x in s.get("/api/learn/materials").json["data"] if x["title"] == "Только в интенсиве")
    assert s.get(f"/api/articles/{art['id']}").status_code == 200
    manual_only = next(a for a in u.get("/api/articles").json["data"] if a["title"] == "Только в мануалах")
    assert s.get(f"/api/articles/{manual_only['id']}").status_code == 404


def test_covers(app, monkeypatch):
    admin = login(app, "admin@test.ru", "adminpass123")
    aid = post(admin, "/api/admin/r/articles", {"title": "С превью", "url": "https://teletype.in/@x/post"}).json["data"]["id"]

    # Загрузка файла
    r = admin.post(f"/api/admin/cover/articles/{aid}", headers=H, content_type="multipart/form-data",
                   data={"file": (io.BytesIO(PNG), "c.png")})
    assert r.status_code == 200, r.json
    link = r.json["data"]["cover"]
    assert link.startswith(f"/media/articles/{aid}/cover")
    u = register(app)
    img = u.get(link)
    assert img.status_code == 200 and img.data == PNG and img.mimetype == "image/png"
    assert client(app).get(link).status_code == 404  # без входа не отдаём
    assert admin.post(f"/api/admin/cover/articles/{aid}", headers=H, content_type="multipart/form-data",
                      data={"file": (io.BytesIO(b"not image"), "c.png")}).status_code == 400

    # Автоподбор со страницы (сеть подменяем)
    html = b'<html><head><meta property="og:image" content="/img/cover.png"></head></html>'

    def fake_fetch(url, max_bytes, timeout=10):
        if url == "https://teletype.in/@x/post":
            return html, "text/html", url
        assert url == "https://teletype.in/img/cover.png"
        return PNG, "image/png", url
    monkeypatch.setattr(media, "fetch", fake_fetch)
    r = post(admin, f"/api/admin/cover/articles/{aid}", {"auto": True})
    assert r.status_code == 200, r.json
    assert u.get(r.json["data"]["cover"]).data == PNG

    # Если картинку не скачать — остаётся внешняя ссылка
    def broken(url, max_bytes, timeout=10):
        raise media.ApiError("нет сети")
    monkeypatch.setattr(media, "fetch", broken)
    r = post(admin, f"/api/admin/cover/articles/{aid}", {"url": "https://cdn.example.com/p.jpg"})
    assert r.json["data"]["cover"] == "https://cdn.example.com/p.jpg"
    assert admin.delete(f"/api/admin/cover/articles/{aid}", headers=H).status_code == 200
    assert u.get("/api/articles").json["data"][0]["cover"] is None


def test_media_helpers():
    assert media.parse_og_image('<meta content="https://a.ru/i.jpg" property="og:image" />', "https://a.ru/") == "https://a.ru/i.jpg"
    assert media.parse_og_image("<meta name='twitter:image' content='x.png'>", "https://b.ru/p/") == "https://b.ru/p/x.png"
    assert media.parse_og_image("<p>нет</p>", "https://a.ru") is None
    assert media.video_embed("https://youtu.be/dQw4w9WgXcQ") == "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0"
    assert media.video_embed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5").startswith("https://www.youtube.com/embed/dQw4w9WgXcQ")
    assert media.video_embed("https://vkvideo.ru/video-12345_678901") == "https://vk.com/video_ext.php?oid=-12345&id=678901&hd=2&autoplay=1"
    assert media.video_embed("https://example.com/video.mp4") is None
    assert media.find_preview_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    with pytest.raises(media.ApiError):
        media.fetch("http://127.0.0.1/secret", 100)
