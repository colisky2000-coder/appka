"""
Интеграция с партнёрским API — ЗАГЛУШКА, подключается позже.

Сюда подключается внешний API, через который:
  * выдаются персональные ссылки на офферы  -> get_offer_link()
  * (позже) подтягиваются статусы заявок     -> sync_conversions()

Пока функции возвращают None / ничего не делают. Кабинет при этом работает:
ссылка остаётся в статусе «запрошена», и её можно вписать вручную в админке
(раздел «Ссылки»).
"""
import logging

log = logging.getLogger(__name__)


def is_configured() -> bool:
    """Вернуть True, когда интеграция будет подключена."""
    return False


def get_offer_link(user, offer) -> str | None:
    """
    Получить персональную ссылку пользователя на оффер.

    user  — models.User  (user.id, user.email, ...)
    offer — models.Offer (offer.id, offer.partner, offer.external_id, ...)

    Вернуть URL строкой или None, если ссылку получить не удалось.
    """
    return None


def sync_conversions() -> int:
    """
    Подтянуть статусы заявок из партнёрского API и обновить их в базе
    (через services.set_conversion_status). Вернуть число обновлённых заявок.
    """
    return 0
