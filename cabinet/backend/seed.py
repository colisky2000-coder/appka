"""Начальные данные: тарифы по умолчанию, пример программы «Интенсив» и (по желанию) демо-контент."""
import os

from . import features
from .db import db
from .models import Article, Lesson, News, Offer, Program, Setting, Step, StepTask, Tariff, TeamMember, TrafficRow
from .util import new_code

INTENSIVE_FLAG = "_seeded_intensive"


def seed_defaults():
    if not db.query(Tariff).first():
        db.add(Tariff(code="basic", name="BASIC", price=0, rate=100, level=0, is_default=True,
                      description="Базовый доступ к кабинету", features=features.dump(features.DEFAULT),
                      invite_code=new_code(12)))
        db.commit()
    # У тарифов, созданных до появления ссылок-приглашений, заполняем код
    for t in db.query(Tariff).filter(Tariff.invite_code == ""):
        t.invite_code = new_code(12)
    db.commit()
    seed_intensive()


def seed_intensive():
    """Один раз создаёт тариф «Интенсив» с примером программы — дальше всё правится в админке."""
    if db.get(Setting, INTENSIVE_FLAG) or db.query(Program).first():
        return
    p = Program(title="Интенсив", description="Пошаговая программа: смотрите уроки и отмечайте задачи на роадмапе.")
    db.add(p)
    db.flush()
    l1 = Lesson(program_id=p.id, sort=1, title="Знакомство с программой", duration="10 мин",
                body="Это пример урока. Вставьте ссылку на видео (RuTube, VK Видео, YouTube) и текст "
                     "в «Админка → Обучение».\n\n## Что будет в уроке\n- пункт первый\n- пункт второй")
    l2 = Lesson(program_id=p.id, sort=2, title="Первая практика", duration="20 мин",
                body="Пример второго урока. Под видео можно писать пояснения, списки и ссылки.")
    db.add_all([l1, l2])
    db.flush()
    s1 = Step(program_id=p.id, sort=1, title="Знакомство", target_type="lesson", target_id=l1.id,
              description="Посмотрите первый урок — шаг отметится, когда нажмёте «Урок пройден».")
    s2 = Step(program_id=p.id, sort=2, title="Первая практика", target_type="lesson", target_id=l2.id,
              description="Посмотрите урок 2 и выполните задания.")
    s2.tasks = [StepTask(text="Посмотреть урок 2", sort=0), StepTask(text="Выполнить задание из урока", sort=1)]
    s3 = Step(program_id=p.id, sort=3, title="Итоги", description="Подведите итоги первой недели.")
    s3.tasks = [StepTask(text="Написать куратору о результатах", sort=0)]
    db.add_all([s1, s2, s3])
    if not db.query(Tariff).filter_by(code="intensive").first():
        db.add(Tariff(code="intensive", name="Интенсив", price=0, level=0, is_public=False,
                      description="Доступ к обучающей программе", program_id=p.id,
                      features=features.dump(["learning", "support"]),
                      invite_enabled=True, invite_code=new_code(12)))
    db.add(Setting(key=INTENSIVE_FLAG, value="1"))
    db.commit()


def seed_demo():
    """Демо-контент для первого запуска (SEED_DEMO=1). Только если база пустая."""
    if os.environ.get("SEED_DEMO") != "1" or db.query(Offer).first():
        return
    db.add(Tariff(code="pro", name="PRO", price=99000, period_days=30, rate=110, level=1,
                  description="Повышенные ставки и закрытые материалы", features=features.dump(features.DEFAULT),
                  invite_code=new_code(12)))
    db.add_all([
        Offer(partner="Партнёр А", name="Расчётный счёт", type="РКО", payout=1000000, tax_note="−7% налог",
              description="Открытие расчётного счёта. Целевое действие — активация счёта.", limit_default=250, sort=1),
        Offer(partner="Партнёр А", name="Дебетовая карта", type="Дебетовая карта", payout=160000, tax_note="−7% налог",
              description="Оформление и активация дебетовой карты.", limit_default=500, sort=2),
        Offer(partner="Партнёр Б", name="Расчётный счёт", type="РКО", payout=800000,
              description="Открытие расчётного счёта для ИП и ООО.", sort=3),
    ])
    db.add_all([
        Article(title="С чего начать", description="Первые шаги в кабинете", category="Старт",
                body="Здесь будет вводная статья.\n\nТекст редактируется в админке → Статьи."),
        Article(title="Как работать с заявками", description="Статусы и выплаты", category="Партнёрка",
                body="Описание статусов заявок и порядка выплат."),
    ])
    db.add(News(title="Кабинет запущен", body="Это пример новости. Новости добавляются в админке → Новости."))
    db.add_all([
        TeamMember(name="Администратор", role="Вопросы по кабинету", links="@your_support", sort=1),
    ])
    db.add_all([TrafficRow(data=f"7900000{i:04d}, {1000 + i}, user{i}, 2026-09-01") for i in range(50)])
    db.commit()
