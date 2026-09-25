"""
Текст уроков и статей из визуального редактора — HTML. Перед сохранением и выдачей он
чистится по белому списку тегов: никаких скриптов, стилей и обработчиков событий.
Старые тексты в простом формате («# заголовок», «- пункт») остаются как есть — их
форматирует фронтенд.
"""
import re
from html import escape
from html.parser import HTMLParser

MAX_LEN = 300_000

TAGS = {"p", "br", "h2", "h3", "h4", "b", "i", "u", "s", "ul", "ol", "li", "blockquote",
        "a", "img", "hr", "figure", "figcaption", "pre", "code", "iframe"}
VOID = {"br", "img", "hr"}
RENAME = {"strong": "b", "em": "i", "strike": "s", "del": "s", "h1": "h2", "h5": "h4", "h6": "h4", "div": "p"}
# Эти теги выкидываются вместе с содержимым
DROP = {"script", "style", "template", "noscript", "head", "title", "object", "embed", "svg", "math",
        "form", "textarea", "select", "button", "iframe", "video", "audio", "canvas", "frame", "frameset"}
# Блоки, внутри которых не может быть <p>: открытие нового блока закрывает незакрытый <p>
BLOCKS = {"p", "h2", "h3", "h4", "ul", "ol", "blockquote", "figure", "pre", "hr"}
FIGURE_CLASSES = {"image", "embed"}
# Разрешённые плееры для встраивания видео
EMBED_RE = re.compile(r"^https://(www\.youtube\.com/embed/|rutube\.ru/play/embed/|vk\.com/video_ext\.php\?|"
                      r"player\.vimeo\.com/video/|dzen\.ru/embed/)[^\s\"'<>]*$")
IMG_RE = re.compile(r"^(https?://[^\s\"'<>]+|media/u/[A-Za-z0-9]+)$")
HREF_RE = re.compile(r"^(https?://|mailto:|tel:|#)[^\s\"'<>]*$", re.I)


def is_html(text):
    return str(text or "").lstrip().startswith("<")


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.stack = []
        self.skip = 0  # глубина выкидываемого тега (script, style, ...)

    def _open(self, tag, attrs_html=""):
        if tag in BLOCKS and "p" in self.stack:
            self._close("p")
        if tag == "li":  # незакрытый предыдущий пункт того же списка
            lists = [i for i, t in enumerate(self.stack) if t in ("ul", "ol")]
            if lists and "li" in self.stack[lists[-1]:]:
                self._close("li")
        self.out.append(f"<{tag}{attrs_html}>")
        if tag not in VOID:
            self.stack.append(tag)

    def _close(self, tag):
        if tag not in self.stack:
            return
        while self.stack:
            t = self.stack.pop()
            self.out.append(f"</{t}>")
            if t == tag:
                break

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.skip:
            if tag in DROP:
                self.skip += 1
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "iframe":
            src = a.get("src", "").strip()
            if EMBED_RE.match(src):
                self.out.append(f'<iframe src="{escape(src)}" allowfullscreen loading="lazy" '
                                f'allow="autoplay; fullscreen; picture-in-picture; encrypted-media" '
                                f'referrerpolicy="strict-origin-when-cross-origin"></iframe>')
            self.skip = 1
            return
        if tag in DROP:
            self.skip = 1
            return
        tag = RENAME.get(tag, tag)
        if tag not in TAGS:
            return
        extra = ""
        if tag == "a":
            href = a.get("href", "").strip()
            if not HREF_RE.match(href):
                return
            extra = f' href="{escape(href)}"'
            if href.lower().startswith("http"):
                extra += ' target="_blank" rel="noopener noreferrer"'
        elif tag == "img":
            src = a.get("src", "").strip()
            if not IMG_RE.match(src):
                return
            extra = f' src="{escape(src)}" alt="{escape(a.get("alt", "")[:300])}" loading="lazy"'
        elif tag == "figure":
            cls = a.get("class", "").strip()
            if cls in FIGURE_CLASSES:
                extra = f' class="{cls}"'
        self._open(tag, extra)

    def handle_startendtag(self, tag, attrs):
        was = self.skip
        self.handle_starttag(tag, attrs)
        t = tag.lower()
        if t in DROP:
            self.skip = was  # у самозакрытого тега нет содержимого
        elif t not in VOID and not self.skip:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.skip:
            if tag in DROP:
                self.skip -= 1
            return
        tag = RENAME.get(tag, tag)
        if tag in TAGS and tag not in VOID:
            self._close(tag)

    def handle_data(self, data):
        if not self.skip:
            self.out.append(escape(data, quote=False))

    def result(self):
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")
        return "".join(self.out)


def sanitize(html):
    p = _Cleaner()
    p.feed(str(html or ""))
    p.close()
    # Пустые абзацы в начале и в конце (редактор оставляет «<p><br></p>») убираем
    empty = r"(<p>(<br>|\s|\xa0)*</p>\s*)+"
    return re.sub(f"^{empty}|{empty}$", "", p.result().strip())


def clean(value, label="Текст"):
    """Для сохранения из админки: HTML чистим, обычный текст оставляем."""
    from .util import ApiError
    v = str(value or "")
    if len(v) > MAX_LEN:
        raise ApiError(f"«{label}» слишком длинный")
    return sanitize(v) if is_html(v) else v.strip()


def for_output(value):
    return sanitize(value) if is_html(value) else (value or "")
