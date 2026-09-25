/* Админка: управление пользователями, контентом, заявками, трафиком и настройками. */
(() => {
  const { $, $$, esc, money, fmtDate, fmtDateTime, isoDay, qs, icon, linkify, cover } = App;
  const P = App.pages;

  App.adminMenu = [
    { id: "admin", label: "Обзор", icon: "grid" },
    { id: "a-users", label: "Пользователи", icon: "users" },
    { id: "a-conversions", label: "Заявки", icon: "file", badge: true },
    { id: "a-links", label: "Ссылки", icon: "link", badge: true },
    { id: "a-learning", label: "Обучение", icon: "trend" },
    { id: "a-offers", label: "Офферы", icon: "handshake" },
    { id: "a-topups", label: "Пополнения", icon: "card", badge: true },
    { id: "a-tickets", label: "Поддержка", icon: "chat", badge: true },
    { id: "a-articles", label: "Статьи", icon: "book" },
    { id: "a-materials", label: "Материалы", icon: "folder" },
    { id: "a-news", label: "Новости", icon: "news" },
    { id: "a-team", label: "Команда", icon: "users" },
    { id: "a-tariffs", label: "Тарифы", icon: "card" },
    { id: "a-settings", label: "Настройки и тексты", icon: "settings" },
  ];

  // Счётчики в меню (не чаще раза в 20 секунд)
  let countsAt = 0, counts = null;
  App.refreshAdminCounts = async (force) => {
    if (force || Date.now() - countsAt > 20000) {
      countsAt = Date.now();
      try { counts = await App.get("/api/admin/overview"); } catch { return; }
    }
    if (!counts) return;
    const map = { "a-conversions": counts.conversions_new, "a-links": counts.links_requested, "a-topups": counts.topups_pending, "a-tickets": counts.tickets_open };
    $$("[data-count]").forEach((s) => { const n = map[s.dataset.count]; s.textContent = n || ""; s.hidden = !n; });
  };

  const argParams = (arg) => Object.fromEntries(new URLSearchParams(arg || ""));
  const yesNo = (v) => v ? `<span class="ok">${icon("check")}</span>` : `<span class="muted">—</span>`;
  let tariffsCache = null;
  const loadTariffs = async (force) => (tariffsCache = (!force && tariffsCache) || await App.get("/api/admin/r/tariffs"));
  let schemaCache = null;
  const loadSchema = async () => (schemaCache = schemaCache || await App.get("/api/admin/schema"));

  let programsCache = null;
  const loadPrograms = async (force) => (programsCache = (!force && programsCache) || await App.get("/api/admin/r/programs"));
  const resetCaches = (res) => { if (res === "tariffs") tariffsCache = null; if (res === "programs") programsCache = null; };

  // ---------- конструктор полей формы ----------
  const checks = (name, options, selected) => `<div class="checks">${options.map(([val, label]) =>
    `<label class="check"><input type="checkbox" name="${name}" value="${esc(val)}" ${selected.includes(val) ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div>`;

  function fieldHtml(f, value, isNew) {
    const defTrue = ["is_active", "is_published", "is_public", "show_in_manuals"].includes(f.name);
    const v = value ?? (f.type === "bool" ? defTrue : "");
    const req = f.required ? "required" : "";
    const lbl = `${esc(f.label)}${f.required ? " *" : ""}`;
    switch (f.type) {
      case "text":
        return `<div class="field"><label>${lbl}</label><textarea class="input" name="${f.name}" rows="${f.name === "body" ? 10 : 4}" ${req}>${esc(v)}</textarea>
          ${f.name === "body" ? `<span class="hint">Форматирование: «# Заголовок», «## Подзаголовок», «- пункт списка», **жирный**. Ссылки становятся кликабельными.</span>` : ""}</div>`;
      case "bool":
        return `<label class="row gap8 mb"><span class="switch"><input type="checkbox" name="${f.name}" ${v ? "checked" : ""}><span></span></span>${lbl}</label>`;
      case "money":
        return `<div class="field"><label>${lbl}</label><input class="input" name="${f.name}" type="number" step="0.01" min="0" value="${esc(v)}" ${req}></div>`;
      case "int":
        return `<div class="field"><label>${lbl}</label><input class="input" name="${f.name}" type="number" step="1" value="${esc(v === "" ? 0 : v)}" ${req}></div>`;
      case "tariff":
        return `<div class="field"><label>${lbl}</label><select class="input" name="${f.name}"><option value="">— любой —</option>
          ${(tariffsCache || []).map((t) => `<option value="${t.id}" ${+v === t.id ? "selected" : ""}>${esc(t.name)} (уровень ${t.level})</option>`).join("")}</select></div>`;
      case "program":
        return `<div class="field"><label>${lbl}</label><select class="input" name="${f.name}" ${req}><option value="">— нет —</option>
          ${(programsCache || []).map((p) => `<option value="${p.id}" ${+v === p.id ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></div>`;
      case "programs":
        return (programsCache || []).length ? `<div class="field"><label>${lbl}</label>${checks(f.name, programsCache.map((p) => [String(p.id), p.title]), (v || []).map(String))}</div>` : "";
      case "features": {
        const sel = isNew ? schemaCache.features.map((x) => x.key).filter((k) => k !== "learning") : v || [];
        return `<div class="field"><label>${lbl}</label>${checks(f.name, schemaCache.features.map((x) => [x.key, x.label]), sel)}
          <span class="hint">Профиль, смена пароля и выход доступны всегда.</span></div>`;
      }
      case "url":
        return `<div class="field"><label>${lbl}</label><input class="input" name="${f.name}" type="url" placeholder="https://" value="${esc(v)}" ${req}></div>`;
      default:
        return `<div class="field"><label>${lbl}</label><input class="input" name="${f.name}" value="${esc(v)}" ${req}></div>`;
    }
  }
  function readForm(form, fields) {
    const out = {};
    for (const f of fields) {
      if (f.type === "features" || f.type === "programs") {
        const vals = $$(`input[name="${f.name}"]:checked`, form).map((i) => i.value);
        out[f.name] = f.type === "programs" ? vals.map(Number) : vals;
        continue;
      }
      const inp = form.elements[f.name];
      if (!inp) continue;
      out[f.name] = f.type === "bool" ? inp.checked : inp.value;
    }
    return out;
  }

  // ---------- превью в формах ----------
  function coverFields(item, sourceLabel) {
    return `<div class="field cover-edit"><label>Превью</label>
      <div class="row top"><div class="cover-thumb" data-thumb>${cover(item?.cover, item?.title || item?.name)}</div>
        <div class="flex1">
          <input type="file" name="cover_file" accept="image/png,image/jpeg,image/webp,image/gif">
          <input class="input mt8" name="cover_url" type="url" placeholder="…или ссылка на картинку https://">
          ${sourceLabel ? `<label class="row gap8 mt8 small"><input type="checkbox" name="cover_auto" ${item?.cover ? "" : "checked"}>Подтянуть автоматически из ${esc(sourceLabel)}</label>` : ""}
          ${item?.cover ? `<label class="row gap8 mt8 small"><input type="checkbox" name="cover_remove">Удалить превью</label>` : ""}
          <span class="hint">JPG, PNG, WEBP до 5 МБ. Лучше горизонтальная 16:9.</span>
        </div></div></div>`;
  }
  function bindCoverPreview(form) {
    const f = form.elements.cover_file;
    f?.addEventListener("change", () => {
      if (f.files[0]) $("[data-thumb]", form).innerHTML = `<div class="cover"><img src="${URL.createObjectURL(f.files[0])}" alt=""></div>`;
    });
  }
  async function applyCover(kind, id, form, sourceValue) {
    const url = `/api/admin/cover/${kind}/${id}`;
    const file = form.elements.cover_file?.files[0];
    if (file) { const fd = new FormData(); fd.append("file", file); return App.api("POST", url, undefined, { form: fd }); }
    const link = form.elements.cover_url?.value.trim();
    if (link) return App.post(url, { url: link });
    if (form.elements.cover_remove?.checked) return App.del(url);
    if (form.elements.cover_auto?.checked && sourceValue) {
      try { await App.post(url, { auto: true }); }
      catch (e) { App.toast("Превью не подтянулось: " + e.message, true); }
    }
  }

  // ---------- универсальный список + форма ----------
  // o: columns, hidden, defaults, filter, cover {kind, source, label}, reorder, rowHref, extra(item), onModal(m, item), bind(box, items)
  async function crudBlock(box, res, o) {
    await Promise.all([loadSchema(), loadTariffs(), loadPrograms()]);
    const hidden = [...(o.hidden || []), ...(o.reorder ? ["sort"] : [])]; // порядок меняется стрелками
    const fields = schemaCache.resources[res].filter((f) => !hidden.includes(f.name));
    let items = [];
    const load = async () => { const all = await App.get(`/api/admin/r/${res}`); items = o.filter ? all.filter(o.filter) : all; };
    box.innerHTML = `<div class="row mb"><button class="btn primary" data-add>${icon("plus")}${esc(o.addLabel || "Добавить")}</button>
      <div class="input-icon w280">${icon("search")}<input class="input" data-flt placeholder="Поиск"></div></div><div data-list></div>`;
    const draw = () => {
      const q = $("[data-flt]", box).value.toLowerCase().trim();
      const list = items.filter((it) => JSON.stringify(it).toLowerCase().includes(q));
      const canMove = o.reorder && !q;
      $("[data-list]", box).innerHTML = list.length ? `<div class="table-wrap"><table><tr>${canMove ? "<th></th>" : ""}${o.columns.map((c) => `<th>${c[0]}</th>`).join("")}<th></th></tr>
        ${list.map((it, i) => `<tr class="clickable" data-id="${it.id}">
          ${canMove ? `<td class="nowrap move"><button class="btn sm ghost" data-up="${i}" ${i ? "" : "disabled"} title="Выше">${icon("up")}</button><button class="btn sm ghost" data-down="${i}" ${i < list.length - 1 ? "" : "disabled"} title="Ниже">${icon("down")}</button></td>` : ""}
          ${o.columns.map((c) => `<td>${c[1](it)}</td>`).join("")}
          <td class="nowrap"><button class="btn sm ghost" data-edit="${it.id}" title="Изменить">${icon("edit")}</button><button class="btn sm ghost" data-del="${it.id}" title="Удалить">${icon("trash")}</button></td></tr>`).join("")}</table></div>`
        : `<div class="card soft">${App.empty(o.icon || "list", items.length ? "Ничего не найдено" : "Пока пусто", items.length ? "" : "Нажмите «Добавить».")}</div>`;
      $$("tr.clickable", box).forEach((tr) => tr.onclick = (e) => {
        if (e.target.closest("button, a, input, label")) return;
        const it = items.find((x) => x.id === +tr.dataset.id);
        if (o.rowHref) location.hash = o.rowHref(it); else open(it);
      });
      $$("[data-edit]", box).forEach((b) => b.onclick = () => open(items.find((x) => x.id === +b.dataset.edit)));
      $$("[data-del]", box).forEach((b) => b.onclick = async () => {
        if (!(await App.confirm(o.deleteText || "Удалить запись без возможности восстановления?", "Удалить"))) return;
        try { await App.del(`/api/admin/r/${res}/${b.dataset.del}`); resetCaches(res); App.toast("Удалено"); await load(); draw(); } catch (ex) { App.fail(ex); }
      });
      const move = async (i, d) => {
        const ids = list.map((x) => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
        try { await App.post(`/api/admin/reorder/${res}`, { ids }); await load(); draw(); } catch (ex) { App.fail(ex); }
      };
      $$("[data-up]", box).forEach((b) => b.onclick = () => move(+b.dataset.up, -1));
      $$("[data-down]", box).forEach((b) => b.onclick = () => move(+b.dataset.down, 1));
      o.bind && o.bind(box, items);
    };
    const open = (item) => App.modal(item ? "Редактирование" : (o.addLabel || "Новая запись"), `
      <form id="cf">${fields.map((f) => fieldHtml(f, item?.[f.name], !item)).join("")}
        ${o.cover ? coverFields(item, o.cover.label) : ""}${o.extra ? o.extra(item) : ""}
        <div class="form-error"></div>
        <div class="row sticky-actions"><button class="btn primary" type="submit">Сохранить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
      (m, close) => {
        const form = $("#cf", m);
        bindCoverPreview(form);
        o.onModal && o.onModal(m, item);
        App.onSubmit(form, async () => {
          const data = { ...readForm(form, fields), ...(o.defaults || {}), ...(o.beforeSave ? o.beforeSave(form) : {}) };
          const saved = item ? await App.put(`/api/admin/r/${res}/${item.id}`, data) : await App.post(`/api/admin/r/${res}`, data);
          if (o.cover) await applyCover(o.cover.kind, saved.id, form, o.cover.source ? data[o.cover.source] ?? item?.[o.cover.source] : "");
          resetCaches(res);
          close(); App.toast("Сохранено"); await load(); draw();
        });
      }, { wide: true });
    $("[data-add]", box).onclick = () => open(null);
    $("[data-flt]", box).oninput = draw;
    await load(); draw();
    return { reload: async () => { await load(); draw(); } };
  }
  function crudPage(res, o) {
    return {
      admin: true, crumbs: ["Админка", o.title],
      async render(el) { el.innerHTML = `${App.pageHead(o.icon, o.title, o.sub)}<div data-crud></div>`; },
      async mount(el) { await crudBlock($("[data-crud]", el), res, o); },
    };
  }
  const thumb = (x) => `<div class="thumb-sm">${cover(x.cover, x.title || x.name)}</div>`;
  const placeCol = (a) => [a.show_in_manuals ? "Мануалы" : "", ...(a.program_ids || []).map((id) => (programsCache || []).find((p) => p.id === id)?.title)]
    .filter(Boolean).map((x) => App.badge(x, "gray")).join(" ") || `<span class="muted">скрыто</span>`;

  P["a-offers"] = crudPage("offers", {
    title: "Офферы", icon: "handshake", sub: "Каталог офферов. Ставка пользователя = базовая выплата × % его тарифа.", reorder: true,
    columns: [["Партнёр", (o) => esc(o.partner)], ["Название", (o) => `<b>${esc(o.name)}</b>`], ["Тип", (o) => esc(o.type)],
      ["Выплата", (o) => `<span class="mono">${money(o.payout)}</span>`], ["Лимит", (o) => o.limit_default || "—"],
      ["Опубликован", (o) => yesNo(o.is_active)]],
  });
  P["a-articles"] = crudPage("articles", {
    title: "Статьи", icon: "book", sub: "Общая база статей. Галочками выбирается, где статья видна: в «Мануалах» и/или в программах обучения.",
    reorder: true, cover: { kind: "articles", source: "url", label: "внешней ссылки (Teletype, сайт и т.п.)" },
    columns: [["", thumb], ["Заголовок", (a) => `<b>${esc(a.title)}</b><div class="hint">${esc(a.category)}</div>`],
      ["Где видна", placeCol], ["Опубликована", (a) => yesNo(a.is_published)], ["Создана", (a) => fmtDate(a.created_at)]],
  });
  P["a-news"] = crudPage("news", {
    title: "Новости", icon: "news", sub: "Уведомления на главной странице кабинета.",
    columns: [["Заголовок", (n) => `<b>${esc(n.title)}</b>`], ["Текст", (n) => `<span class="clip1">${esc(n.body)}</span>`], ["Дата", (n) => fmtDateTime(n.created_at)]],
    extra: (item) => item ? "" : `<label class="row gap8 mb"><span class="switch"><input type="checkbox" name="broadcast"><span></span></span>Разослать в Telegram (если бот настроен)</label>`,
    beforeSave: (form) => ({ broadcast: form.elements.broadcast?.checked || false }),
  });
  P["a-team"] = crudPage("team", {
    title: "Команда", icon: "users", sub: "Блок «Команда и каналы» на главной.", reorder: true,
    columns: [["Имя", (t) => `<b>${esc(t.name)}</b>`], ["Роль", (t) => esc(t.role)], ["Ссылки", (t) => esc(t.links).replace(/\n/g, ", ")]],
  });

  // ---------- тарифы ----------
  const inviteLink = (code) => `${location.origin}/join/${code}`;
  P["a-tariffs"] = crudPage("tariffs", {
    title: "Тарифы", icon: "card", addLabel: "Новый тариф",
    sub: "Галочками выбираются разделы, которые видит человек. Кнопка «Смотреть» покажет сайт глазами тарифа.",
    deleteText: "Удалить тариф? Пользователи на нём останутся без тарифа.",
    columns: [
      ["Название", (t) => `<b>${esc(t.name)}</b> <span class="hint">${esc(t.code)}</span>${t.is_default ? " " + App.badge("по умолчанию", "gray") : ""}`],
      ["Разделы", (t) => `<span class="small">${t.features.map((k) => esc(schemaCache.features.find((f) => f.key === k)?.label.split(" (")[0] || k)).join(", ") || "—"}</span>`],
      ["Программа", (t) => esc((programsCache || []).find((p) => p.id === t.program_id)?.title || "—")],
      ["Цена", (t) => t.price ? `${money(t.price)} / ${t.period_days} дн.` : "бесплатно"],
      ["Приглашение", (t) => t.invite_enabled ? `<button class="btn sm" data-invite="${esc(t.invite_code)}">${icon("copy")}Ссылка</button>` : `<span class="muted">выкл.</span>`],
      ["", (t) => `<button class="btn sm ghost" data-view="${t.id}">${icon("eye")}Смотреть</button>`],
    ],
    extra: (t) => t ? `<div class="notice">${icon("link")}<div class="minw0">Ссылка-приглашение: <span class="mono break">${esc(inviteLink(t.invite_code))}</span>
      <div class="row mt8"><button type="button" class="btn sm" data-copyinv>${icon("copy")}Копировать</button><button type="button" class="btn sm ghost" data-regen>Сменить ссылку</button></div>
      <span class="hint">После смены старая ссылка перестанет работать.</span></div></div>` : "",
    onModal: (m, t) => {
      if (!t) return;
      $("[data-copyinv]", m).onclick = () => App.copy(inviteLink(t.invite_code));
      $("[data-regen]", m).onclick = async () => {
        if (!(await App.confirm("Сменить ссылку? Старая перестанет работать."))) return;
        try { const r = await App.post(`/api/admin/tariffs/${t.id}/invite`); t.invite_code = r.invite_code; $(".mono", m).textContent = inviteLink(r.invite_code); App.toast("Новая ссылка готова"); }
        catch (e) { App.fail(e); }
      };
    },
    bind: (box, items) => {
      $$("[data-invite]", box).forEach((b) => b.onclick = () => App.copy(inviteLink(b.dataset.invite)));
      $$("[data-view]", box).forEach((b) => b.onclick = () => App.setViewTariff(items.find((t) => t.id === +b.dataset.view)));
    },
  });

  // ---------- обучение ----------
  P["a-learning"] = {
    admin: true, crumbs: ["Админка", "Обучение"],
    async render(el) {
      el.innerHTML = `${App.pageHead("trend", "Обучение", "Программы: роадмап, уроки и материалы. Программа показывается ученикам через тариф.")}
        <div class="notice">${icon("help")}<div>Чтобы ученики увидели программу: <a class="link-btn" href="#/a-tariffs">Тарифы</a> → откройте тариф → включите «Обучение» и выберите программу.</div></div>
        <div data-crud></div>`;
    },
    async mount(el) {
      await crudBlock($("[data-crud]", el), "programs", {
        icon: "trend", addLabel: "Новая программа", cover: { kind: "programs" },
        deleteText: "Удалить программу вместе со всеми уроками, шагами и прогрессом учеников?",
        rowHref: (p) => `#/a-program/${p.id}`,
        columns: [["", thumb], ["Программа", (p) => `<b>${esc(p.title)}</b><div class="hint clip1">${esc(p.description)}</div>`],
          ["Тарифы", (p) => (tariffsCache || []).filter((t) => t.program_id === p.id).map((t) => App.badge(t.name, "gray")).join(" ") || `<span class="muted">не привязана</span>`],
          ["", (p) => `<a class="btn sm primary" href="#/a-program/${p.id}">Открыть${icon("chev")}</a>`]],
      });
    },
  };

  const TARGETS = [["", "Никуда"], ["lesson", "Урок"], ["article", "Статья"], ["material", "Файл / материал"], ["url", "Ссылка"]];
  let programTab = "steps";
  P["a-program"] = {
    admin: true, crumbs: ["Админка", "Обучение", "Программа"],
    async render(el, id) {
      const p = (await loadPrograms(true)).find((x) => x.id === +id);
      if (!p) throw new Error("Программа не найдена");
      el._p = p;
      el.innerHTML = `<a class="link-btn" href="#/a-learning">${icon("back")} Все программы</a>
        <div class="row mt mb"><h1 class="m0 flex1">${esc(p.title)}</h1>
          <button class="btn sm" id="preview-prog">${icon("eye")}Как видит ученик</button></div>
        <div class="tabs">${[["steps", "Роадмап"], ["lessons", "Уроки"], ["mats", "Материалы"]].map(([k, l]) =>
          `<button class="tab ${programTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
        <div data-pane="steps" ${programTab === "steps" ? "" : "hidden"}></div>
        <div data-pane="lessons" ${programTab === "lessons" ? "" : "hidden"}></div>
        <div data-pane="mats" ${programTab === "mats" ? "" : "hidden"}></div>`;
    },
    async mount(el) {
      const p = el._p;
      const loaders = {
        steps: () => stepsEditor($('[data-pane="steps"]', el), p.id),
        lessons: () => crudBlock($('[data-pane="lessons"]', el), "lessons", {
          icon: "play", addLabel: "Новый урок", reorder: true, hidden: ["program_id"], defaults: { program_id: p.id },
          filter: (l) => l.program_id === p.id, cover: { kind: "lessons", source: "video_url", label: "видео (YouTube, RuTube и др.)" },
          columns: [["", thumb], ["№", (l) => `<span data-num="${l.id}"></span>`], ["Урок", (l) => `<b>${esc(l.title)}</b><div class="hint clip1">${esc(l.video_url || "без видео")}</div>`],
            ["Длительность", (l) => esc(l.duration || "—")], ["Опубликован", (l) => yesNo(l.is_published)]],
          bind: (box, items) => items.forEach((l, i) => { const c = $(`[data-num="${l.id}"]`, box); if (c) c.textContent = i + 1; }),
        }),
        mats: () => materialsPicker($('[data-pane="mats"]', el), p.id),
      };
      // Вкладки перезагружаются при каждом открытии — новый урок сразу виден в шагах и т.п.
      const show = (k) => { programTab = k; loaders[k]().catch(App.fail); };
      App.tabs(el, show);
      show(programTab);
      $("#preview-prog", el).onclick = async () => {
        const t = (await loadTariffs(true)).find((x) => x.program_id === p.id);
        App.setViewTariff(t || { id: 0, name: p.title, features: ["learning", "support"], program_id: p.id });
      };
    },
  };

  async function stepsEditor(box, pid) {
    const [steps, lessonsAll, arts, mats] = await Promise.all([App.get(`/api/admin/programs/${pid}/steps`), App.get("/api/admin/r/lessons"),
      App.get("/api/admin/r/articles"), App.get("/api/admin/materials")]);
    const lessons = lessonsAll.filter((l) => l.program_id === pid);
    const options = { lesson: lessons.map((l, i) => [l.id, `Урок ${i + 1}. ${l.title}`]), article: arts.map((a) => [a.id, a.title]), material: mats.map((m) => [m.id, m.title]) };
    const targetText = (s) => {
      if (s.target_type === "url") return s.target_url;
      const opt = (options[s.target_type] || []).find(([id]) => id === s.target_id);
      return opt ? opt[1] : "";
    };
    const reload = () => stepsEditor(box, pid);
    box.innerHTML = `<p class="hint">Точки на линии роадмапа. Внутри шага — задачи-галочки. Шаг без задач отмечается целиком, а если он ведёт на урок — сам, когда урок пройден.</p>
      <div class="step-list">${steps.map((s, i) => `
        <div class="step-row"><span class="step-num">${i + 1}</span>
          <div class="flex1 minw0"><b>${esc(s.title)}</b>
            <div class="hint">${s.target_type ? `→ ${esc(TARGETS.find(([k]) => k === s.target_type)[1])}: ${esc(targetText(s))}` : "без ссылки"} · задач: ${s.tasks.length}</div></div>
          <button class="btn sm ghost" data-up="${i}" ${i ? "" : "disabled"}>${icon("up")}</button><button class="btn sm ghost" data-down="${i}" ${i < steps.length - 1 ? "" : "disabled"}>${icon("down")}</button>
          <button class="btn sm ghost" data-edit="${s.id}">${icon("edit")}</button><button class="btn sm ghost" data-del="${s.id}">${icon("trash")}</button></div>`).join("")
        || `<div class="card soft">${App.empty("target", "Шагов пока нет")}</div>`}</div>
      <button class="btn primary mt" data-add>${icon("plus")}Добавить шаг</button>`;
    const move = async (i, d) => { const ids = steps.map((x) => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; await App.post("/api/admin/reorder/steps", { ids }).catch(App.fail); reload(); };
    $$("[data-up]", box).forEach((b) => b.onclick = () => move(+b.dataset.up, -1));
    $$("[data-down]", box).forEach((b) => b.onclick = () => move(+b.dataset.down, 1));
    $$("[data-del]", box).forEach((b) => b.onclick = async () => {
      if (await App.confirm("Удалить шаг вместе с задачами и отметками учеников?", "Удалить")) { await App.del(`/api/admin/steps/${b.dataset.del}`).catch(App.fail); reload(); }
    });
    $$("[data-edit]", box).forEach((b) => b.onclick = () => open(steps.find((s) => s.id === +b.dataset.edit)));
    $("[data-add]", box).onclick = () => open(null);

    function open(st) {
      const taskRow = (t) => `<div class="task-edit" data-tid="${t?.id || ""}"><input class="input" value="${esc(t?.text || "")}" placeholder="Что нужно сделать">
        <button type="button" class="btn sm ghost" data-rm>${icon("x")}</button></div>`;
      App.modal(st ? "Шаг роадмапа" : "Новый шаг", `<form id="sf">
        <div class="field"><label>Название шага *</label><input class="input" name="title" value="${esc(st?.title || "")}" required placeholder="Например: Первая работа по ссылкам"></div>
        <div class="field"><label>Пояснение</label><textarea class="input" name="description" rows="3">${esc(st?.description || "")}</textarea></div>
        <div class="grid g2"><div class="field"><label>Кнопка шага ведёт</label><select class="input" name="target_type">${TARGETS.map(([k, l]) => `<option value="${k}" ${st?.target_type === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="field" data-target></div></div>
        <div class="field"><label>Задачи (галочки для ученика)</label><div data-tasks>${(st?.tasks || []).map(taskRow).join("")}</div>
          <button type="button" class="btn sm mt8" data-addtask>${icon("plus")}Задача</button></div>
        <div class="form-error"></div>
        <div class="row"><button class="btn primary" type="submit">Сохранить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
      (m, close) => {
        const form = $("#sf", m), tbox = $("[data-tasks]", m);
        const drawTarget = () => {
          const t = form.target_type.value, box2 = $("[data-target]", m);
          if (t === "url") box2.innerHTML = `<label>Ссылка</label><input class="input" name="target_url" type="url" placeholder="https://" value="${esc(st?.target_url || "")}">`;
          else if (options[t]) box2.innerHTML = `<label>${t === "lesson" ? "Урок" : t === "article" ? "Статья" : "Материал"}</label>
            <select class="input" name="target_id">${options[t].map(([id, l]) => `<option value="${id}" ${st?.target_id === id ? "selected" : ""}>${esc(l)}</option>`).join("") || "<option value=''>— пусто —</option>"}</select>`;
          else box2.innerHTML = "";
        };
        const bindRm = () => $$("[data-rm]", tbox).forEach((b) => b.onclick = () => b.closest(".task-edit").remove());
        form.target_type.onchange = drawTarget; drawTarget(); bindRm();
        $("[data-addtask]", m).onclick = () => { tbox.insertAdjacentHTML("beforeend", taskRow(null)); bindRm(); $(".task-edit:last-child input", tbox).focus(); };
        App.onSubmit(form, async (d) => {
          d.tasks = $$(".task-edit", tbox).map((r) => ({ id: r.dataset.tid ? +r.dataset.tid : null, text: $("input", r).value }));
          if (st) await App.put(`/api/admin/steps/${st.id}`, d); else await App.post(`/api/admin/programs/${pid}/steps`, d);
          close(); App.toast("Сохранено"); reload();
        });
      }, { wide: true });
    }
  }

  async function materialsPicker(box, pid) {
    const [arts, mats] = await Promise.all([App.get("/api/admin/r/articles"), App.get("/api/admin/materials")]);
    const row = (x, kind) => `<label class="pick-row">${thumb(x)}<div class="flex1 minw0"><b>${esc(x.title)}</b><div class="hint">${kind === "a" ? "статья" : "файл"}${x.show_in_manuals ? " · также в «Мануалах»" : ""}</div></div>
      <span class="switch"><input type="checkbox" data-${kind}="${x.id}" ${x.program_ids.includes(pid) ? "checked" : ""}><span></span></span></label>`;
    box.innerHTML = `<p class="hint">Отметьте статьи и файлы, которые ученики увидят в разделе «Материалы» этой программы.</p>
      <div class="row mb"><a class="btn sm" href="#/a-articles">${icon("plus")}Новая статья</a><a class="btn sm" href="#/a-materials">${icon("plus")}Новый файл</a></div>
      <div class="card"><div class="card-title">${icon("book")}Статьи</div>${arts.map((a) => row(a, "a")).join("") || App.empty("book", "Статей нет")}</div>
      <div class="card"><div class="card-title">${icon("folder")}Файлы</div>${mats.map((m) => row(m, "m")).join("") || App.empty("folder", "Файлов нет")}</div>`;
    const ids = (list, on, id) => { const s = new Set(list); on ? s.add(id) : s.delete(id); return [...s]; };
    $$("[data-a]", box).forEach((c) => c.onchange = async () => {
      const a = arts.find((x) => x.id === +c.dataset.a);
      try { a.program_ids = ids(a.program_ids, c.checked, pid); await App.put(`/api/admin/r/articles/${a.id}`, { program_ids: a.program_ids }); App.toast("Сохранено"); }
      catch (e) { App.fail(e); c.checked = !c.checked; }
    });
    $$("[data-m]", box).forEach((c) => c.onchange = async () => {
      const m = mats.find((x) => x.id === +c.dataset.m);
      const fd = new FormData();
      m.program_ids = ids(m.program_ids, c.checked, pid);
      m.program_ids.forEach((id) => fd.append("program_ids", id));
      if (!m.program_ids.length) fd.append("program_ids", "");
      try { await App.api("POST", `/api/admin/materials/${m.id}`, undefined, { form: fd }); App.toast("Сохранено"); }
      catch (e) { App.fail(e); c.checked = !c.checked; }
    });
  }

  // ---------- обзор ----------
  P.admin = {
    admin: true, crumbs: ["Админка"],
    async render(el) {
      const o = await App.get("/api/admin/overview");
      counts = o; countsAt = Date.now();
      const card = (href, ic, label, val, hint, tone = "") => `<a class="stat link" href="${href}"><div class="lbl">${icon(ic)}${label}</div><div class="val ${tone}">${val}</div><small>${hint}</small></a>`;
      el.innerHTML = `${App.pageHead("settings", "Админка", "Управление кабинетом")}
        <div class="grid g3 mb">
          ${card("#/a-users", "users", "Пользователи", o.users, `+${o.new_users_7d} за 7 дней`)}
          ${card("#/a-conversions/status=new", "file", "Новые заявки", o.conversions_new, "новые и в работе", o.conversions_new ? "accent" : "")}
          ${card("#/a-links", "link", "Ссылки ждут выдачи", o.links_requested, "запрошены пользователями", o.links_requested ? "accent" : "")}
          ${card("#/a-topups", "card", "Пополнения", o.topups_pending, "ждут проверки", o.topups_pending ? "accent" : "")}
          ${card("#/a-tickets", "chat", "Обращения", o.tickets_open, "ждут ответа", o.tickets_open ? "accent" : "")}
        </div>
        <div class="card"><div class="card-title">${icon("link")}Интеграции</div>
          <div class="setting"><div class="txt"><b>Партнёрский API</b><span class="muted">${o.partner_api
            ? "Подключён: ссылки выдаются автоматически."
            : "Пока не подключён (заглушка в backend/partner_api.py). Ссылки выдаются вручную в разделе «Ссылки»."}</span></div>
            ${o.partner_api ? `<button class="btn sm" id="sync">Синхронизировать статусы</button>` : App.badge("заглушка", "gray")}</div>
          <div class="setting"><div class="txt"><b>Telegram-бот</b><span class="muted">${o.telegram
            ? "Токен задан. Нажмите, чтобы подключить вебхук (нужен HTTPS-адрес сайта)."
            : "Не настроен: задайте переменные TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME."}</span></div>
            ${o.telegram ? `<button class="btn sm" id="hook">Подключить вебхук</button>` : App.badge("выключен", "gray")}</div>
        </div>`;
    },
    mount(el) {
      $("#hook", el)?.addEventListener("click", async () => { try { await App.post("/api/admin/telegram/webhook"); App.toast("Вебхук подключён"); } catch (e) { App.fail(e); } });
      $("#sync", el)?.addEventListener("click", async () => { try { const r = await App.post("/api/admin/partner/sync"); App.toast(`Обновлено заявок: ${r.updated}`); } catch (e) { App.fail(e); } });
    },
  };

  // ---------- пользователи ----------
  P["a-users"] = {
    admin: true, crumbs: ["Админка", "Пользователи"],
    async render(el) {
      await loadTariffs();
      el.innerHTML = `${App.pageHead("users", "Пользователи", "Доступы, тарифы, балансы и блокировки")}
        <div class="row mb"><div class="input-icon w280">${icon("search")}<input class="input" id="uq" placeholder="Email, имя, Telegram"></div>
          <select class="input wauto" id="urole"><option value="">Все роли</option><option value="user">Пользователи</option><option value="admin">Администраторы</option></select>
          <span class="spacer"></span><button class="btn primary" id="uadd">${icon("plus")}Создать</button></div>
        <div id="ulist">${App.loading()}</div>`;
    },
    mount(el) {
      let page = 1;
      const load = async () => {
        let r;
        try { r = await App.get("/api/admin/users?" + qs({ q: $("#uq", el).value, role: $("#urole", el).value, page })); } catch (e) { return App.fail(e); }
        $("#ulist", el).innerHTML = r.data.length ? `<div class="table-wrap"><table><tr><th>Email</th><th>Имя / Telegram</th><th>Роль</th><th>Тариф</th><th>Баланс</th><th>Ссылки</th><th>Статус</th><th>Регистрация</th></tr>
          ${r.data.map((u) => `<tr class="clickable" data-id="${u.id}"><td><b>${esc(u.email)}</b></td><td>${esc(u.display_name)}${u.username ? ` <span class="hint">@${esc(u.username)}</span>` : ""}</td>
            <td>${u.role === "admin" ? App.badge("админ") : "пользователь"}</td><td>${esc(u.tariff?.name || "—")}</td><td class="mono">${money(u.balance, 2)}</td>
            <td>${yesNo(u.links_access)}</td><td>${u.is_blocked ? App.badge("заблокирован", "bad") : App.badge("активен", "ok")}</td><td>${fmtDate(u.created_at)}</td></tr>`).join("")}</table></div>
          ${App.pager(r.meta, (p) => { page = p; load(); })}` : `<div class="card soft">${App.empty("users", "Пользователи не найдены")}</div>`;
        $$("tr.clickable", el).forEach((tr) => tr.onclick = () => userDialog(+tr.dataset.id, load));
      };
      let t;
      $("#uq", el).oninput = () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); };
      $("#urole", el).onchange = () => { page = 1; load(); };
      $("#uadd", el).onclick = () => App.modal("Новый пользователь", `
        <form id="nu"><div class="field"><label>Email *</label><input class="input" name="email" type="email" required></div>
          <div class="field"><label>Пароль * (мин. 8 символов)</label><input class="input" name="password" minlength="8" required></div>
          <div class="field"><label>Telegram</label><input class="input" name="username"></div>
          <div class="field"><label>Роль</label><select class="input" name="role"><option value="user">Пользователь</option><option value="admin">Администратор</option></select></div>
          <label class="row gap8 mb"><span class="switch"><input type="checkbox" name="links_access"><span></span></span>Открыть доступ к ссылкам</label>
          <div class="form-error"></div><div class="row"><button class="btn primary" type="submit">Создать</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
        (m, close) => App.onSubmit($("#nu", m), async (d, f) => { await App.post("/api/admin/users", { ...d, links_access: f.links_access.checked }); close(); App.toast("Пользователь создан"); load(); }));
      load();
    },
  };

  async function userDialog(id, reload) {
    let u;
    try { u = await App.get(`/api/admin/users/${id}`); } catch (e) { return App.fail(e); }
    const tariffs = await loadTariffs();
    App.modal(u.email, `
      <div class="grid g3 mb small">
        <div><span class="hint">Заявок</span><br><a class="link-btn" href="#/a-conversions/user=${u.id}">${u.conversions}</a></div>
        <div><span class="hint">Ссылок</span><br>${u.links}</div></div>
      <form id="ue">
        <div class="grid g2">
          <div class="field"><label>Email</label><input class="input" name="email" value="${esc(u.email)}"></div>
          <div class="field"><label>Отображаемое имя</label><input class="input" name="display_name" value="${esc(u.display_name)}"></div>
          <div class="field"><label>Telegram</label><input class="input" name="username" value="${esc(u.username)}"></div>
          <div class="field"><label>Роль</label><select class="input" name="role"><option value="user">Пользователь</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>Администратор</option></select></div>
          <div class="field"><label>Тариф</label><select class="input" name="tariff_id"><option value="">—</option>${tariffs.map((t) => `<option value="${t.id}" ${u.tariff?.id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Тариф действует до (пусто — бессрочно)</label><input class="input" type="date" name="tariff_until" value="${u.tariff_until ? isoDay(new Date(u.tariff_until)) : ""}"></div>
        </div>
        <label class="row gap8 mb"><span class="switch"><input type="checkbox" name="links_access" ${u.links_access ? "checked" : ""}><span></span></span>Доступ к ссылкам на офферы</label>
        <label class="row gap8 mb"><span class="switch"><input type="checkbox" name="is_blocked" ${u.is_blocked ? "checked" : ""}><span></span></span>Заблокирован</label>
        <div class="field"><label>Заметка администратора (видна только админам)</label><textarea class="input" name="admin_note" rows="2">${esc(u.admin_note)}</textarea></div>
        <div class="form-error"></div><button class="btn primary" type="submit">Сохранить</button>
      </form>
      <hr>
      <form id="ub"><b>Баланс: ${money(u.balance, 2)}</b>
        <div class="row mt"><input class="input flex1" name="amount" type="number" step="0.01" placeholder="+100 или -50" required><input class="input flex2" name="note" placeholder="Комментарий"><button class="btn" type="submit">Изменить</button></div>
        <div class="form-error"></div></form>
      <hr>
      <form id="up"><b>Новый пароль</b><div class="row mt"><input class="input flex1" name="password" minlength="8" placeholder="Минимум 8 символов" required><button class="btn" type="submit">Установить</button></div>
        <div class="form-error"></div></form>
      ${u.sessions.length ? `<hr><b>Сессии</b>${u.sessions.map((s) => `<div class="hint">${esc(s.ip)} · ${fmtDateTime(s.last_active)}</div>`).join("")}` : ""}
      <hr><button class="btn sm danger" id="udel">${icon("trash")}Удалить пользователя</button>`,
    (m, close) => {
      App.onSubmit($("#ue", m), async (d, f) => {
        await App.patch(`/api/admin/users/${id}`, { ...d, links_access: f.links_access.checked, is_blocked: f.is_blocked.checked });
        App.toast("Сохранено"); close(); reload();
      });
      App.onSubmit($("#ub", m), async (d) => { await App.post(`/api/admin/users/${id}/balance`, d); App.toast("Баланс изменён"); close(); reload(); });
      App.onSubmit($("#up", m), async (d, f) => { await App.post(`/api/admin/users/${id}/password`, d); f.reset(); App.toast("Пароль установлен, сессии пользователя завершены"); });
      $("#udel", m).onclick = async () => {
        if (!(await App.confirm(`Удалить ${u.email} вместе со всеми заявками, ссылками и покупками?`, "Удалить"))) return;
        try { await App.del(`/api/admin/users/${id}`); close(); App.toast("Удалено"); reload(); } catch (e) { App.fail(e); }
      };
    }, { wide: true });
  }

  // ---------- ссылки ----------
  P["a-links"] = {
    admin: true, crumbs: ["Админка", "Ссылки"],
    async render(el) {
      el.innerHTML = `${App.pageHead("link", "Ссылки", "Персональные ссылки пользователей. Пока партнёрский API не подключён, адрес оффера вписывается здесь вручную.")}
        <div class="row mb"><select class="input wauto" id="lst"><option value="requested">Ждут выдачи</option><option value="active">Активные</option><option value="disabled">Отключённые</option><option value="">Все</option></select>
          <div class="input-icon w280">${icon("search")}<input class="input" id="lq" placeholder="Email или Telegram"></div></div>
        <div id="llist">${App.loading()}</div>`;
    },
    mount(el) {
      let page = 1;
      const st = { requested: "Запрошена", active: "Активна", disabled: "Отключена" };
      const load = async () => {
        let r;
        try { r = await App.get("/api/admin/links?" + qs({ status: $("#lst", el).value, q: $("#lq", el).value, page })); } catch (e) { return App.fail(e); }
        $("#llist", el).innerHTML = r.data.length ? `<div class="table-wrap"><table><tr><th>Пользователь</th><th>Оффер</th><th>Статус</th><th>Адрес оффера</th><th>Переходы</th><th>Заявки</th><th>Создана</th></tr>
          ${r.data.map((l) => `<tr class="clickable" data-id="${l.id}"><td>${esc(l.user.email)}</td><td>${esc(l.offer_name)}</td><td>${App.badge(st[l.status], App.statusTone(l.status))}</td>
            <td class="mono clip1">${esc(l.target_url || "—")}</td><td>${l.clicks}</td><td>${l.used}${l.limit ? "/" + l.limit : ""}</td><td>${fmtDate(l.created_at)}</td></tr>`).join("")}</table></div>
          ${App.pager(r.meta, (p) => { page = p; load(); })}` : `<div class="card soft">${App.empty("link", "Ссылок нет")}</div>`;
        $$("tr.clickable", el).forEach((tr) => tr.onclick = () => {
          const l = r.data.find((x) => x.id === +tr.dataset.id);
          App.modal("Ссылка", `<p><b>${esc(l.user.email)}</b> → ${esc(l.offer_name)}</p>
            ${l.url ? `<p class="hint">Ссылка для пользователя: <span class="mono">${esc(l.url)}</span></p>` : ""}
            <form id="le"><div class="field"><label>Адрес оффера (куда ведёт редирект)</label><input class="input" name="url" type="url" placeholder="https://" value="${esc(l.target_url)}"></div>
              <div class="grid g2"><div class="field"><label>Статус</label><select class="input" name="status">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${k === l.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
              <div class="field"><label>Лимит заявок (0 — без лимита)</label><input class="input" name="limit" type="number" min="0" value="${l.limit}"></div></div>
              <div class="form-error"></div>
              <div class="row"><button class="btn primary" type="submit">Сохранить</button><span class="spacer"></span><button type="button" class="btn sm danger" id="ldel">${icon("trash")}Удалить</button></div></form>`,
            (m, close) => {
              App.onSubmit($("#le", m), async (d) => {
                await App.patch(`/api/admin/links/${l.id}`, { url: d.url, status: d.status, limit: d.limit });
                close(); App.toast("Сохранено"); App.refreshAdminCounts(true); load();
              });
              $("#ldel", m).onclick = async () => { if (await App.confirm("Удалить ссылку? Переходы по ней тоже удалятся.", "Удалить")) { await App.del(`/api/admin/links/${l.id}`).catch(App.fail); close(); load(); } };
            });
        });
      };
      $("#lst", el).onchange = () => { page = 1; load(); };
      let t; $("#lq", el).oninput = () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); };
      load();
    },
  };

  // ---------- заявки ----------
  P["a-conversions"] = {
    admin: true, crumbs: ["Админка", "Заявки"],
    async render(el, arg) {
      const p = argParams(arg);
      const [offers, users] = await Promise.all([App.get("/api/admin/r/offers"), App.get("/api/admin/users?per=500")]);
      el._data = { offers, users: users.data };
      const st = App.cfg.statuses;
      el.innerHTML = `${App.pageHead("file", "Заявки", "Меняйте статусы и суммы — пользователи видят изменения сразу")}
        <form class="card" id="cf">
          <div class="row"><div class="input-icon flex2">${icon("search")}<input class="input" name="q" placeholder="ИНН, ФИО, телефон" value="${esc(p.q || "")}"></div>
            <select class="input flex1" name="status"><option value="">Все статусы</option>${Object.entries(st).map(([k, v]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
            <select class="input flex1" name="offer"><option value="">Все офферы</option>${offers.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select>
            <select class="input flex1" name="user"><option value="">Все пользователи</option>${users.data.map((u) => `<option value="${u.id}" ${+p.user === u.id ? "selected" : ""}>${esc(u.email)}</option>`).join("")}</select></div>
          <div class="row mt"><span>С</span><input class="input wauto" type="date" name="from"><span>по</span><input class="input wauto" type="date" name="to">
            <span class="spacer"></span><a class="btn sm" id="ccsv">${icon("download")}CSV</a><button type="button" class="btn sm primary" id="cadd">${icon("plus")}Добавить</button></div>
        </form>
        <div class="row mb" id="bulk" hidden><span id="bcount"></span><select class="input wauto" id="bst">${Object.entries(st).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
          <button class="btn sm primary" id="bapply">Сменить статус выбранным</button></div>
        <div id="clist">${App.loading()}</div>`;
    },
    mount(el) {
      const form = $("#cf", el), st = App.cfg.statuses;
      let page = 1, rows = [];
      const selected = new Set();
      const params = () => qs({ ...Object.fromEntries(new FormData(form)), page });
      const syncBulk = () => { $("#bulk", el).hidden = !selected.size; $("#bcount", el).textContent = `Выбрано: ${selected.size}`; };
      const load = async () => {
        $("#ccsv", el).href = "/api/admin/conversions.csv?" + params();
        let r;
        try { r = await App.get("/api/admin/conversions?" + params()); } catch (e) { return App.fail(e); }
        rows = r.data; selected.clear(); syncBulk();
        $("#clist", el).innerHTML = rows.length ? `<div class="table-wrap"><table><tr><th><input type="checkbox" id="call"></th><th>#</th><th>Дата</th><th>Пользователь</th><th>Оффер</th><th>ИНН</th><th>ФИО</th><th>Статус</th><th>Сумма</th><th>Источник</th></tr>
          ${rows.map((c) => `<tr class="clickable" data-id="${c.id}"><td><input type="checkbox" data-sel="${c.id}"></td><td>${c.id}</td><td>${fmtDate(c.created_at)}</td>
            <td>${esc(c.user.email)}</td><td>${esc(c.offer_name)}</td><td class="mono">${esc(c.inn)}</td><td>${esc(c.fio)}</td>
            <td>${App.badge(c.status_name, App.statusTone(c.status))}</td><td class="mono">${money(c.amount)}</td><td class="hint">${{ manual: "кабинет", form: "форма", admin: "админ" }[c.source] || c.source}</td></tr>`).join("")}</table></div>
          ${App.pager(r.meta, (p) => { page = p; load(); })}` : `<div class="card soft">${App.empty("file", "Заявок не найдено")}</div>`;
        $$("[data-sel]", el).forEach((c) => c.onclick = (e) => { e.stopPropagation(); c.checked ? selected.add(+c.dataset.sel) : selected.delete(+c.dataset.sel); syncBulk(); });
        $("#call", el)?.addEventListener("click", (e) => { $$("[data-sel]", el).forEach((c) => { c.checked = e.target.checked; c.checked ? selected.add(+c.dataset.sel) : selected.delete(+c.dataset.sel); }); syncBulk(); });
        $$("tr.clickable", el).forEach((tr) => tr.onclick = (e) => { if (e.target.closest("input")) return; edit(rows.find((x) => x.id === +tr.dataset.id)); });
      };
      const edit = (c) => App.modal(`Заявка #${c.id}`, `
        <p class="small">${esc(c.user.email)} · ${esc(c.offer_name)} · создана ${fmtDateTime(c.created_at)}${c.phone ? ` · тел. ${esc(c.phone)}` : ""}${c.subid ? ` · метка ${esc(c.subid)}` : ""}</p>
        <form id="ce"><div class="grid g2">
          <div class="field"><label>ИНН</label><input class="input" name="inn" value="${esc(c.inn)}"></div>
          <div class="field"><label>ФИО</label><input class="input" name="fio" value="${esc(c.fio)}"></div>
          <div class="field"><label>Статус</label><select class="input" name="status">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
          <div class="field"><label>Сумма к выплате, ₽</label><input class="input" name="amount" type="number" step="0.01" min="0" value="${c.amount}"></div></div>
          <div class="field"><label>Комментарий (виден пользователю)</label><textarea class="input" name="comment" rows="3">${esc(c.comment)}</textarea></div>
          <div class="form-error"></div>
          <div class="row"><button class="btn primary" type="submit">Сохранить</button><span class="spacer"></span><button type="button" class="btn sm danger" id="cdel">${icon("trash")}Удалить</button></div></form>`,
        (m, close) => {
          App.onSubmit($("#ce", m), async (d) => { await App.patch(`/api/admin/conversions/${c.id}`, d); close(); App.toast("Сохранено"); App.refreshAdminCounts(true); load(); });
          $("#cdel", m).onclick = async () => { if (await App.confirm("Удалить заявку?", "Удалить")) { await App.del(`/api/admin/conversions/${c.id}`).catch(App.fail); close(); load(); } };
        });
      $("#cadd", el).onclick = () => {
        const { offers, users } = el._data;
        App.modal("Новая заявка", `<form id="cn">
          <div class="field"><label>Пользователь *</label><select class="input" name="user_id" required>${users.map((u) => `<option value="${u.id}">${esc(u.email)}</option>`).join("")}</select></div>
          <div class="field"><label>Оффер *</label><select class="input" name="offer_id" required>${offers.map((o) => `<option value="${o.id}">${esc(o.partner)} — ${esc(o.name)}</option>`).join("")}</select></div>
          <div class="grid g2"><div class="field"><label>ИНН *</label><input class="input" name="inn" required></div><div class="field"><label>ФИО</label><input class="input" name="fio"></div>
          <div class="field"><label>Статус</label><select class="input" name="status">${Object.entries(st).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
          <div class="field"><label>Сумма, ₽ (пусто — по ставке)</label><input class="input" name="amount" type="number" step="0.01" min="0"></div></div>
          <div class="form-error"></div><div class="row"><button class="btn primary" type="submit">Создать</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
          (m, close) => App.onSubmit($("#cn", m), async (d) => { await App.post("/api/admin/conversions", d); close(); App.toast("Заявка создана"); load(); }));
      };
      $("#bapply", el).onclick = async () => {
        if (!(await App.confirm(`Сменить статус ${selected.size} заявок на «${st[$("#bst", el).value]}»?`))) return;
        try { await App.post("/api/admin/conversions/bulk", { ids: [...selected], status: $("#bst", el).value }); App.toast("Готово"); App.refreshAdminCounts(true); load(); } catch (e) { App.fail(e); }
      };
      let t;
      form.addEventListener("input", (e) => { if (e.target.name === "q") { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); } });
      form.addEventListener("change", (e) => { if (e.target.name !== "q") { page = 1; load(); } });
      form.addEventListener("submit", (e) => e.preventDefault());
      load();
    },
  };

  // ---------- пополнения ----------
  P["a-topups"] = {
    admin: true, crumbs: ["Админка", "Пополнения"],
    async render(el) {
      el.innerHTML = `${App.pageHead("card", "Пополнения баланса", "Заявки пользователей. Инструкция для пользователей — в «Настройках».")}
        <div class="row mb"><select class="input wauto" id="tst"><option value="pending">Ждут проверки</option><option value="approved">Зачислены</option><option value="rejected">Отклонены</option><option value="">Все</option></select></div>
        <div id="tlist">${App.loading()}</div>`;
    },
    mount(el) {
      let page = 1;
      const names = { pending: "Ждёт", approved: "Зачислено", rejected: "Отклонено" };
      const load = async () => {
        let r;
        try { r = await App.get("/api/admin/topups?" + qs({ status: $("#tst", el).value, page })); } catch (e) { return App.fail(e); }
        $("#tlist", el).innerHTML = r.data.length ? `<div class="table-wrap"><table><tr><th>Дата</th><th>Пользователь</th><th>Сумма</th><th>Комментарий</th><th>Статус</th><th></th></tr>
          ${r.data.map((t) => `<tr><td>${fmtDateTime(t.created_at)}</td><td>${esc(t.user.email)}</td><td class="mono">${money(t.amount, 2)}</td><td>${esc(t.note)}${t.admin_note ? `<div class="hint">${esc(t.admin_note)}</div>` : ""}</td>
            <td>${App.badge(names[t.status], App.statusTone(t.status === "approved" ? "active" : t.status === "rejected" ? "rejected" : "pending"))}</td>
            <td class="nowrap">${t.status === "pending" ? `<button class="btn sm primary" data-ok="${t.id}">Зачислить</button> <button class="btn sm" data-no="${t.id}">Отклонить</button>` : ""}</td></tr>`).join("")}</table></div>
          ${App.pager(r.meta, (p) => { page = p; load(); })}` : `<div class="card soft">${App.empty("card", "Заявок нет")}</div>`;
        $$("[data-ok]", el).forEach((b) => b.onclick = () => {
          const t = r.data.find((x) => x.id === +b.dataset.ok);
          App.modal("Зачислить пополнение", `<form id="ta"><p>${esc(t.user.email)}</p>
            <div class="field"><label>Сумма к зачислению, ₽</label><input class="input" name="amount" type="number" step="0.01" min="0.01" value="${t.amount}" required></div>
            <div class="field"><label>Комментарий</label><input class="input" name="note"></div><div class="form-error"></div>
            <div class="row"><button class="btn primary" type="submit">Зачислить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
            (m, close) => App.onSubmit($("#ta", m), async (d) => { await App.post(`/api/admin/topups/${t.id}/approve`, d); close(); App.toast("Зачислено"); App.refreshAdminCounts(true); load(); }));
        });
        $$("[data-no]", el).forEach((b) => b.onclick = () => App.modal("Отклонить пополнение", `<form id="tr"><div class="field"><label>Причина (увидит пользователь)</label><input class="input" name="note"></div>
          <div class="form-error"></div><div class="row"><button class="btn primary" type="submit">Отклонить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
          (m, close) => App.onSubmit($("#tr", m), async (d) => { await App.post(`/api/admin/topups/${b.dataset.no}/reject`, d); close(); App.refreshAdminCounts(true); load(); })));
      };
      $("#tst", el).onchange = () => { page = 1; load(); };
      load();
    },
  };

  // ---------- поддержка ----------
  P["a-tickets"] = {
    admin: true, crumbs: ["Админка", "Поддержка"],
    async render(el) {
      el.innerHTML = `${App.pageHead("chat", "Обращения", "Вопросы пользователей и заявки на доступ к ссылкам")}
        <div class="row mb"><select class="input wauto" id="kst"><option value="open">Ждут ответа</option><option value="answered">Отвечено</option><option value="closed">Закрыты</option><option value="">Все</option></select></div>
        <div id="klist">${App.loading()}</div>`;
    },
    mount(el) {
      let page = 1;
      const topics = { general: "Общий", conversion: "По заявке", access: "Доступ к ссылкам" };
      const names = { open: "Ждёт ответа", answered: "Отвечено", closed: "Закрыт" };
      const load = async () => {
        let r;
        try { r = await App.get("/api/admin/tickets?" + qs({ status: $("#kst", el).value, page })); } catch (e) { return App.fail(e); }
        $("#klist", el).innerHTML = r.data.length ? `<div class="table-wrap"><table><tr><th>Обновлено</th><th>Пользователь</th><th>Тема</th><th>Тип</th><th>Статус</th></tr>
          ${r.data.map((t) => `<tr class="clickable" data-id="${t.id}"><td>${fmtDateTime(t.updated_at)}</td><td>${esc(t.user.email)}</td><td><b>${esc(t.subject)}</b></td>
            <td>${topics[t.topic] || t.topic}</td><td>${App.badge(names[t.status], App.statusTone(t.status))}</td></tr>`).join("")}</table></div>
          ${App.pager(r.meta, (p) => { page = p; load(); })}` : `<div class="card soft">${App.empty("chat", "Обращений нет")}</div>`;
        $$("tr.clickable", el).forEach((tr) => tr.onclick = () => ticketDialog(+tr.dataset.id, load));
      };
      $("#kst", el).onchange = () => { page = 1; load(); };
      load();
    },
  };

  async function ticketDialog(id, reload) {
    let t;
    try { t = await App.get(`/api/admin/tickets/${id}`); } catch (e) { return App.fail(e); }
    App.modal(t.subject, `<p class="small">${esc(t.user.email)}${t.conversion_id ? ` · по заявке #${t.conversion_id}` : ""} · создано ${fmtDateTime(t.created_at)}</p>
      ${t.topic === "access" ? `<div class="notice">Заявка на доступ к ссылкам. Откройте доступ в карточке пользователя (раздел «Пользователи») — обращение закроется автоматически.</div>` : ""}
      ${App.messagesHtml(t).replace(/Вы ·/g, "Пользователь ·")}
      <form id="kr" class="mt"><div class="field"><label>Ответ</label><textarea class="input" name="body" rows="4" required></textarea></div>
        <div class="form-error"></div>
        <div class="row"><button class="btn primary" type="submit">${icon("send")}Ответить</button><span class="spacer"></span>
          ${t.status !== "closed" ? `<button type="button" class="btn sm" data-st="closed">Закрыть</button>` : `<button type="button" class="btn sm" data-st="open">Открыть снова</button>`}</div></form>`,
    (m, close) => {
      App.onSubmit($("#kr", m), async (d) => { await App.post(`/api/admin/tickets/${id}/messages`, d); close(); App.toast("Ответ отправлен"); App.refreshAdminCounts(true); reload(); });
      $$("[data-st]", m).forEach((b) => b.onclick = async () => { await App.post(`/api/admin/tickets/${id}/status`, { status: b.dataset.st }).catch(App.fail); close(); App.refreshAdminCounts(true); reload(); });
    }, { wide: true });
  }

  // ---------- материалы ----------
  P["a-materials"] = {
    admin: true, crumbs: ["Админка", "Материалы"],
    async render(el) {
      const [items] = await Promise.all([App.get("/api/admin/materials"), loadPrograms()]);
      el._data = items;
      el.innerHTML = `${App.pageHead("folder", "Файлы и материалы", "Файлы (до 25 МБ) и ссылки. Галочками выбирается, где показывать: в «Мануалах» и/или в программах обучения.")}
        <button class="btn primary mb" id="madd">${icon("plus")}Добавить</button>
        ${items.length ? `<div class="table-wrap"><table><tr><th></th><th>Название</th><th>Файл / ссылка</th><th>Где виден</th><th></th></tr>
          ${items.map((m) => `<tr class="clickable" data-id="${m.id}"><td>${thumb(m)}</td><td><b>${esc(m.title)}</b><div class="hint">${esc(m.description)}</div></td>
            <td>${m.filename ? `${esc(m.filename)} <span class="hint">${(m.size / 1024).toFixed(1)} КБ</span>` : `<span class="mono clip1">${esc(m.url)}</span>`}</td><td>${placeCol(m)}</td>
            <td><button class="btn sm ghost" data-del="${m.id}">${icon("trash")}</button></td></tr>`).join("")}</table></div>`
          : `<div class="card soft">${App.empty("folder", "Материалов пока нет")}</div>`}`;
    },
    mount(el) {
      const items = el._data;
      const open = (m) => App.modal(m ? "Материал" : "Новый материал", `<form id="mf">
        <div class="field"><label>Название *</label><input class="input" name="title" value="${esc(m?.title || "")}" required></div>
        <div class="field"><label>Описание</label><input class="input" name="description" value="${esc(m?.description || "")}"></div>
        <div class="field"><label>Файл ${m?.filename ? `(сейчас: ${esc(m.filename)})` : ""}</label><input type="file" name="file"></div>
        ${m?.filename ? `<label class="row gap8 mb small"><input type="checkbox" name="remove_file" value="1"> Удалить файл</label>` : ""}
        <div class="field"><label>…или внешняя ссылка</label><input class="input" name="url" type="url" placeholder="https://" value="${esc(m?.url || "")}"></div>
        <label class="row gap8 mb"><span class="switch"><input type="checkbox" name="show_in_manuals" ${!m || m.show_in_manuals ? "checked" : ""}><span></span></span>Показывать в «Мануалах»</label>
        ${(programsCache || []).length ? `<div class="field"><label>Показывать в программах обучения</label>${checks("program_ids", programsCache.map((p) => [String(p.id), p.title]), (m?.program_ids || []).map(String))}</div>` : ""}
        ${coverFields(m, "ссылки")}
        <div class="form-error"></div><div class="row"><button class="btn primary" type="submit">Сохранить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
        (md, close) => {
          const f = $("#mf", md);
          bindCoverPreview(f);
          App.onSubmit(f, async () => {
            const fd = new FormData();
            ["title", "description", "url"].forEach((k) => fd.append(k, f.elements[k].value));
            if (f.file.files[0]) fd.append("file", f.file.files[0]);
            if (f.remove_file?.checked) fd.append("remove_file", "1");
            fd.append("show_in_manuals", f.show_in_manuals.checked ? "1" : "0");
            const progs = $$('input[name="program_ids"]:checked', f).map((i) => i.value);
            progs.forEach((id) => fd.append("program_ids", id));
            if (!progs.length) fd.append("program_ids", "");
            const saved = await App.api("POST", m ? `/api/admin/materials/${m.id}` : "/api/admin/materials", undefined, { form: fd });
            await applyCover("materials", saved.id, f, f.elements.url.value);
            close(); App.toast("Сохранено"); App.rerender();
          });
        }, { wide: true });
      $("#madd", el).onclick = () => open(null);
      $$("tr.clickable", el).forEach((tr) => tr.onclick = (e) => { if (!e.target.closest("button")) open(items.find((x) => x.id === +tr.dataset.id)); });
      $$("[data-del]", el).forEach((b) => b.onclick = async () => {
        if (await App.confirm("Удалить материал?", "Удалить")) { await App.del(`/api/admin/materials/${b.dataset.del}`).catch(App.fail); App.rerender(); }
      });
    },
  };

  // ---------- настройки ----------
  P["a-settings"] = {
    admin: true, crumbs: ["Админка", "Настройки"],
    async render(el) {
      const items = await App.get("/api/admin/settings");
      el._data = items;
      const groups = [...new Set(items.map((i) => i.group))];
      el.innerHTML = `${App.pageHead("settings", "Настройки и тексты", "Название, разделы, тексты на страницах, цены")}
        <form id="sf">${groups.map((g) => `<div class="card"><div class="card-title">${esc(g)}</div>
          ${items.filter((i) => i.group === g).map((i) => {
            if (i.type === "bool") return `<label class="row gap8 mb"><span class="switch"><input type="checkbox" name="${i.key}" ${i.value === "1" ? "checked" : ""}><span></span></span>${esc(i.label)}</label>`;
            if (i.type === "text") return `<div class="field"><label>${esc(i.label)}</label><textarea class="input" name="${i.key}" rows="3">${esc(i.value)}</textarea></div>`;
            if (i.type === "money") return `<div class="field"><label>${esc(i.label)}</label><input class="input w280" name="${i.key}" type="number" step="0.01" min="0" value="${esc(i.value)}"></div>`;
            return `<div class="field"><label>${esc(i.label)}</label><input class="input" name="${i.key}" ${i.type === "url" ? 'type="url" placeholder="https://"' : ""} value="${esc(i.value)}"></div>`;
          }).join("")}</div>`).join("")}
          <div class="sticky-save"><div class="form-error"></div><button class="btn primary" type="submit">${icon("check")}Сохранить настройки</button></div></form>`;
    },
    mount(el) {
      const items = el._data;
      App.onSubmit($("#sf", el), async (_, f) => {
        const data = {};
        for (const i of items) data[i.key] = i.type === "bool" ? f.elements[i.key].checked : f.elements[i.key].value;
        await App.put("/api/admin/settings", data);
        await App.reloadConfig();
        App.toast("Настройки сохранены");
      });
    },
  };
})();
