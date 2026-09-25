"""Модели базы данных. Денежные суммы хранятся в копейках (int)."""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow

# Статусы заявок: код -> (название, группа для финансов)
CONVERSION_STATUSES = {
    "new": ("Новая", "work"),
    "in_work": ("В работе", "work"),
    "hold": ("В холде", "hold"),
    "approved": ("Доступно к выводу", "available"),
    "paid": ("Выплачено", "paid"),
    "rejected": ("Отклонена", "rejected"),
}
# Заявки, которые учитываются в топе участников
TOP_STATUSES = ("hold", "approved", "paid")


class CoverMixin:
    """Превью-картинка: загруженный файл (cover_data) или внешняя ссылка (cover_url)."""
    cover_data: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True, deferred=True)
    cover_mime: Mapped[str] = mapped_column(String(60), default="")
    cover_url: Mapped[str] = mapped_column(Text, default="")
    cover_v: Mapped[int] = mapped_column(Integer, default=0)


class Tariff(Base):
    __tablename__ = "tariffs"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    price: Mapped[int] = mapped_column(Integer, default=0)  # копейки за период
    period_days: Mapped[int] = mapped_column(Integer, default=30)
    rate: Mapped[int] = mapped_column(Integer, default=100)  # % от базовой ставки оффера
    description: Mapped[str] = mapped_column(Text, default="")
    level: Mapped[int] = mapped_column(Integer, default=0)  # чем больше, тем выше тариф
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    # Разделы сайта, включённые в тариф (JSON-список ключей из features.FEATURES).
    # Пустая строка — «не настроено»: действуют разделы по умолчанию.
    features: Mapped[str] = mapped_column(Text, default="")
    program_id: Mapped[Optional[int]] = mapped_column(ForeignKey("programs.id", ondelete="SET NULL"), nullable=True)
    invite_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    invite_code: Mapped[str] = mapped_column(String(40), default="", index=True)
    invite_days: Mapped[int] = mapped_column(Integer, default=0)  # срок доступа по приглашению, 0 — бессрочно


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    username: Mapped[str] = mapped_column(String(64), default="")  # Telegram @username
    display_name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(16), default="user")  # user | admin
    tariff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tariffs.id", ondelete="SET NULL"), nullable=True)
    tariff_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    balance: Mapped[int] = mapped_column(Integer, default=0)
    links_access: Mapped[bool] = mapped_column(Boolean, default=False)
    chat_id: Mapped[str] = mapped_column(String(32), default="")
    tg_link_code: Mapped[str] = mapped_column(String(32), default="")
    show_in_top: Mapped[bool] = mapped_column(Boolean, default=False)
    notify: Mapped[bool] = mapped_column(Boolean, default=True)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    admin_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    tariff: Mapped[Optional[Tariff]] = relationship()

    @property
    def is_admin(self):
        return self.role == "admin"


class UserSession(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_active: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship()


class Offer(Base):
    __tablename__ = "offers"
    id: Mapped[int] = mapped_column(primary_key=True)
    partner: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(160))
    type: Mapped[str] = mapped_column(String(80), default="")
    payout: Mapped[int] = mapped_column(Integer, default=0)  # базовая ставка, копейки
    tax_note: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    # ID оффера во внешней партнёрской системе — для partner_api.py
    external_id: Mapped[str] = mapped_column(String(120), default="")
    limit_default: Mapped[int] = mapped_column(Integer, default=0)  # 0 — без лимита
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class OfferLink(Base):
    """Персональная ссылка пользователя на оффер (через наш редирект /go/<code>)."""
    __tablename__ = "offer_links"
    __table_args__ = (UniqueConstraint("user_id", "offer_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    offer_id: Mapped[int] = mapped_column(ForeignKey("offers.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    url: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="requested")  # requested | active | disabled
    limit: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship()
    offer: Mapped[Offer] = relationship()


class Click(Base):
    __tablename__ = "clicks"
    id: Mapped[int] = mapped_column(primary_key=True)
    link_id: Mapped[int] = mapped_column(ForeignKey("offer_links.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    visitor: Mapped[str] = mapped_column(String(64), default="")
    is_unique: Mapped[bool] = mapped_column(Boolean, default=True)
    subid: Mapped[str] = mapped_column(String(80), default="")


class Favorite(Base):
    __tablename__ = "favorites"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    offer_id: Mapped[int] = mapped_column(ForeignKey("offers.id", ondelete="CASCADE"), primary_key=True)


class Conversion(Base):
    __tablename__ = "conversions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    offer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("offers.id", ondelete="SET NULL"), nullable=True)
    link_id: Mapped[Optional[int]] = mapped_column(ForeignKey("offer_links.id", ondelete="SET NULL"), nullable=True)
    inn: Mapped[str] = mapped_column(String(20), default="", index=True)
    fio: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    subid: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(16), default="new", index=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    comment: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | form | admin
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    status_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship()
    offer: Mapped[Optional[Offer]] = relationship()


class Article(CoverMixin, Base):
    __tablename__ = "articles"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(300), default="")
    category: Mapped[str] = mapped_column(String(80), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(Text, default="")  # если задан — статья ведёт на внешнюю ссылку
    min_tariff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tariffs.id", ondelete="SET NULL"), nullable=True)
    show_in_manuals: Mapped[bool] = mapped_column(Boolean, default=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Material(CoverMixin, Base):
    __tablename__ = "materials"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(300), default="")
    url: Mapped[str] = mapped_column(Text, default="")
    filename: Mapped[str] = mapped_column(String(255), default="")
    mime: Mapped[str] = mapped_column(String(120), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    # Файл хранится в БД — переживает редеплой на хостингах с временным диском.
    data: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True, deferred=True)
    show_in_manuals: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class News(Base):
    __tablename__ = "news"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class NewsRead(Base):
    __tablename__ = "news_reads"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    news_id: Mapped[int] = mapped_column(ForeignKey("news.id", ondelete="CASCADE"), primary_key=True)


class TeamMember(Base):
    __tablename__ = "team"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(200), default="")
    links: Mapped[str] = mapped_column(Text, default="")  # по одной на строку: @username или URL
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class BalanceTx(Base):
    __tablename__ = "balance_tx"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)  # +/- копейки
    kind: Mapped[str] = mapped_column(String(16))  # topup | tariff | adjust
    note: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TopUpRequest(Base):
    __tablename__ = "topups"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | approved | rejected
    admin_note: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship()


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(200))
    topic: Mapped[str] = mapped_column(String(16), default="general")  # general | conversion
    conversion_id: Mapped[Optional[int]] = mapped_column(ForeignKey("conversions.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | answered | closed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship()
    messages: Mapped[list["TicketMessage"]] = relationship(
        order_by="TicketMessage.id", cascade="all, delete-orphan", passive_deletes=True)


class TicketMessage(Base):
    __tablename__ = "ticket_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ================= Обучение =================
class Program(CoverMixin, Base):
    """Обучающая программа (курс). Привязывается к тарифу."""
    __tablename__ = "programs"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Lesson(CoverMixin, Base):
    __tablename__ = "lessons"
    id: Mapped[int] = mapped_column(primary_key=True)
    program_id: Mapped[int] = mapped_column(ForeignKey("programs.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    video_url: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    duration: Mapped[str] = mapped_column(String(40), default="")  # «15 мин» — для карточки
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Step(Base):
    """Точка роадмапа. Внутри — задачи; может вести на урок, статью или ссылку."""
    __tablename__ = "steps"
    id: Mapped[int] = mapped_column(primary_key=True)
    program_id: Mapped[int] = mapped_column(ForeignKey("programs.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    target_type: Mapped[str] = mapped_column(String(16), default="")  # "" | lesson | article | material | url
    target_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_url: Mapped[str] = mapped_column(Text, default="")
    sort: Mapped[int] = mapped_column(Integer, default=0)

    tasks: Mapped[list["StepTask"]] = relationship(
        order_by="StepTask.sort, StepTask.id", cascade="all, delete-orphan", passive_deletes=True)


class StepTask(Base):
    __tablename__ = "step_tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    step_id: Mapped[int] = mapped_column(ForeignKey("steps.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(500))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class TaskDone(Base):
    __tablename__ = "task_done"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("step_tasks.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class StepDone(Base):
    """Отметка для шага без задач."""
    __tablename__ = "step_done"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    step_id: Mapped[int] = mapped_column(ForeignKey("steps.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LessonDone(Base):
    __tablename__ = "lesson_done"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    lesson_id: Mapped[int] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ArticleProgram(Base):
    """Где показывать статью: в каких программах обучения."""
    __tablename__ = "article_programs"
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True)
    program_id: Mapped[int] = mapped_column(ForeignKey("programs.id", ondelete="CASCADE"), primary_key=True)


class MaterialProgram(Base):
    __tablename__ = "material_programs"
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), primary_key=True)
    program_id: Mapped[int] = mapped_column(ForeignKey("programs.id", ondelete="CASCADE"), primary_key=True)
