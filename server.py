"""
Flask API-сервер для Telegram Web App «Калькулятор заработка».
Работает с Google Sheets точно так же, как bot.py — те же листы, структуры, кэши.
Скриншоты пересылаются в канал модерации через Telegram Bot API.
"""

import os, time, re, threading, random, string, traceback, base64, io
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import requests as http_requests

# ============================================================
# КОНФИГУРАЦИЯ (из bot.py)
# ============================================================
# Задавай в переменных окружения (Railway / .env). В репозитории не храним.
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "")
SCREENSHOT_CHANNEL_ID = -1003686883800

# JSON ключ — файл рядом, либо GOOGLE_CREDENTIALS_JSON, либо GOOGLE_CREDENTIALS_BASE64 (для деплоя)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_json_path = os.path.join(SCRIPT_DIR, "debet-485119-31d092561d4c.json")
_json_content = None
if os.environ.get("GOOGLE_CREDENTIALS_BASE64"):
    try:
        _json_content = base64.b64decode(os.environ["GOOGLE_CREDENTIALS_BASE64"]).decode("utf-8")
    except Exception as e:
        print(f"[WARNING] GOOGLE_CREDENTIALS_BASE64 decode error: {e}")
elif os.environ.get("GOOGLE_CREDENTIALS_JSON"):
    _json_content = os.environ["GOOGLE_CREDENTIALS_JSON"]
if _json_content:
    import tempfile
    _tf = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
    _tf.write(_json_content)
    _tf.close()
    JSON_KEY_PATH = _tf.name
else:
    # Обход: файл в репо (для Railway без переменных). Сначала google-credentials.json, потом обычный.
    _file_in_repo = os.path.join(SCRIPT_DIR, "google-credentials.json")
    if os.path.isfile(_file_in_repo):
        JSON_KEY_PATH = _file_in_repo
    else:
        JSON_KEY_PATH = _json_path
    # Если файл — заглушка (пустой ключ), попробовать второй путь (локально — debet-*.json)
    if os.path.isfile(JSON_KEY_PATH):
        try:
            import json as _json
            with open(JSON_KEY_PATH, "r", encoding="utf-8") as _f:
                _data = _json.load(_f)
            if not (_data.get("private_key") and _data.get("client_email")):
                if os.environ.get("RAILWAY_ENVIRONMENT"):
                    print("[WARNING] google-credentials.json — заглушка. Замените на реальный ключ или задайте GOOGLE_CREDENTIALS_BASE64.")
                JSON_KEY_PATH = _json_path if os.path.isfile(_json_path) else None
        except Exception:
            pass
    if not JSON_KEY_PATH or not os.path.isfile(JSON_KEY_PATH):
        if os.environ.get("RAILWAY_ENVIRONMENT"):
            print("[WARNING] No credentials: set GOOGLE_CREDENTIALS_BASE64 or replace google-credentials.json in repo.")

_static = os.path.abspath(os.path.join(SCRIPT_DIR, "frontend", "dist"))
if not os.path.isdir(_static):
    _static = os.path.abspath(os.path.join(os.path.dirname(SCRIPT_DIR), "frontend", "dist"))
if not os.path.isdir(_static):
    _static = os.path.abspath(os.path.join(os.getcwd(), "frontend", "dist"))
if not os.path.isdir(_static):
    _static = os.path.abspath(os.path.join(os.getcwd(), "dist"))  # если запуск из frontend/
if not os.path.isdir(_static):
    _static = None
app = Flask(__name__, static_folder=_static, static_url_path="")
CORS(app)

# ============================================================
# КЭШИ (идентичны bot.py)
# ============================================================
sheets_client_cache = None
sheets_client_cache_time = 0
SHEETS_CLIENT_TTL = 300

offers_cache = {}
offers_cache_time = {}

texts_cache = {}
texts_cache_time = 0
settings_cache = {}
settings_cache_time = 0
TEXTS_SETTINGS_TTL = 60

api_keys_cache = None
referral_urls_cache = {}
user_api_mapping = {}
api_user_count = {}
current_api_index = 0
rotation_threshold_cache = None
rotation_threshold_cache_time = 0
ROTATION_THRESHOLD_TTL = 60

user_orders_data_cache = {}
user_orders_data_cache_time = {}
sheet_users_write_lock = threading.Lock()

STATUSES_V3 = ["заявка на проверке", "карта оформлена", "ожидает получения",
               "ожидает активации", "карта активирована"]

# ============================================================
# ТЕКСТЫ ПО УМОЛЧАНИЮ (из bot.py)
# ============================================================
DEFAULT_TEXTS = {
    "start_new_user": "👋 Привет. Я помогу тебе рассчитать потенциальный заработок на задании с оформлением дебетовых карт.\n\n• Ответь на пару вопросов, и я сделаю точный расчёт, сколько ты можешь заработать, оформив карты сегодня.\n_____\n\n🛡 Более 2000 отзывов нашего проекта <a href=\"{reviews_link}\">тут</a>\n🔑 Новостной канал <a href=\"{news_link}\">тут</a>",
    "start_returning_user": "💻 Это твой личный кабинет подработки. Здесь ты можешь:\n\n• Отслеживать свои задания\n• Отслеживать статус заявок\n• Выводить заработок\n• Связаться с куратором\n_____\n\n⚠️ Выводить деньги можно после активации карты:\n\n• Карта оформлена — получи карту и подтверди получение в ЛК.\n\n• Ожидает активации — свяжись с куратором для инструкции.\n\n• Карта активирована — можно выводить деньги.\n_____\n\n🛡 Более 2000 отзывов нашего проекта <a href=\"{reviews_link}\">тут</a>\n🔑 Новостной канал <a href=\"{news_link}\">тут</a>",
    "ask_age": "Сколько тебе лет?",
    "loading_offers": "⏳ Загружаю список карт...",
    "select_cards": "Какие карты ты еще не оформлял?",
    "select_cards_more": "📋 Выбери дополнительные карты, которые хочешь оформить.",
    "earnings_header": "⌨️ Твой потенциальный заработок:\n\n",
    "choose_first_card": "Выбери, какую карту будешь оформлять первой:",
    "offer_link_template": "📋 Задание ({current_position} / {total_cards})\n\n🎯 {card_name}\n🔗 {link}\n{comment_block}\n💰 За эту карту: {payout} ₽\n💎 За весь комплект: {remaining_sum} ₽\n\n{offer_link_warning_block}\n\n⚠️ Для получения выплаты все карты должны быть получены и успешно одобрены банками.",
    "offer_link_warning": "⚠️ Оформи заявку только по ссылке выше — иначе выплата не будет засчитана.",
    "screenshot_request": "📸 Отправь скриншот подтверждения оформления заявки из сообщения банка.\n\n⚠️ ВАЖНО: Обрезанные скриншоты приниматься не будут.",
    "screenshot_accepted": "✅ Скриншот отправлен на проверку модератору!\n\nТеперь обязательно получи карту, иначе выплата не будет начислена.",
    "screenshot_accepted_final": "✅ Скриншот отправлен на проверку! Это была последняя карта.",
    "screenshot_approved_notification": "✅ Ваш скриншот одобрен!\n\nКарта: {card_name}\n\nНе забудьте получить карту и отметить получение в личном кабинете.",
    "screenshot_rejected_notification": "❌ Ваш скриншот по карте <b>{card_name}</b> не был принят.\n\nПожалуйста, отправьте корректный скриншот.",
    "receipt_photo_request": "📸 Подтверждение получения карты: {card_name}\n_____\n\nСфотографируйте полученную карту.\n\n• На фото должно быть видно последние 4 цифры номера карты.\n\n⚠️ Личные данные НЕ НУЖНЫ.",
    "receipt_photo_accepted": "✅ Фото отправлено на проверку!\n\nКарта: {card_name}\n\nПосле проверки модератором статус будет обновлен.",
    "receipt_approved_notification": "✅ Фото карты одобрено!\n\nКарта: {card_name}\n\nСтатус: ожидает активации.",
    "receipt_rejected_notification": "❌ Фото карты не подходит.\n\nКарта: {card_name}\n\nПопробуйте сфотографировать ещё раз.",
    "cabinet_header": "📲 Личный кабинет\n_____\n\n📋 Ваши заявки на карты:\n\n",
    "cabinet_order_item": "{index}. {card_link}\n• Выплата: {payout} ₽\n• Дата: {timestamp}\n• Статус: {status}\n\n",
    "cabinet_summary": "_____\n\n💵 ИТОГО к выплате: {total_activated} ₽\n📊 Ожидают активации: {count_waiting_activation} шт. ({total_waiting_activation} ₽)\n⏳ Ожидают получения: {count_waiting_receipt} шт. ({total_waiting_receipt} ₽)",
    "withdrawal_zero": "💸 ВЫВОД СРЕДСТВ\n\n💰 К выводу доступно: 0 ₽\n\nℹ️ У вас пока нет активированных карт.",
    "withdrawal_available": "🕊 Вывод средств\n\n• К выводу доступно: <b>{available_amount}</b> ₽",
    "activation_info": "📝 Для активации карты свяжитесь с куратором.",
    "final_message": "🎉 Отлично! Ты оформил {completed_count} карт(ы)\n\n💰 Заработок: {total_payout} ₽",
    "no_offers_available": "✅ Вы уже оформили все доступные карты!",
    "wrong_file_type": "❌ Пожалуйста, отправь именно скриншот (фото).",
    "ask_phone": "📱 <b>Укажите номер телефона</b>\n\nВведите номер для оформления карты.\n\n⚠️ Указывайте реальный номер!\n\n🔒 Данные не передаются третьим лицам.",
    "card_activated_notification": "🎉 <b>Карта активирована!</b>\n\n🎯 Карта: {card_name}\n💰 Начислено: {payout} ₽",
    "referral_cabinet": "👫 <b>Деньги за друзей</b>\n\nЗа каждого друга — {referral_bonus} ₽.",
    "referral_link_message": "🔗 <b>Ваша ссылка:</b>\n\n<code>{referral_link}</code>\n\nДруг выполняет задание — вам {referral_bonus} ₽.",
    "referral_bonus_notification": "🎉 Друг выполнил задание!\n\n💰 Вам начислено {referral_bonus} ₽.",
    "screenshot_pending_resubmit": "⏳ Заявка по карте <b>{card_name}</b> на проверке.\n\nОтправить заново?",
    "offer_link_error": "❌ Ошибка получения реферальной ссылки.",
    "error_general": "❌ Произошла ошибка. Попробуйте позже.",
    "withdrawal_request": "✅ Заявка на вывод отправлена.",
    "referral_program_intro": "👥 <b>Зарабатывайте больше — приглашайте друзей!</b>\n\nТеперь вы можете получать деньги за каждого приглашённого друга, который тоже выполнит задание.\n\n💰 <b>За каждого друга — 400 ₽</b>\n\nПерейдите в «Деньги за друзей» в личном кабинете.",
    "referral_program_reminder": "💡 <b>Напоминаем: вы можете зарабатывать на приглашении друзей!</b>\n\nПолучите ссылку в личном кабинете 👇",
}

DEFAULT_SETTINGS = {
    "admin_ids": "",
    "curator_link_main": "https://t.me/m/SERBzpSoZTEy",
    "curator_link_help": "https://t.me/m/d7Jwi0jQMDM6",
    "curator_link_activation": "https://t.me/m/2TILZYG6MGQ6",
    "curator_link_withdrawal": "https://t.me/m/aem5-1U5ZmNi",
    "curator_link_final": "https://t.me/m/m3woNVoYZTFi",
    "curator_link_reject": "https://t.me/m/hhlVcCN8Njhi",
    "image_start": "https://img3.teletype.in/files/2b/f7/2bf76a9e-c840-46bf-a7b7-3ebe48e621bd.png",
    "image_cabinet": "https://img4.teletype.in/files/be/89/be8918e7-5100-40b0-a551-40b6ebb9b17c.png",
    "image_screenshot_request": "https://img2.teletype.in/files/d9/a3/d9a341b9-4186-4e90-bc15-38ae177d6382.png",
    "image_receipt_request": "https://img3.teletype.in/files/a0/ce/a0cef862-18d3-4cd8-82e2-a006b8aa7ca7.png",
    "reviews_link": "https://t.me/HelperReview",
    "news_link": "https://t.me/+48KHrRt-InE0YzYy",
    "referral_bonus_amount": "400",
    "bot_username": "",
}


# ============================================================
# GOOGLE SHEETS — ПОДКЛЮЧЕНИЕ (из bot.py)
# ============================================================
def connect_sheets():
    global sheets_client_cache, sheets_client_cache_time
    if not JSON_KEY_PATH or not os.path.isfile(JSON_KEY_PATH):
        raise RuntimeError("Google credentials not configured (set GOOGLE_CREDENTIALS_BASE64 or replace google-credentials.json)")
    now = time.time()
    if sheets_client_cache and (now - sheets_client_cache_time) < SHEETS_CLIENT_TTL:
        return sheets_client_cache
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    creds = ServiceAccountCredentials.from_json_keyfile_name(JSON_KEY_PATH, scope)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(SPREADSHEET_ID)
    sheets_client_cache = sheet
    sheets_client_cache_time = now
    return sheet


def init_sheets_if_needed():
    """Создаёт нужные листы в таблице, если их ещё нет (для новой таблицы)."""
    global sheets_client_cache
    try:
        sh = connect_sheets()
        existing = [ws.title for ws in sh.worksheets()]
        required = {
            "Тексты": [["Ключ", "Текст", "Описание"]],
            "Настройки": [["Ключ", "Значение", "Описание"]],
            "Юзеры": [["Telegram ID", "Username", "Карта", "Время оформления", "Выплата", "Статус", "Телефон", "Возраст", "Реферальная ссылка"]],
            "Список офферов X": [["Ссылка", "Название", "Выплата", "Комментарий", "Активен (да/нет)"]],
            "Список офферов Y": [["Ссылка", "Название", "Выплата", "Комментарий", "Активен (да/нет)"]],
            "API": [[]],
            "Дополнительный АПИ": [[]],
            "Ротация": [[5]],
            "Рефералы": [["Inviter ID", "Invitee ID", "Deep Link Code", "Дата создания", "Дата перехода", "Статус", "Дата начисления", "Уведомлён о реф. программе", "Дата уведомления"]],
        }
        for name, header_rows in required.items():
            if name in existing:
                continue
            try:
                ws = sh.add_worksheet(title=name, rows=100, cols=15)
                if header_rows and header_rows[0]:
                    ws.update("A1", header_rows, value_input_option="USER_ENTERED")
                print(f"[Init] Создан лист: {name}")
            except Exception as e:
                print(f"[Init] Лист {name}: {e}")
        sheets_client_cache = None
        sheets_client_cache_time = 0
    except Exception as e:
        print(f"[Init] Ошибка инициализации таблицы: {e}")
        traceback.print_exc()


def load_texts_from_sheet():
    global texts_cache, texts_cache_time
    try:
        ws = connect_sheets().worksheet("Тексты")
        rows = ws.get_all_values()
        r = {}
        for row in rows[1:]:
            if len(row) >= 2 and row[0].strip():
                r[row[0].strip()] = row[1]
        texts_cache = r
        texts_cache_time = time.time()
    except Exception as e:
        print(f"[Texts] Error: {e}")
    return texts_cache


def load_settings_from_sheet():
    global settings_cache, settings_cache_time
    try:
        ws = connect_sheets().worksheet("Настройки")
        rows = ws.get_all_values()
        r = {}
        for row in rows[1:]:
            if len(row) >= 2 and row[0].strip():
                r[row[0].strip()] = (row[1] or "").strip()
        settings_cache = r
        settings_cache_time = time.time()
    except Exception as e:
        print(f"[Settings] Error: {e}")
    return settings_cache


def get_text(key, **kwargs):
    global texts_cache, texts_cache_time
    if time.time() - texts_cache_time > TEXTS_SETTINGS_TTL:
        load_texts_from_sheet()
    raw = texts_cache.get(key, DEFAULT_TEXTS.get(key, ""))
    for skey, sval in get_all_settings().items():
        raw = raw.replace("{" + skey + "}", sval)
    for k, v in kwargs.items():
        raw = raw.replace("{" + k + "}", str(v))
    return raw


def get_setting(key):
    global settings_cache, settings_cache_time
    if time.time() - settings_cache_time > TEXTS_SETTINGS_TTL:
        load_settings_from_sheet()
    return settings_cache.get(key, DEFAULT_SETTINGS.get(key, ""))


def get_all_settings():
    global settings_cache, settings_cache_time
    if time.time() - settings_cache_time > TEXTS_SETTINGS_TTL:
        load_settings_from_sheet()
    m = dict(DEFAULT_SETTINGS)
    m.update(settings_cache)
    return m


# ============================================================
# API КЛЮЧИ И РОТАЦИЯ (из bot.py)
# ============================================================
def get_rotation_threshold():
    global rotation_threshold_cache, rotation_threshold_cache_time
    now = time.time()
    if rotation_threshold_cache is not None and (now - rotation_threshold_cache_time) < ROTATION_THRESHOLD_TTL:
        return rotation_threshold_cache
    try:
        val = connect_sheets().worksheet("Ротация").cell(1, 1).value
        t = int(val.strip()) if val else 5
    except:
        t = 5
    rotation_threshold_cache = t
    rotation_threshold_cache_time = now
    return t


def get_api_keys():
    global api_keys_cache
    if api_keys_cache is None:
        try:
            sh = connect_sheets()
            keys = []
            try:
                keys.extend([k.strip() for k in sh.worksheet("API").col_values(1) if k.strip()])
            except:
                pass
            try:
                keys.extend([k.strip() for k in sh.worksheet("Дополнительный АПИ").col_values(1) if k.strip()])
            except:
                pass
            api_keys_cache = keys
            for i in range(len(keys)):
                if i not in api_user_count:
                    api_user_count[i] = set()
        except Exception as e:
            print(f"API keys error: {e}")
            api_keys_cache = []
    return api_keys_cache


def get_api_for_user(user_id):
    global user_api_mapping, api_user_count, current_api_index
    keys = get_api_keys()
    if not keys:
        return None
    if user_id in user_api_mapping:
        idx = user_api_mapping[user_id]
        return keys[idx] if idx < len(keys) else None
    ai = current_api_index % len(keys)
    thr = get_rotation_threshold()
    if ai not in api_user_count:
        api_user_count[ai] = set()
    if len(api_user_count[ai]) >= thr:
        current_api_index = (current_api_index + 1) % len(keys)
        ai = current_api_index % len(keys)
        if ai not in api_user_count:
            api_user_count[ai] = set()
    api_user_count[ai].add(user_id)
    user_api_mapping[user_id] = ai
    return keys[ai]


# ============================================================
# РЕФЕРАЛЬНЫЕ ССЫЛКИ (из bot.py — синхронно)
# ============================================================
def get_referral_url(offer_id, api_token, timeout=12):
    global referral_urls_cache
    if offer_id in referral_urls_cache and api_token in referral_urls_cache.get(offer_id, {}):
        return referral_urls_cache[offer_id][api_token]
    try:
        resp = http_requests.get(
            "https://rafinad.io/api/v1/me/offers/webmaster/?limit=200",
            headers={"Authorization": f"Token {api_token}"},
            timeout=timeout
        )
        if resp.status_code == 200:
            for offer in resp.json().get('results', []):
                if offer.get('id') == offer_id:
                    flows = offer.get('flows', [])
                    if flows and flows[0].get('marked_url'):
                        url = flows[0]['marked_url']
                        referral_urls_cache.setdefault(offer_id, {})[api_token] = url
                        return url
    except Exception as e:
        print(f"Ref URL error {offer_id}: {e}")
    return None


def get_referral_url_with_fallback(offer_id, user_id):
    """ТЗ: кэш → API с привязанным ключом → перебор остальных ключей. Оригинал только при полной недоступности."""
    ref = None
    if offer_id:
        keys = get_api_keys()
        for api_index, api_key in enumerate(keys):
            if not api_key:
                continue
            ref = get_referral_url(offer_id, api_key)
            if ref:
                return ref
    if not ref and offer_id:
        print(f"[WARNING] No ref URL for offer {offer_id}, use original link")
    return ref


def add_sub1_to_url(url, tid):
    if not url:
        return url
    if '?' in url:
        if 'sub1=' in url:
            return re.sub(r'sub1=[^&]*', f'sub1={tid}', url)
        return f"{url}&sub1={tid}"
    return f"{url}?sub1={tid}"


# ============================================================
# ОФФЕРЫ И ЮЗЕРЫ (из bot.py)
# ============================================================
def load_offers(sheet_name):
    global offers_cache, offers_cache_time
    now = time.time()
    if sheet_name in offers_cache and now - offers_cache_time.get(sheet_name, 0) < 60:
        return offers_cache[sheet_name]
    rows = connect_sheets().worksheet(sheet_name).get_all_values()[1:]
    offers = []
    for row in rows:
        if len(row) >= 5:
            link, name, pay, comment, status = row[0].strip(), row[1].strip(), row[2].strip(), row[3].strip(), row[4].strip().lower()
            if status == "да" and link and name and pay:
                oid = None
                if "rafinad.io/offers/" in link:
                    try:
                        oid = int(link.split("/offers/")[1].strip("/"))
                    except:
                        pass
                try:
                    pv = float(pay)
                except:
                    pv = 0
                offers.append({
                    'name': name, 'payout': pv, 'comment': comment,
                    'offer_id': oid, 'original_link': link
                })
    offers_cache[sheet_name] = offers
    offers_cache_time[sheet_name] = now
    return offers


def get_user_orders(tid, force_refresh=False):
    global user_orders_data_cache, user_orders_data_cache_time
    ts = str(tid)
    now = time.time()
    if not force_refresh and ts in user_orders_data_cache and now - user_orders_data_cache_time.get(ts, 0) < 3:
        return user_orders_data_cache[ts]
    try:
        rows = connect_sheets().worksheet("Юзеры").get_all_values()[1:]
        orders = []
        for i, r in enumerate(rows, start=2):
            if r and len(r) >= 6 and str(r[0]) == ts:
                if not r[2].strip():
                    continue
                status = (r[5].strip() if len(r) > 5 and r[5] else "") or "ожидает получения"
                orders.append({
                    'row_number': i, 'telegram_id': r[0], 'username': r[1],
                    'card_name': r[2], 'timestamp': r[3],
                    'payout': float(r[4]) if r[4] else 0, 'status': status,
                    'phone': (r[6].strip() if len(r) > 6 and r[6] else ""),
                    'ref_link': (r[8].strip() if len(r) > 8 and r[8] else ""),
                })
        user_orders_data_cache[ts] = orders
        user_orders_data_cache_time[ts] = now
        return orders
    except:
        return user_orders_data_cache.get(ts, [])


def get_user_completed_cards(tid):
    return [o['card_name'] for o in get_user_orders(tid)]


def get_user_phone_from_sheet(tid):
    try:
        rows = connect_sheets().worksheet("Юзеры").get_all_values()[1:]
        for r in rows:
            if r and str(r[0]) == str(tid) and len(r) > 6 and r[6] and str(r[6]).strip():
                return str(r[6]).strip()
    except:
        pass
    return None


def get_user_age_from_sheet(tid):
    try:
        rows = connect_sheets().worksheet("Юзеры").get_all_values()[1:]
        for r in rows:
            if r and str(r[0]) == str(tid) and len(r) > 7 and r[7] and str(r[7]).strip():
                return str(r[7]).strip()
    except:
        pass
    return None


def setup_status_dropdown(ws, row):
    try:
        values = [{'userEnteredValue': s} for s in STATUSES_V3]
        ws.spreadsheet.batch_update({'requests': [{'setDataValidation': {
            'range': {'sheetId': ws.id, 'startRowIndex': row - 1, 'endRowIndex': row,
                      'startColumnIndex': 5, 'endColumnIndex': 6},
            'rule': {'condition': {'type': 'ONE_OF_LIST', 'values': values},
                     'showCustomUi': True, 'strict': False}}}]})
    except:
        pass


def save_user_order_sync(tid, username, card_name, payout, phone="", age="", ref_link=""):
    try:
        ts = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
        uname = f"@{username}" if username and not str(username).startswith("@") else (username or "Нет username")
        row_data = [str(tid), uname, card_name, ts, float(payout),
                    "заявка на проверке", phone or "", age or "", ref_link or ""]
        with sheet_users_write_lock:
            ws = connect_sheets().worksheet("Юзеры")
            all_rows = ws.get_all_values()
            if len(all_rows) < 1:
                all_rows = [["Telegram ID", "Username", "Карта", "Время", "Выплата",
                             "Статус", "Телефон", "Возраст", "Ссылка"]]
            # Обновить существующую строку если есть
            for i, r in enumerate(all_rows[1:], start=2):
                if (r and len(r) >= 6 and str(r[0]) == str(tid) and
                        (r[2] or "").strip() == card_name.strip() and
                        (r[5] or "").strip() == "заявка на проверке"):
                    ws.update(f"A{i}:I{i}", [row_data], value_input_option="USER_ENTERED")
                    setup_status_dropdown(ws, i)
                    ts2 = str(tid)
                    if ts2 in user_orders_data_cache:
                        del user_orders_data_cache[ts2]
                    return i
            # Новая строка
            next_row = len(all_rows) + 1
            ws.update(f"A{next_row}:I{next_row}", [row_data], value_input_option="USER_ENTERED")
            setup_status_dropdown(ws, next_row)
            ts2 = str(tid)
            if ts2 in user_orders_data_cache:
                del user_orders_data_cache[ts2]
            return next_row
    except Exception as e:
        print(f"Save order error: {e}")
        traceback.print_exc()
    return None


# ============================================================
# РЕФЕРАЛЫ (из bot.py)
# ============================================================
def referral_add_link(inviter_id, deep_link_code):
    try:
        ws = connect_sheets().worksheet("Рефералы")
        ws.append_row([str(inviter_id), "", deep_link_code,
                       datetime.now().strftime("%d.%m.%Y %H:%M:%S"),
                       "", "ссылка создана", "", "нет", ""])
    except Exception as e:
        print(f"referral_add_link: {e}")


# ============================================================
# TELEGRAM BOT API — ОТПРАВКА В КАНАЛ
# ============================================================
def send_photo_to_channel(photo_bytes, caption, user_id, row_number, photo_type="screenshot"):
    """Отправляет фото в канал модерации с кнопками одобрить/отклонить."""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendPhoto"
    if photo_type == "screenshot":
        approve_cb = f"approve_screenshot_{user_id}_{row_number}"
        reject_cb = f"reject_screenshot_{user_id}_{row_number}"
    else:
        approve_cb = f"approve_receipt_{user_id}_{row_number}"
        reject_cb = f"reject_receipt_{user_id}_{row_number}"

    markup = {
        "inline_keyboard": [[
            {"text": "✅ Одобрить", "callback_data": approve_cb},
            {"text": "❌ Отклонить", "callback_data": reject_cb},
        ]]
    }
    import json
    try:
        resp = http_requests.post(url, data={
            "chat_id": SCREENSHOT_CHANNEL_ID,
            "caption": caption,
            "reply_markup": json.dumps(markup),
        }, files={
            "photo": ("screenshot.jpg", io.BytesIO(photo_bytes), "image/jpeg"),
        }, timeout=30)
        return resp.json()
    except Exception as e:
        print(f"send_photo_to_channel error: {e}")
        return None


def send_message_to_user(user_id, text, markup=None):
    """Отправляет текстовое сообщение пользователю через Telegram Bot API."""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    import json
    data = {
        "chat_id": user_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if markup:
        data["reply_markup"] = json.dumps(markup)
    try:
        resp = http_requests.post(url, json=data, timeout=15)
        return resp.json()
    except Exception as e:
        print(f"send_message_to_user error: {e}")
        return None


# ============================================================
# API ЭНДПОИНТЫ
# ============================================================

@app.route("/api/init", methods=["POST"])
def api_init():
    """Инициализация: получить настройки, проверить наличие заявок, возраст, телефон."""
    data = request.json or {}
    uid = str(data.get("user_id", ""))
    if not uid:
        return jsonify({"error": "user_id required"}), 400

    settings = get_all_settings()
    has_orders = len(get_user_orders(uid)) > 0
    age_from_sheet = get_user_age_from_sheet(uid)
    phone_from_sheet = get_user_phone_from_sheet(uid)

    return jsonify({
        "settings": settings,
        "has_orders": has_orders,
        "age": age_from_sheet,  # "под18" / "над18" / None
        "phone": phone_from_sheet,
    })


@app.route("/api/offers", methods=["POST"])
def api_offers():
    """Загрузить офферы по возрасту. Исключить уже оформленные если more=true."""
    data = request.json or {}
    uid = str(data.get("user_id", ""))
    age = data.get("age", "over18")  # "under18" / "over18"
    more = data.get("more", False)

    sheet_name = "Список офферов X" if age == "under18" else "Список офферов Y"
    try:
        offers = load_offers(sheet_name)
    except Exception as e:
        print(f"[api/offers] Error: {e}")
        traceback.print_exc()
        return jsonify({"offers": [], "error": "table_error", "message": "Нет доступа к таблице. Проверьте GOOGLE_CREDENTIALS_JSON и доступ к таблице."})

    if more:
        completed = get_user_completed_cards(uid)
        offers = [o for o in offers if o['name'] not in completed]

    return jsonify({"offers": offers})


def _check_table():
    if not JSON_KEY_PATH or not os.path.isfile(JSON_KEY_PATH):
        return jsonify({
            "ok": False,
            "message": "Ключ Google не найден. В Railway добавь переменную GOOGLE_CREDENTIALS_BASE64 (скопируй из файла railway_base64.txt).",
            "error": "missing_credentials",
        }), 500
    try:
        offers_x = load_offers("Список офферов X")
        offers_y = load_offers("Список офферов Y")
        return jsonify({
            "ok": True,
            "message": "Связь с таблицей есть.",
            "offers_x": len(offers_x),
            "offers_y": len(offers_y),
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "message": "Нет доступа к таблице.",
            "error": str(e),
        }), 500


@app.route("/api/check_table", methods=["GET"])
def api_check_table():
    """Проверка доступа к Google Таблице: открыть в браузере для проверки связи."""
    return _check_table()


@app.route("/check_table", methods=["GET"])
def check_table_short():
    """Короткий URL для проверки таблицы."""
    return _check_table()


@app.route("/api/debug_env", methods=["GET"])
def debug_env():
    """Проверка: видит ли приложение переменные с ключом (без вывода значений)."""
    b64_set = bool(os.environ.get("GOOGLE_CREDENTIALS_BASE64"))
    json_set = bool(os.environ.get("GOOGLE_CREDENTIALS_JSON"))
    b64_len = len(os.environ.get("GOOGLE_CREDENTIALS_BASE64", ""))
    json_len = len(os.environ.get("GOOGLE_CREDENTIALS_JSON", ""))
    return jsonify({
        "GOOGLE_CREDENTIALS_BASE64_set": b64_set,
        "GOOGLE_CREDENTIALS_BASE64_length": b64_len,
        "GOOGLE_CREDENTIALS_JSON_set": json_set,
        "GOOGLE_CREDENTIALS_JSON_length": json_len,
        "JSON_KEY_PATH_exists": bool(JSON_KEY_PATH and os.path.isfile(JSON_KEY_PATH)),
        "hint": "Если оба _set = false, переменная не доходит до приложения. Сделай Redeploy в Railway.",
    })


@app.route("/api/orders", methods=["POST"])
def api_orders():
    """Получить все заявки пользователя из Google Sheets."""
    data = request.json or {}
    uid = str(data.get("user_id", ""))
    if not uid:
        return jsonify({"error": "user_id required"}), 400

    orders = get_user_orders(uid, force_refresh=True)
    return jsonify({"orders": orders})


@app.route("/api/get_ref_link", methods=["POST"])
def api_get_ref_link():
    """Получить реферальную ссылку на оффер через API Rafinad (синхронно). При недоступности — оригинальная ссылка (ТЗ)."""
    data = request.json or {}
    uid = str(data.get("user_id", ""))
    offer_id = data.get("offer_id")
    original_link = (data.get("original_link") or "").strip()

    if not offer_id:
        return jsonify({"error": "offer_id required", "link": None}), 400

    ref = get_referral_url_with_fallback(offer_id, uid)
    if ref:
        ref = add_sub1_to_url(ref, uid)
    elif original_link:
        ref = add_sub1_to_url(original_link, uid)
        print(f"[WARNING] Using original link for offer {offer_id} (API unavailable)")

    return jsonify({"link": ref})


@app.route("/api/submit_screenshot", methods=["POST"])
def api_submit_screenshot():
    """
    Пользователь отправляет скриншот оформления.
    Сохраняем заявку в «Юзеры», пересылаем фото в канал модерации.
    """
    uid = request.form.get("user_id", "")
    username = request.form.get("username", "")
    card_name = request.form.get("card_name", "")
    payout = request.form.get("payout", "0")
    phone = request.form.get("phone", "")
    age = request.form.get("age", "")
    ref_link = request.form.get("ref_link", "")

    photo = request.files.get("photo")
    if not photo:
        return jsonify({"error": "photo required"}), 400

    photo_bytes = photo.read()

    try:
        payout_val = float(payout)
    except:
        payout_val = 0

    # Записать в Google Sheets
    rn = save_user_order_sync(uid, username, card_name, payout_val,
                              phone=phone, age=age, ref_link=ref_link)

    # Отправить в канал модерации
    ts = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    ud = f"@{username}" if username else "Нет username"
    cap = (f"📋 Новая заявка на проверку\n\n"
           f"👤 ID: {uid}\n👤 Username: {ud}\n📱 Телефон: {phone or '—'}\n"
           f"🎯 Карта: {card_name}\n⏰ Время: {ts}\n#u{uid}")

    send_photo_to_channel(photo_bytes, cap, uid, rn, "screenshot")

    return jsonify({"ok": True, "row_number": rn})


@app.route("/api/submit_receipt", methods=["POST"])
def api_submit_receipt():
    """Пользователь отправляет фото полученной карты."""
    uid = request.form.get("user_id", "")
    username = request.form.get("username", "")
    card_name = request.form.get("card_name", "")
    row_number = request.form.get("row_number", "")
    phone = request.form.get("phone", "")

    photo = request.files.get("photo")
    if not photo:
        return jsonify({"error": "photo required"}), 400

    photo_bytes = photo.read()

    ts = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    ud = f"@{username}" if username else "Нет username"
    cap = (f"✅ ПРОВЕРКА ПОЛУЧЕНИЯ КАРТЫ\n\n"
           f"👤 ID: {uid}\n👤 Username: {ud}\n📱 Телефон: {phone or '—'}\n"
           f"🎯 Карта: {card_name}\n⏰ Время: {ts}\n#u{uid}")

    rn = int(row_number) if row_number else 0
    send_photo_to_channel(photo_bytes, cap, uid, rn, "receipt")

    return jsonify({"ok": True})


@app.route("/api/resubmit_screenshot", methods=["POST"])
def api_resubmit_screenshot():
    """Пользователь отправляет скриншот заново (очищаем старую строку, создаём новую)."""
    uid = request.form.get("user_id", "")
    username = request.form.get("username", "")
    card_name = request.form.get("card_name", "")
    payout = request.form.get("payout", "0")
    phone = request.form.get("phone", "")
    age = request.form.get("age", "")
    ref_link = request.form.get("ref_link", "")
    old_row = request.form.get("old_row_number", "")

    photo = request.files.get("photo")
    if not photo:
        return jsonify({"error": "photo required"}), 400
    photo_bytes = photo.read()

    # Очистить старую строку
    if old_row:
        try:
            ws = connect_sheets().worksheet("Юзеры")
            ws.update(f'A{old_row}:I{old_row}', [['', '', '', '', '', '', '', '', '']])
        except:
            pass

    payout_val = float(payout) if payout else 0
    rn = save_user_order_sync(uid, username, card_name, payout_val,
                              phone=phone, age=age, ref_link=ref_link)

    ts = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    ud = f"@{username}" if username else "Нет username"
    cap = (f"📋 Повторная заявка на проверку\n\n"
           f"👤 ID: {uid}\n👤 Username: {ud}\n📱 Телефон: {phone or '—'}\n"
           f"🎯 Карта: {card_name}\n⏰ Время: {ts}\n#u{uid}")

    send_photo_to_channel(photo_bytes, cap, uid, rn, "screenshot")

    # Обновить кэш
    ts2 = str(uid)
    if ts2 in user_orders_data_cache:
        del user_orders_data_cache[ts2]

    return jsonify({"ok": True, "row_number": rn})


@app.route("/api/check_status", methods=["POST"])
def api_check_status():
    """Проверить актуальный статус строки в Юзеры."""
    data = request.json or {}
    row_number = data.get("row_number")
    if not row_number:
        return jsonify({"error": "row_number required"}), 400
    try:
        ws = connect_sheets().worksheet("Юзеры")
        status = (ws.cell(int(row_number), 6).value or "").strip()
        return jsonify({"status": status})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/referral/create", methods=["POST"])
def api_referral_create():
    """Сгенерировать реферальную ссылку."""
    data = request.json or {}
    uid = str(data.get("user_id", ""))
    if not uid:
        return jsonify({"error": "user_id required"}), 400

    bot_username = (get_setting("bot_username") or "").strip().lstrip("@")
    if not bot_username:
        try:
            resp = http_requests.get(
                f"https://api.telegram.org/bot{BOT_TOKEN}/getMe", timeout=10
            ).json()
            bot_username = resp.get("result", {}).get("username", "bot")
        except:
            bot_username = "bot"

    code = f"ref_{uid}_{''.join(random.choices(string.ascii_lowercase + string.digits, k=4))}"
    referral_add_link(uid, code)
    link = f"https://t.me/{bot_username}?start={code}"
    bonus = get_setting("referral_bonus_amount") or "400"

    return jsonify({"link": link, "code": code, "bonus": bonus})


@app.route("/api/texts", methods=["GET"])
def api_texts():
    """Вернуть все тексты с подставленными настройками."""
    load_texts_from_sheet()
    merged = dict(DEFAULT_TEXTS)
    merged.update(texts_cache)
    settings = get_all_settings()
    result = {}
    for k, v in merged.items():
        for sk, sv in settings.items():
            v = v.replace("{" + sk + "}", sv)
        result[k] = v
    return jsonify({"texts": result, "settings": settings})


# Serve React frontend (если папка есть)
@app.route("/")
def serve_index():
    if app.static_folder and os.path.isdir(app.static_folder):
        return send_from_directory(app.static_folder, "index.html")
    return "<!DOCTYPE html><html><head><meta charset='utf-8'><title>API</title></head><body><h1>Калькулятор заработка — API</h1><p>Сервер запущен. Используйте Telegram Web App для входа.</p></body></html>", 200


@app.route("/<path:path>")
def serve_static(path):
    if app.static_folder and os.path.isdir(app.static_folder):
        file_path = os.path.join(app.static_folder, path)
        if os.path.isfile(file_path):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")
    return jsonify({"error": "Not found"}), 404


# ============================================================
# ЗАПУСК
# ============================================================
if __name__ == "__main__":
    if app.static_folder and os.path.isdir(app.static_folder):
        print(f"Frontend: раздаю из {app.static_folder}")
    else:
        print("Frontend: папка frontend/dist не найдена! Запусти: cd frontend && npm run build")
    print("Проверка и создание листов в Google Таблице (если нужно)...")
    init_sheets_if_needed()
    print("Загружаю тексты и настройки из Google Sheets...")
    load_texts_from_sheet()
    load_settings_from_sheet()
    print(f"Тексты: {len(texts_cache)}, Настройки: {len(settings_cache)}")
    port = int(os.environ.get("PORT", 5000))
    print(f"Сервер запускается на http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
