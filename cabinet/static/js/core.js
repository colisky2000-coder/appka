/* Ядро фронтенда: API, утилиты, иконки, модалки, роутер, меню, вход. */
window.App = (() => {
  const App = { cfg: null, me: null, pages: {} };

  // ---------- API ----------
  async function api(method, url, data, { form } = {}) {
    // Адреса относительные («api/...»): кабинет может жить в подпапке сайта
    url = url.replace(/^\//, "");
    const opts = { method, credentials: "same-origin", headers: { "X-Requested-With": "fetch" } };
    if (form) opts.body = form;
    else if (data !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(data); }
    let res;
    try { res = await fetch(url, opts); }
    catch { throw new Error("Нет связи с сервером"); }
    let json = {};
    try { json = await res.json(); } catch { /* не JSON */ }
    if (res.status === 401 && !url.startsWith("api/auth/")) {
      App.me = null; showAuth(); throw new Error(json.error || "Требуется вход");
    }
    if (!res.ok || json.ok === false) throw new Error(json.error || `Ошибка ${res.status}`);
    return json.meta ? { data: json.data, meta: json.meta } : json.data;
  }
  App.api = api;
  App.get = (u) => api("GET", u);
  App.post = (u, d = {}) => api("POST", u, d);
  App.patch = (u, d) => api("PATCH", u, d);
  App.put = (u, d) => api("PUT", u, d);
  App.del = (u) => api("DELETE", u);

  // ---------- утилиты ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n, d = 0) => Number(n || 0).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: 2 }) + " ₽";
  const toDate = (s) => new Date(s);
  const fmtDate = (s) => s ? toDate(s).toLocaleDateString("ru-RU") : "—";
  const fmtDateTime = (s) => s ? toDate(s).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const isoDay = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  const ago = (s) => {
    const days = Math.floor((Date.now() - toDate(s)) / 864e5);
    if (days >= 30) return `${Math.floor(days / 30)} мес. назад`;
    if (days >= 1) return `${days} дн. назад`;
    return "сегодня";
  };
  const nl2br = (s) => esc(s).replace(/\n/g, "<br>");
  const linkify = (s) => nl2br(s).replace(/(https?:\/\/[^\s<]+)/g, '<a class="link-btn" href="$1" target="_blank" rel="noopener">$1</a>');
  const initial = (name) => (String(name || "").replace(/^@/, "")[0] || "?").toUpperCase();
  // Простое форматирование текста: абзацы, «# » и «## » заголовки, списки «- », **жирный**, ссылки
  const md = (src) => {
    const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a class="link-btn" href="$1" target="_blank" rel="noopener">$1</a>');
    let html = "", list = false;
    for (const ln of esc(src || "").split(/\r?\n/)) {
      const li = ln.match(/^\s*[-•*]\s+(.*)$/);
      if (li) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(li[1])}</li>`; continue; }
      if (list) { html += "</ul>"; list = false; }
      if (/^##\s+/.test(ln)) html += `<h4>${inline(ln.replace(/^##\s+/, ""))}</h4>`;
      else if (/^#\s+/.test(ln)) html += `<h3>${inline(ln.replace(/^#\s+/, ""))}</h3>`;
      else if (ln.trim()) html += `<p>${inline(ln)}</p>`;
    }
    return html + (list ? "</ul>" : "");
  };
  // Текст урока/статьи: HTML из визуального редактора (сервер его уже очистил) или старый простой формат
  const rich = (body) => /^\s*</.test(body || "") ? body : md(body);
  // Превью: картинка или заглушка с первой буквой
  const cover = (url, title, cls = "") => url
    ? `<div class="cover ${cls}"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
    : `<div class="cover ph ${cls}"><span>${esc((String(title || "").replace(/^@/, "")[0] || "•").toUpperCase())}</span></div>`;
  const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null && v !== false)).toString();
  Object.assign(App, { $, $$, esc, money, fmtDate, fmtDateTime, isoDay, ago, nl2br, linkify, qs, initial, md, rich, cover });

  // ---------- иконки ----------
  const ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    book: '<path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11.5l2-8H6"/>',
    handshake: '<path d="M11 17l2 2a1.5 1.5 0 0 0 2-2M13 15l2.5 2.5a1.5 1.5 0 0 0 2-2L14 12M3 11l5-5 4 2 3-2 6 5-4 4M8 6l-5 5 6 6 2-1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.5.6 4 2.8 4 6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-7 8-7s8 3 8 7"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8"/>',
    click: '<path d="M9 9l11 4-5 2-2 5zM4 4l2 2M9 2v3M2 9h3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8S10 3 7.5 4.5 9 8 12 8zM12 8s2-5 4.5-3.5S15 8 12 8z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    warn: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    hourglass: '<path d="M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    news: '<path d="M4 4h13v16H6a2 2 0 0 1-2-2zM17 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M11 5h7M6 19h7M14 5l-4 14"/>',
    underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
    strike: '<path d="M4 12h16M16 6.5A4 3 0 0 0 12 5c-2.5 0-4 1.3-4 3 0 1.4 1 2.4 3 3M8 17.5A4 3 0 0 0 12 19c2.5 0 4-1.3 4-3 0-.6-.2-1.2-.5-1.6"/>',
    ul: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    ol: '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5a1.5 1.5 0 0 1 3 .5L3.5 19h3"/>',
    quote: '<path d="M7 7H4v6h3l-1 4M17 7h-3v6h3l-1 4"/>',
    hr: '<path d="M3 12h18M7 7h.01M12 7h.01M17 7h.01"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>',
    clear: '<path d="M6 5h12M12 5l-4 14M4 19h8M15 14l6 6M21 14l-6 6"/>',
  };
  const icon = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;
  App.icon = icon;

  // ---------- UI ----------
  App.toast = (msg, bad) => {
    let box = $(".toasts");
    if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : ""); t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), bad ? 3500 : 2200);
  };
  App.fail = (e) => App.toast(e.message || String(e), true);

  // xl — крупное окно (визуальный редактор); sticky — не закрывать кликом мимо окна, чтобы не потерять текст
  App.modal = (title, html, onMount, { wide, xl, sticky, onClose } = {}) => {
    const root = $("#modal-root");
    const wrap = document.createElement("div");
    wrap.className = "modal-bg";
    wrap.innerHTML = `<div class="modal ${wide ? "wide" : ""} ${xl ? "xl" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="btn ghost sm" data-close aria-label="Закрыть">${icon("x")}</button></div>${html}</div>`;
    root.appendChild(wrap);
    let closed = false;
    const close = () => { if (closed) return; closed = true; wrap.remove(); onClose && onClose(); };
    if (!sticky) wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
    $$("[data-close]", wrap).forEach((b) => b.addEventListener("click", close));
    const m = $(".modal", wrap);
    onMount && onMount(m, close);
    $("input:not([type=hidden]):not([disabled]):not([type=checkbox]), textarea, select", m)?.focus();
    return close;
  };
  App.confirm = (text, okText = "Подтвердить") => new Promise((resolve) => {
    let result = false;
    App.modal("Подтверждение",
      `<p>${esc(text)}</p><div class="row"><button class="btn primary" data-ok>${esc(okText)}</button><button class="btn" data-close>Отмена</button></div>`,
      (m, close) => { $("[data-ok]", m).onclick = () => { result = true; close(); }; },
      { onClose: () => resolve(result) });
  });

  App.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); App.toast("Скопировано"); }
    catch { window.prompt("Скопируйте вручную:", text); }
  };

  // Отправка формы с блокировкой кнопки и выводом ошибки
  App.onSubmit = (form, handler) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit], button:not([type])", form);
      const err = $(".form-error", form);
      if (err) err.textContent = "";
      if (btn) btn.disabled = true;
      try { await handler(Object.fromEntries(new FormData(form)), form); }
      catch (ex) { if (err) err.textContent = ex.message; else App.fail(ex); }
      finally { if (btn) btn.disabled = false; }
    });
  };

  App.pageHead = (ic, title, sub, strong) => `
    <div class="page-head">${ic ? `<span class="ph-icon">${icon(ic)}</span>` : ""}
      <div><h1 class="${strong ? "strong" : ""}">${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div></div>`;
  App.empty = (ic, title, text = "", action = "") =>
    `<div class="empty">${icon(ic)}<b>${esc(title)}</b>${text ? `<div>${esc(text)}</div>` : ""}${action}</div>`;
  App.loading = () => `<div class="empty"><div class="spinner"></div></div>`;
  App.badge = (text, tone = "") => `<span class="badge ${tone}">${esc(text)}</span>`;
  App.statusTone = (s) => ({ new: "gray", in_work: "info", hold: "warn", approved: "ok", paid: "ok", rejected: "bad",
    pending: "warn", open: "info", answered: "ok", closed: "gray", requested: "warn", active: "ok", disabled: "gray" }[s] ?? "gray");

  App.tabs = (el, onChange) => {
    $$("[data-tab]", el).forEach((t) => t.addEventListener("click", () => {
      $$("[data-tab]", el).forEach((x) => x.classList.toggle("active", x === t));
      $$("[data-pane]", el).forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
      onChange && onChange(t.dataset.tab);
    }));
  };

  // Таблица с пагинацией
  App.pager = (meta, onPage) => {
    if (!meta || meta.total <= meta.per) return "";
    const pages = Math.ceil(meta.total / meta.per);
    const id = "pg" + Math.random().toString(36).slice(2);
    setTimeout(() => $$(`#${id} [data-p]`).forEach((b) => b.onclick = () => onPage(+b.dataset.p)));
    return `<div class="row pager" id="${id}"><span class="hint">Всего: ${meta.total}</span><span class="spacer"></span>
      <button class="btn sm" data-p="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""}>${icon("back")}</button>
      <span class="hint">${meta.page} / ${pages}</span>
      <button class="btn sm" data-p="${meta.page + 1}" ${meta.page >= pages ? "disabled" : ""}>${icon("chev")}</button></div>`;
  };

  // ---------- меню ----------
  // Разделы, которые видит пользователь. Админ в режиме «глазами тарифа» видит разделы этого тарифа.
  try { App.viewTariff = JSON.parse(localStorage.getItem("cab:viewTariff") || "null"); } catch { App.viewTariff = null; }
  const isAdmin = () => App.me?.role === "admin";
  App.features = () => (isAdmin() && App.viewTariff ? App.viewTariff.features : App.me?.features) || [];
  App.can = (...keys) => keys.some((k) => App.features().includes(k));
  App.programParam = () => (isAdmin() && App.viewTariff?.program_id ? `program=${App.viewTariff.program_id}` : "");
  App.setViewTariff = (t) => {
    App.viewTariff = t ? { id: t.id, name: t.name, features: t.features, program_id: t.program_id } : null;
    try { t ? localStorage.setItem("cab:viewTariff", JSON.stringify(App.viewTariff)) : localStorage.removeItem("cab:viewTariff"); } catch { /* ignore */ }
    renderShell();
    location.hash = "#/" + (t ? App.home() : "admin");
    render();
  };
  // Первая доступная страница — «главная» для этого тарифа
  const HOME_ORDER = [["dashboard", "dashboard"], ["learn", "learning"], ["manuals", "manuals"], ["offers", "offers"],
    ["favorites", "favorites"], ["conversions", "conversions"], ["stats", "stats"], ["support", "support"]];
  App.home = () => (HOME_ORDER.find(([, f]) => App.can(f)) || ["profile"])[0];

  function menu() {
    const s = App.cfg.settings, can = App.can;
    const items = [];
    if (can("dashboard")) items.push({ id: "dashboard", label: "Дашборд", icon: "home" });
    if (can("learning")) items.push({ id: "learning", label: s.learn_title || "Обучение", icon: "trend", children: [
      { id: "learn", label: "Роадмап", icon: "target" },
      { id: "lessons", label: "Уроки", icon: "play" },
      { id: "learn-materials", label: "Материалы", icon: "folder" },
    ] });
    if (can("manuals")) items.push({ id: "manuals", label: "Мануалы", icon: "book" });
    const partner = [
      { id: "offers", label: "Офферы", icon: "grid" },
      { id: "favorites", label: "Избранное и ссылки", icon: "star" },
      { id: "conversions", label: "Заявки", icon: "file" },
      { id: "stats", label: "Статистика", icon: "chart" },
    ].filter((c) => can(c.id));
    if (partner.length) items.push({ id: "partner", label: "Партнёрка", icon: "handshake", children: partner });
    if (can("support")) items.push({ id: "support", label: "Поддержка", icon: "chat" });
    if (isAdmin()) items.push({ id: "admin", label: "Админка", icon: "settings", children: App.adminMenu });
    return items;
  }
  let openGroups = [];
  try { openGroups = JSON.parse(localStorage.getItem("cab:groups") || "[]"); } catch { /* ignore */ }

  function renderNav() {
    const cur = route().name;
    $("#nav").innerHTML = menu().map((m) => {
      if (!m.children) return `<a class="nav-item ${cur === m.id ? "active" : ""}" href="#/${m.id}">${icon(m.icon)}${esc(m.label)}</a>`;
      const childActive = m.children.some((c) => c.id === cur);
      const open = childActive || openGroups.includes(m.id);
      return `<button class="nav-item ${childActive ? "active" : ""} ${open ? "open" : ""}" data-group="${m.id}">${icon(m.icon)}${esc(m.label)}${icon("chev", "chev")}</button>
        <div class="nav-sub ${open ? "open" : ""}">${m.children.map((c) =>
          `<a class="nav-item ${cur === c.id ? "active" : ""}" href="#/${c.id}">${icon(c.icon)}${esc(c.label)}${c.badge ? `<span class="count" data-count="${c.id}"></span>` : ""}</a>`).join("")}</div>`;
    }).join("");
    $$("[data-group]").forEach((b) => b.onclick = () => {
      const id = b.dataset.group;
      openGroups = openGroups.includes(id) ? openGroups.filter((x) => x !== id) : [...openGroups, id];
      try { localStorage.setItem("cab:groups", JSON.stringify(openGroups)); } catch { /* ignore */ }
      renderNav();
    });
    $$(".side-bottom [data-route]").forEach((a) => a.classList.toggle("active", a.dataset.route === cur));
    if (App.me?.role === "admin") App.refreshAdminCounts?.();
  }
  App.renderNav = renderNav;

  function renderShell() {
    const s = App.cfg.settings, me = App.me;
    document.title = `${s.brand_name} ${s.brand_accent}`.trim() || "Личный кабинет";
    $("#brand").innerHTML = `<span class="logo">${esc(s.logo_text)}</span><span>${esc(s.brand_name)} <b>${esc(s.brand_accent)}</b></span>`;
    $("#burger").innerHTML = icon("menu");
    $("#back").innerHTML = icon("back");
    $("#fab").innerHTML = icon("help");
    $("#side-bottom").innerHTML = `
      ${App.can("billing") ? `<a class="tariff" href="#/billing">${icon("card")}${esc(me.tariff?.name || "Без тарифа")}</a>`
        : `<div class="tariff">${icon("card")}${esc(me.tariff?.name || "Без тарифа")}</div>`}
      <div class="me"><span class="avatar">${esc(initial(me.name))}</span><div>${esc(me.name)}<small>${me.role === "admin" ? "Администратор" : "Пользователь"}</small></div></div>
      <a class="nav-item" data-route="profile" href="#/profile">${icon("user")}Профиль</a>
      ${App.can("income") ? `<a class="nav-item" data-route="income" href="#/income">${icon("wallet")}Доходы</a>` : ""}
      <a class="nav-item" data-route="password" href="#/password">${icon("key")}Сменить пароль</a>
      <button class="nav-item" id="logout">${icon("logout")}Выйти</button>`;
    $("#logout").onclick = async () => { try { await App.post("/api/auth/logout"); } catch { /* ignore */ } App.me = null; location.hash = ""; showAuth(); };
    $("#brand").href = "#/" + App.home();
    $("#fab").hidden = !App.can("support");
    $("#preview-bar").hidden = !(isAdmin() && App.viewTariff);
    $("#preview-bar").innerHTML = App.viewTariff ? `${icon("user")}<span>Вы смотрите сайт глазами тарифа <b>«${esc(App.viewTariff.name)}»</b></span>
      <button class="btn sm" id="preview-exit">Выйти из просмотра</button>` : "";
    $("#preview-exit")?.addEventListener("click", () => App.setViewTariff(null));
    $("#burger").onclick = () => document.body.classList.toggle("menu-open");
    $("#overlay").onclick = () => document.body.classList.remove("menu-open");
    $("#back").onclick = () => history.back();
    renderNav();
  }
  App.renderShell = renderShell;

  // ---------- роутер ----------
  function route() {
    const [name, ...rest] = location.hash.replace(/^#\/?/, "").split("/");
    return { name: App.pages[name] ? name : (App.me ? App.home() : "dashboard"), arg: rest.join("/") };
  }
  let renderSeq = 0;
  async function render() {
    if (!App.me) return;
    const { name, arg } = route();
    const p = App.pages[name];
    const blocked = (p.admin && !isAdmin()) || (p.feature && !App.can(...[].concat(p.feature)));
    if (blocked) { location.hash = "#/" + App.home(); return; }
    const crumbs = ["Главная", ...(p.crumbs || [])];
    $("#crumbs").innerHTML = crumbs.map((c, i) => i === 0 && crumbs.length > 1 ? `<a href="#/${App.home()}">${c}</a>` : esc(c)).join('<span class="sep">/</span>');
    const el = $("#page");
    el.classList.toggle("wide", !!p.wide); // широкие страницы с крупными карточками
    const seq = ++renderSeq;
    el.innerHTML = App.loading();
    renderNav();
    try {
      const tmp = document.createElement("div");
      await p.render(tmp, arg);
      if (seq !== renderSeq) return; // пользователь уже ушёл на другую страницу
      el.replaceChildren(...tmp.childNodes);
      for (const k of Object.keys(el)) if (k.startsWith("_")) delete el[k];
      for (const k of Object.keys(tmp)) if (k.startsWith("_")) el[k] = tmp[k]; // данные страницы для mount()
      p.mount && await p.mount(el, arg);
    } catch (e) {
      if (seq !== renderSeq) return;
      el.innerHTML = `<div class="card soft">${App.empty("warn", "Не удалось загрузить страницу", e.message)}</div>`;
    }
  }
  App.rerender = render;
  App.route = route;

  // ---------- вход / регистрация ----------
  // Вход — по логину и паролю. Регистрация — только по ссылке-приглашению: код из Telegram-бота, затем логин и пароль.
  const brandHtml = (s) => `<div class="brand" style="justify-content:center"><span class="logo">${esc(s.logo_text || "")}</span><span>${esc(s.brand_name || "")} <b>${esc(s.brand_accent || "")}</b></span></div>`;

  function showAuth(mode = "login", invite = null, notice = "") {
    $("#layout").hidden = true; $("#fab").hidden = true;
    const s = App.cfg?.settings || {};
    const el = $("#auth");
    el.hidden = false;
    if (mode === "register" && invite) return showRegister(el, s, invite);
    el.innerHTML = `<div class="auth-wrap"><form class="card auth-card" id="auth-form">${brandHtml(s)}
      ${notice ? `<div class="notice">${icon("warn")}<div>${esc(notice)}</div></div>` : ""}
      ${invite ? `<div class="notice">${icon("gift")}<div>Приглашение в <b>«${esc(invite.tariff)}»</b>. Войдите, чтобы активировать доступ.</div></div>` : ""}
      <h2>Вход в кабинет</h2>
      <div class="field"><label>Логин</label><input class="input" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
      <div class="field"><label>Пароль</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
      <div class="form-error"></div>
      <button class="btn primary block" type="submit">Войти</button>
      ${invite ? `<p class="hint center">Ещё нет аккаунта? <a href="#" class="link-btn" id="auth-switch">Зарегистрироваться</a></p>`
        : `<p class="hint center">Регистрация — только по ссылке-приглашению от администратора.</p>`}
      <p class="hint center m0">Забыли пароль? Напишите администратору — он задаст новый.</p>
    </form></div>`;
    $("#auth-switch")?.addEventListener("click", (e) => { e.preventDefault(); showAuth("register", invite); });
    App.onSubmit($("#auth-form"), async (d) => {
      App.me = await App.post("/api/auth/login", d);
      if (invite) location.hash = `#/join/${invite.code}`;
      await boot();
    });
  }
  App.showAuth = showAuth;

  function showRegister(el, s, invite) {
    const st = { token: "", url: "", verified: false, login: "", error: "" };
    const days = invite.days ? ` Доступ на ${invite.days} дн.` : "";
    const draw = () => {
      const step = (n, done, title, body) => `<div class="auth-step ${done ? "done" : ""}"><span class="n">${done ? icon("check") : n}</span>
        <div class="t"><b>${title}</b>${body ? `<div class="mt8">${body}</div>` : ""}</div></div>`;
      const s1 = st.url
        ? `<a class="btn primary block" href="${esc(st.url)}" target="_blank" rel="noopener" id="open-bot">${icon("send")}Получить код в Telegram</a>
           <p class="hint m0 mt8">Откроется бот — нажмите «Запустить» (Start), он пришлёт код.</p>`
        : st.error ? `<div class="form-error" style="display:block">${esc(st.error)}</div>` : App.loading();
      const s2 = `<form id="code-form"><div class="row"><input class="input code-input flex1" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="000000" required>
          <button class="btn" type="submit">Подтвердить</button></div><div class="form-error"></div>
          <p class="hint m0 mt8">Код не пришёл или устарел? <a href="#" class="link-btn" id="new-code">Получить новый</a></p></form>`;
      const s3 = `<form id="reg-form">
          <div class="field"><label>Логин</label><input class="input" name="login" value="${esc(st.login)}" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="латиница, цифры, _ . -">
            <span class="hint">По нему вы будете входить в кабинет</span></div>
          <div class="field"><label>Пароль</label><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="Минимум 8 символов"></div>
          <div class="field"><label>Повторите пароль</label><input class="input" name="password2" type="password" autocomplete="new-password" required></div>
          <div class="form-error"></div>
          <button class="btn primary block" type="submit">Зарегистрироваться</button></form>`;
      el.innerHTML = `<div class="auth-wrap"><div class="card auth-card">${brandHtml(s)}
        <div class="notice">${icon("gift")}<div>Приглашение в <b>«${esc(invite.tariff)}»</b>.${esc(days)}</div></div>
        <h2>Регистрация</h2>
        <div class="auth-steps">
          ${step(1, st.verified, "Подтвердите Telegram", st.verified ? "" : s1)}
          ${step(2, st.verified, "Введите код из бота", st.verified || !st.url ? "" : s2)}
          ${step(3, false, "Придумайте логин и пароль", st.verified ? s3 : "")}
        </div>
        <p class="hint center m0">Уже есть аккаунт? <a href="#" class="link-btn" id="auth-switch">Войти</a></p>
      </div></div>`;
      $("#auth-switch").onclick = (e) => { e.preventDefault(); showAuth("login", invite); };
      $("#open-bot")?.addEventListener("click", () => setTimeout(() => $("#code-form [name=code]")?.focus(), 300));
      $("#new-code")?.addEventListener("click", (e) => { e.preventDefault(); start(); });
      const cf = $("#code-form");
      if (cf) App.onSubmit(cf, async (d) => {
        const r = await App.post("/api/auth/tg/check", { token: st.token, code: d.code });
        Object.assign(st, { verified: true, login: r.login || "" });
        draw(); $("#reg-form [name=login]")?.focus();
      });
      const rf = $("#reg-form");
      if (rf) App.onSubmit(rf, async (d) => {
        if (d.password !== d.password2) throw new Error("Пароли не совпадают");
        App.me = await App.post("/api/auth/register", { token: st.token, login: d.login, password: d.password });
        location.hash = "#/";
        await boot();
      });
    };
    const start = async () => {
      Object.assign(st, { url: "", error: "" }); draw();
      try { Object.assign(st, await App.post("/api/auth/tg/start", { invite: invite.code })); }
      catch (e) { st.error = e.message; }
      draw();
    };
    start();
  }

  async function boot() {
    const cfg = await App.get("/api/config");
    App.cfg = cfg; App.me = cfg.me;
    if (!App.me) {
      const r = route();
      if (r.name === "join" && r.arg) {
        try { const inv = await App.get(`/api/invite/${encodeURIComponent(r.arg)}`); return showAuth("register", { ...inv, code: r.arg }); }
        catch (e) { return showAuth("login", null, e.message); }
      }
      return showAuth();
    }
    $("#auth").hidden = true; $("#auth").innerHTML = "";
    $("#layout").hidden = false; $("#fab").hidden = false;
    renderShell();
    await render();
  }
  App.reloadMe = async () => { App.me = await App.get("/api/me"); renderShell(); };
  App.reloadConfig = async () => { App.cfg = await App.get("/api/config"); App.me = App.cfg.me; renderShell(); };

  App.start = () => {
    window.addEventListener("hashchange", () => {
      document.body.classList.remove("menu-open");
      $("#modal-root").innerHTML = "";
      render(); window.scrollTo(0, 0);
    });
    boot().catch((e) => {
      document.body.innerHTML = `<div class="auth-wrap"><div class="card auth-card">${App.empty("warn", "Сервер недоступен", e.message)}</div></div>`;
    });
  };

  return App;
})();
