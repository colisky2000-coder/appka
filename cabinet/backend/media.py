"""Превью-картинки и видео: загрузка, автоподбор с сайта-источника, встраивание плееров."""
import ipaddress
import re
import socket
import urllib.parse
import urllib.request
from html import unescape

from .util import ApiError

MAX_IMAGE = 5 * 1024 * 1024
MAX_HTML = 2 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
UA = "Mozilla/5.0 (compatible; CabinetPreviewBot/1.0)"


# ---------- безопасная загрузка по ссылке ----------
def _check_host(url):
    """Не даём ходить по внутренним адресам сервера (localhost, 10.x и т.п.)."""
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ApiError("Ссылка должна начинаться с http:// или https://")
    try:
        infos = socket.getaddrinfo(p.hostname, None)
    except socket.gaierror:
        raise ApiError("Не удалось открыть ссылку: сайт не найден")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ApiError("Ссылка ведёт на внутренний адрес")


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_host(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_SafeRedirect)


def fetch(url, max_bytes, timeout=10):
    """Скачивает не больше max_bytes. Возвращает (bytes, content_type, final_url)."""
    _check_host(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with _opener.open(req, timeout=timeout) as r:
            data = r.read(max_bytes + 1)
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            final = r.geturl()
    except ApiError:
        raise
    except Exception as e:
        raise ApiError(f"Не удалось загрузить {url}: {e}")
    if len(data) > max_bytes:
        raise ApiError("Файл по ссылке слишком большой")
    return data, ctype, final


def sniff_image(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return ""


def validate_image(data):
    if not data:
        raise ApiError("Пустой файл")
    if len(data) > MAX_IMAGE:
        raise ApiError("Картинка больше 5 МБ")
    mime = sniff_image(data)
    if mime not in IMAGE_TYPES:
        raise ApiError("Нужна картинка JPG, PNG, WEBP или GIF")
    return mime


def download_image(url):
    data, _, _ = fetch(url, MAX_IMAGE)
    return data, validate_image(data)


# ---------- автоподбор превью ----------
_META_RE = re.compile(r"<meta\s+[^>]*>", re.I)
_ATTR_RE = re.compile(r'([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))')


def parse_og_image(html, base_url):
    """Ищет og:image / twitter:image в HTML страницы."""
    found = {}
    for tag in _META_RE.findall(html):
        attrs = {m.group(1).lower(): unescape(m.group(3) or m.group(4) or m.group(5) or "") for m in _ATTR_RE.finditer(tag)}
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        if key in ("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src") and attrs.get("content"):
            found.setdefault(key, attrs["content"].strip())
    for key in ("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"):
        if found.get(key):
            return urllib.parse.urljoin(base_url, found[key])
    return None


def youtube_id(url):
    m = re.search(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([\w-]{11})", url or "")
    return m.group(1) if m else None


def find_preview_url(page_url):
    """Картинка-превью для ссылки (статья Teletype, видео и т.п.)."""
    yid = youtube_id(page_url)
    if yid:
        return f"https://img.youtube.com/vi/{yid}/hqdefault.jpg"
    data, ctype, final = fetch(page_url, MAX_HTML)
    if ctype.startswith("image/"):
        return final
    img = parse_og_image(data.decode("utf-8", errors="replace"), final)
    if not img:
        raise ApiError("На странице не нашлось картинки-превью — загрузите её вручную")
    return img


# ---------- видео ----------
def video_embed(url, autoplay=True):
    """Ссылка на видео -> адрес встраиваемого плеера (или None, если сайт не поддерживается)."""
    src = _embed(url)
    if src and not autoplay:
        src = re.sub(r"([?&])autoplay=1&?", r"\1", src).rstrip("?&")
    return src


def _embed(url):
    if not url:
        return None
    u = url.strip()
    yid = youtube_id(u)
    if yid:
        return f"https://www.youtube.com/embed/{yid}?autoplay=1&rel=0"
    m = re.search(r"rutube\.ru/(?:video|shorts|play/embed)/(?:private/)?([0-9a-f]{32})", u)
    if m:
        return f"https://rutube.ru/play/embed/{m.group(1)}?autoplay=1"
    m = re.search(r"(?:vk\.com|vkvideo\.ru|vk\.ru)/(?:video|clip)(-?\d+)_(\d+)", u)
    if m:
        return f"https://vk.com/video_ext.php?oid={m.group(1)}&id={m.group(2)}&hd=2&autoplay=1"
    if "video_ext.php" in u or "/embed/" in u or "player.vimeo.com" in u:
        return u
    m = re.search(r"vimeo\.com/(\d+)", u)
    if m:
        return f"https://player.vimeo.com/video/{m.group(1)}?autoplay=1"
    m = re.search(r"dzen\.ru/video/watch/([\w-]+)", u)
    if m:
        return f"https://dzen.ru/embed/{m.group(1)}"
    return None


# ---------- превью у записей (CoverMixin) ----------
def cover_link(kind, obj):
    if obj.cover_mime:
        return f"media/{kind}/{obj.id}/cover?v={obj.cover_v}"  # относительный: сайт может быть в подпапке
    return obj.cover_url or None


def set_cover_bytes(obj, data):
    mime = validate_image(data)
    obj.cover_data, obj.cover_mime, obj.cover_url = data, mime, ""
    obj.cover_v = (obj.cover_v or 0) + 1


def set_cover_url(obj, url):
    """Скачивает картинку и хранит у себя; если не вышло — показываем по внешней ссылке."""
    try:
        data, mime = download_image(url)
        obj.cover_data, obj.cover_mime, obj.cover_url = data, mime, ""
    except ApiError:
        obj.cover_data, obj.cover_mime, obj.cover_url = None, "", url
    obj.cover_v = (obj.cover_v or 0) + 1


def set_cover_auto(obj, source_url):
    if not source_url:
        raise ApiError("Нет ссылки, из которой можно подтянуть превью")
    set_cover_url(obj, find_preview_url(source_url))


def clear_cover(obj):
    obj.cover_data, obj.cover_mime, obj.cover_url = None, "", ""
    obj.cover_v = (obj.cover_v or 0) + 1
