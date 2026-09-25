"""Тексты и настройки сайта, редактируемые из админки (раздел «Настройки»)."""
from .db import db
from .models import Setting

# (ключ, подпись в админке, тип, значение по умолчанию, группа)
# типы: str, text, bool, money (рубли), url
SCHEMA = [
    ("brand_name", "Название (первое слово)", "str", "Моя", "Бренд"),
    ("brand_accent", "Название (выделенное слово)", "str", "Платформа", "Бренд"),
    ("logo_text", "Текст логотипа (2–3 буквы)", "str", "МП", "Бренд"),
    ("allow_registration", "Открытая регистрация", "bool", "1", "Доступ"),
    ("default_links_access", "Новым пользователям сразу открыт доступ к ссылкам", "bool", "0", "Доступ"),

    ("dashboard_subtitle", "Подзаголовок главной", "str", "Краткая сводка по основным разделам", "Главная"),
    ("top_note", "Пояснение под топом участников", "text",
     "Рейтинг строится по одобренным заявкам. Чужие суммы округлены до тысяч, ваша — точная. "
     "Имя и аватар видны, только если участник включил это в профиле.", "Главная"),

    ("offers_subtitle", "Подзаголовок каталога офферов", "str", "Все офферы в одном месте. Ставки указаны с учётом вашего тарифа.", "Партнёрка"),
    ("bonus_enabled", "Показывать бонусный блок", "bool", "1", "Партнёрка"),
    ("bonus_title", "Бонус: заголовок", "str", "Выполните условие и получите бонус", "Партнёрка"),
    ("bonus_badge", "Бонус: метка", "str", "БОНУС", "Партнёрка"),
    ("bonus_text", "Бонус: текст", "text", "Опишите условия акции здесь — текст меняется в админке.", "Партнёрка"),
    ("bonus_note", "Бонус: примечание", "text", "", "Партнёрка"),
    ("links_access_note", "Текст, пока доступ к ссылкам закрыт", "text",
     "Каталог открыт для просмотра. Чтобы получать ссылки, отправьте заявку на доступ.", "Партнёрка"),

    ("conv_notice1_title", "Заявки: блок 1 — заголовок", "str", "Важно", "Заявки"),
    ("conv_notice1_text", "Заявки: блок 1 — текст", "text", "Здесь можно разместить важное условие для партнёров.", "Заявки"),
    ("conv_notice2_title", "Заявки: блок 2 — заголовок", "str", "Канал с уведомлениями", "Заявки"),
    ("conv_notice2_text", "Заявки: блок 2 — текст", "text", "Подпишитесь на канал, чтобы не пропустить важные новости.", "Заявки"),
    ("conv_notice2_url", "Заявки: блок 2 — ссылка", "url", "", "Заявки"),

    ("topup_instructions", "Инструкция по пополнению баланса", "text",
     "Переведите сумму по реквизитам и отправьте заявку — администратор зачислит средства после проверки.", "Подписка"),

    ("learn_title", "Название раздела обучения в меню", "str", "Обучение", "Обучение"),
    ("learn_done_text", "Текст, когда программа пройдена", "text", "Вы прошли все шаги программы. Отличная работа!", "Обучение"),

    ("support_subtitle", "Подзаголовок поддержки", "str", "Вопросы по заявкам, выплатам, тарифам и работе кабинета", "Поддержка"),
]
DEFAULTS = {k: d for k, _, _, d, _ in SCHEMA}
TYPES = {k: t for k, _, t, _, _ in SCHEMA}


def get_all():
    stored = {s.key: s.value for s in db.query(Setting).all()}
    return {k: stored.get(k, d) for k, d in DEFAULTS.items()}


def get(key):
    s = db.get(Setting, key)
    return s.value if s else DEFAULTS.get(key, "")


def get_bool(key):
    return get(key) in ("1", "true", "True")


def public_view():
    """Настройки, которые видит фронтенд (bool -> True/False)."""
    out = {}
    for k, v in get_all().items():
        out[k] = v in ("1", "true", "True") if TYPES[k] == "bool" else v
    return out


def update(values: dict):
    for k, v in values.items():
        if k not in DEFAULTS:
            continue
        if TYPES[k] == "bool":
            v = "1" if v in (True, "1", "true", 1) else "0"
        elif TYPES[k] == "money":
            try:
                v = str(max(0.0, round(float(str(v).replace(",", ".")), 2)))
            except ValueError:
                continue
        else:
            v = str(v or "")[:5000]
        s = db.get(Setting, k)
        if s:
            s.value = v
        else:
            db.add(Setting(key=k, value=v))
