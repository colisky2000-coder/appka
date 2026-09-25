"""Начальные данные: тариф по умолчанию и (по желанию) демо-контент."""
import os

from .db import db
from .models import Article, News, Offer, Tariff, TeamMember, TrafficRow


def seed_defaults():
    if not db.query(Tariff).first():
        db.add(Tariff(code="basic", name="BASIC", price=0, rate=100, level=0, is_default=True,
                      description="Базовый доступ к кабинету"))
        db.commit()


def seed_demo():
    """Демо-контент для первого запуска (SEED_DEMO=1). Только если база пустая."""
    if os.environ.get("SEED_DEMO") != "1" or db.query(Offer).first():
        return
    db.add(Tariff(code="pro", name="PRO", price=99000, period_days=30, rate=110, level=1,
                  description="Повышенные ставки и закрытые материалы"))
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
