/* Админка: управление пользователями, контентом, заявками, трафиком и настройками. */
(() => {
  const { $, $$, esc, money, fmtDate, fmtDateTime, isoDay, qs, icon, linkify } = App;
  const P = App.pages;

  App.adminMenu = [
    { id: "admin", label: "Обзор", icon: "grid" },
    { id: "a-users", label: "Пользователи", icon: "users" },
    { id: "a-conversions", label: "Заявки", icon: "file", badge: true },
    { id: "a-links", label: "Ссылки", icon: "link", badge: true },
    { id: "a-offers", label: "Офферы", icon: "handshake" },
    { id: "a-topups", label: "Пополнения", icon: "card", badge: true },
    { id: "a-traffic", label: "Трафик", icon: "cart" },
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

  // ---------- конструктор полей формы ----------
  function fieldHtml(f, value) {
    const v = value ?? (f.type === "bool" ? ["is_active", "is_published", "is_public"].includes(f.name) : "");
    const req = f.required ? "required" : "";
    const lbl = `${esc(f.label)}${f.required ? " *" : ""}`;
    switch (f.type) {
      case "text":
        return `<div class="field"><label>${lbl}</label><textarea class="input" name="${f.name}" rows="${f.name === "body" ? 10 : 4}" ${req}>${esc(v)}</textarea></div>`;
      case "bool":
        return `<label class="row gap8 mb"><span class="switch"><input type="checkbox" name="${f.name}" ${v ? "checked" : ""}><span></span></span>${lbl}</label>`;
      case "money":
        return `<div class="field"><label>${lbl}</label><input class="input" name="${f.name}" type="number" step="0.01" min="0" value="${esc(v)}" ${req}></div>`;
      case "int":
        return `<div class="field"><label>${lbl}</label><input class="input" name="${f.name}" type="number" step="1" value="${esc(v === "" ? 0 : v)}" ${req}></div>`;
      case "tariff":
        return `<div class="field"><label>${lbl}</label><select class="input" name="${f.name}"><option value="">— любой —</option>
          ${(tariffsCache || []).map((t) => `<option value="${t.id}" ${+v === t.id ? "selected" : ""}>${esc(t.name)} (уровень ${t.level})</option>`).join("")}</select></div>`;
      case "url":
        return `<div class="field"><label>${lbl}</label><input class="input" name="${f.name}" type="url" placeholder="https://" value="${esc(v)}" ${req}></div>`;
      default:
        return `<div class="field"><label>${lbl}</label><input class="input" name="${f.name}" value="${esc(v)}" ${req}></div>`;
    }
  }
  function readForm(form, fields) {
    const out = {};
    for (const f of fields) {
      const inp = form.elements[f.name];
      if (!inp) continue;
      out[f.name] = f.type === "bool" ? inp.checked : inp.value;
    }
    return out;
  }

  // ---------- универсальная страница CRUD ----------
  function crudPage(res, { title, sub, ic, columns, extra, beforeSave }) {
    return {
      admin: true, crumbs: ["Админка", title],
      async render(el) {
        const [schema, items] = await Promise.all([loadSchema(), App.get(`/api/admin/r/${res}`), loadTariffs()]);
        el._data = { fields: schema[res], items };
        el.innerHTML = `${App.pageHead(ic, title, sub)}
          <div class="row mb"><button class="btn primary" id="add">${icon("plus")}Добавить</button>
            <div class="input-icon w280">${icon("search")}<input class="input" id="flt" placeholder="Поиск"></div></div>
          <div id="list"></div>`;
      },
      mount(el) {
        const { fields, items } = el._data;
        const draw = (q = "") => {
          const list = items.filter((it) => JSON.stringify(it).toLowerCase().includes(q));
          $("#list", el).innerHTML = list.length ? `<div class="table-wrap"><table><tr>${columns.map((c) => `<th>${c[0]}</th>`).join("")}<th></th></tr>
            ${list.map((it) => `<tr class="clickable" data-id="${it.id}">${columns.map((c) => `<td>${c[1](it)}</td>`).join("")}
              <td class="nowrap"><button class="btn sm ghost" data-edit="${it.id}" title="Изменить">${icon("edit")}</button><button class="btn sm ghost" data-del="${it.id}" title="Удалить">${icon("trash")}</button></td></tr>`).join("")}</table></div>`
            : `<div class="card soft">${App.empty(ic, items.length ? "Ничего не найдено" : "Пока пусто", items.length ? "" : "Нажмите «Добавить».")}</div>`;
          $$("[data-edit], tr.clickable", el).forEach((b) => b.onclick = (e) => {
            if (e.target.closest("[data-del]")) return;
            e.stopPropagation(); open(items.find((x) => x.id === +(b.dataset.edit || b.dataset.id)));
          });
          $$("[data-del]", el).forEach((b) => b.onclick = async (e) => {
            e.stopPropagation();
            if (!(await App.confirm("Удалить запись без возможности восстановления?", "Удалить"))) return;
            try { await App.del(`/api/admin/r/${res}/${b.dataset.del}`); App.toast("Удалено"); if (res === "tariffs") tariffsCache = null; App.rerender(); } catch (ex) { App.fail(ex); }
          });
        };
        const open = (item) => App.modal(item ? "Редактирование" : "Новая запись", `
          <form id="cf">${fields.map((f) => fieldHtml(f, item?.[f.name])).join("")}${extra ? extra(item) : ""}
            <div class="form-error"></div>
            <div class="row"><button class="btn primary" type="submit">Сохранить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
          (m, close) => App.onSubmit($("#cf", m), async (_, form) => {
            let data = readForm(form, fields);
            if (beforeSave) data = beforeSave(data, form);
            if (item) await App.put(`/api/admin/r/${res}/${item.id}`, data);
            else await App.post(`/api/admin/r/${res}`, data);
            if (res === "tariffs") tariffsCache = null;
            close(); App.toast("Сохранено"); App.rerender();
          }), { wide: true });
        $("#add", el).onclick = () => open(null);
        $("#flt", el).oninput = (e) => draw(e.target.value.toLowerCase().trim());
        draw();
      },
    };
  }

  P["a-offers"] = crudPage("offers", {
    title: "Офферы", ic: "handshake", sub: "Каталог офферов. Ставка пользователя = базовая выплата × % его тарифа.",
    columns: [["Партнёр", (o) => esc(o.partner)], ["Название", (o) => `<b>${esc(o.name)}</b>`], ["Тип", (o) => esc(o.type)],
      ["Выплата", (o) => `<span class="mono">${money(o.payout)}</span>`], ["Лимит", (o) => o.limit_default || "—"],
      ["Опубликован", (o) => yesNo(o.is_active)], ["Порядок", (o) => o.sort]],
  });
  P["a-articles"] = crudPage("articles", {
    title: "Статьи", ic: "book", sub: "База знаний. Можно ограничить доступ минимальным тарифом.",
    columns: [["Заголовок", (a) => `<b>${esc(a.title)}</b>`], ["Категория", (a) => esc(a.category)],
      ["Доступ", (a) => a.min_tariff_id ? esc((tariffsCache || []).find((t) => t.id === a.min_tariff_id)?.name || "—") : "все"],
      ["Опубликована", (a) => yesNo(a.is_published)], ["Создана", (a) => fmtDate(a.created_at)]],
  });
  P["a-news"] = crudPage("news", {
    title: "Новости", ic: "news", sub: "Уведомления на главной странице кабинета.",
    columns: [["Заголовок", (n) => `<b>${esc(n.title)}</b>`], ["Текст", (n) => `<span class="clip1">${esc(n.body)}</span>`], ["Дата", (n) => fmtDateTime(n.created_at)]],
    extra: (item) => item ? "" : `<label class="row gap8 mb"><span class="switch"><input type="checkbox" name="broadcast"><span></span></span>Разослать в Telegram (если бот настроен)</label>`,
    beforeSave: (data, form) => ({ ...data, broadcast: form.elements.broadcast?.checked || false }),
  });
  P["a-team"] = crudPage("team", {
    title: "Команда", ic: "users", sub: "Блок «Команда и каналы» на главной.",
    columns: [["Имя", (t) => `<b>${esc(t.name)}</b>`], ["Роль", (t) => esc(t.role)], ["Ссылки", (t) => esc(t.links).replace(/\n/g, ", ")], ["Порядок", (t) => t.sort]],
  });
  P["a-tariffs"] = crudPage("tariffs", {
    title: "Тарифы", ic: "card", sub: "Уровень открывает статьи; ставка меняет выплату по офферам.",
    columns: [["Название", (t) => `<b>${esc(t.name)}</b> <span class="hint">${esc(t.code)}</span>`], ["Цена", (t) => t.price ? `${money(t.price)} / ${t.period_days} дн.` : "бесплатно"],
      ["Ставка", (t) => `${t.rate}%`], ["Уровень", (t) => t.level], ["По умолчанию", (t) => yesNo(t.is_default)], ["В продаже", (t) => yesNo(t.is_public)]],
  });

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
          ${card("#/a-traffic", "cart", "Трафик", o.traffic_available, "свободных строк")}
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
        <div><span class="hint">Ссылок</span><br>${u.links}</div><div><span class="hint">Покупок трафика</span><br>${u.purchases}</div></div>
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

  // ---------- трафик ----------
  P["a-traffic"] = {
    admin: true, crumbs: ["Админка", "Трафик"],
    async render(el) {
      const t = await App.get("/api/admin/traffic");
      el.innerHTML = `${App.pageHead("cart", "Трафик", "Загрузка строк для продажи. Цена и формат — в «Настройках».")}
        <div class="grid g3 mb">
          <div class="stat"><div class="lbl">${icon("box")}Свободно</div><div class="val ok">${t.available}</div><small>строк в продаже</small></div>
          <div class="stat"><div class="lbl">${icon("download")}Продано</div><div class="val">${t.sold}</div><small>строк</small></div>
          <div class="stat"><div class="lbl">${icon("cash")}Цена</div><div class="val">${money(t.price, 2)}</div><small>за строку</small></div></div>
        <form class="card" id="tu"><div class="card-title">${icon("upload")}Загрузить строки</div>
          <p class="hint">Одна строка = одна единица трафика. Вставьте текст или загрузите .txt / .csv файл.</p>
          <div class="field"><textarea class="input mono" name="text" rows="6" placeholder="строка 1&#10;строка 2"></textarea></div>
          <div class="row"><input type="file" name="file" accept=".txt,.csv,text/plain,text/csv">
            <label class="row gap8"><input type="checkbox" name="skip_header"> Пропустить первую строку (заголовок)</label></div>
          <div class="form-error"></div>
          <div class="row mt"><button class="btn primary" type="submit">${icon("upload")}Загрузить</button><span class="spacer"></span>
            <button type="button" class="btn sm danger" id="tclear">${icon("trash")}Удалить все непроданные</button></div></form>
        <div class="card"><div class="card-title">${icon("history")}Покупки</div>
          ${t.purchases.length ? `<div class="table-wrap"><table><tr><th>Дата</th><th>Пользователь</th><th>Строк</th><th>Сумма</th><th></th></tr>
            ${t.purchases.map((p) => `<tr><td>${fmtDateTime(p.created_at)}</td><td>${esc(p.user.email)}</td><td>${p.rows}</td><td class="mono">${money(p.total, 2)}</td>
              <td><a class="link-btn" href="/api/traffic/purchases/${p.id}/download">Скачать</a></td></tr>`).join("")}</table></div>` : App.empty("history", "Покупок пока нет")}</div>`;
    },
    mount(el) {
      App.onSubmit($("#tu", el), async (d, f) => {
        const skip = f.skip_header.checked ? "?skip_header=1" : "";
        let r;
        if (f.file.files[0]) { const fd = new FormData(); fd.append("file", f.file.files[0]); r = await App.api("POST", "/api/admin/traffic/rows" + skip, undefined, { form: fd }); }
        else r = await App.api("POST", "/api/admin/traffic/rows" + skip, { text: d.text });
        App.toast(`Добавлено строк: ${r.added}`); App.rerender();
      });
      $("#tclear", el).onclick = async () => {
        if (!(await App.confirm("Удалить все непроданные строки?", "Удалить"))) return;
        try { const r = await App.del("/api/admin/traffic/rows"); App.toast(`Удалено: ${r.deleted}`); App.rerender(); } catch (e) { App.fail(e); }
      };
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
      const items = await App.get("/api/admin/materials");
      el._data = items;
      el.innerHTML = `${App.pageHead("folder", "Материалы", "Файлы и ссылки на вкладке «Материалы» в базе знаний (файл до 25 МБ)")}
        <button class="btn primary mb" id="madd">${icon("plus")}Добавить</button>
        ${items.length ? `<div class="table-wrap"><table><tr><th>Название</th><th>Файл / ссылка</th><th>Размер</th><th>Порядок</th><th></th></tr>
          ${items.map((m) => `<tr class="clickable" data-id="${m.id}"><td><b>${esc(m.title)}</b><div class="hint">${esc(m.description)}</div></td>
            <td>${m.filename ? esc(m.filename) : `<span class="mono">${esc(m.url)}</span>`}</td><td>${m.size ? (m.size / 1024).toFixed(1) + " КБ" : "—"}</td><td>${m.sort}</td>
            <td><button class="btn sm ghost" data-del="${m.id}">${icon("trash")}</button></td></tr>`).join("")}</table></div>`
          : `<div class="card soft">${App.empty("folder", "Материалов пока нет")}</div>`}`;
    },
    mount(el) {
      const items = el._data;
      const open = (m) => App.modal(m ? "Материал" : "Новый материал", `<form id="mf">
        <div class="field"><label>Название *</label><input class="input" name="title" value="${esc(m?.title || "")}" required></div>
        <div class="field"><label>Описание</label><input class="input" name="description" value="${esc(m?.description || "")}"></div>
        <div class="field"><label>Файл ${m?.filename ? `(сейчас: ${esc(m.filename)})` : ""}</label><input type="file" name="file"></div>
        ${m?.filename ? `<label class="row gap8 mb"><input type="checkbox" name="remove_file" value="1"> Удалить файл</label>` : ""}
        <div class="field"><label>…или внешняя ссылка</label><input class="input" name="url" type="url" placeholder="https://" value="${esc(m?.url || "")}"></div>
        <div class="field"><label>Порядок</label><input class="input" name="sort" type="number" value="${m?.sort || 0}"></div>
        <div class="form-error"></div><div class="row"><button class="btn primary" type="submit">Сохранить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
        (md, close) => App.onSubmit($("#mf", md), async (_, f) => {
          const fd = new FormData(f);
          if (!f.file.files[0]) fd.delete("file");
          await App.api("POST", m ? `/api/admin/materials/${m.id}` : "/api/admin/materials", undefined, { form: fd });
          close(); App.toast("Сохранено"); App.rerender();
        }));
      $("#madd", el).onclick = () => open(null);
      $$("tr.clickable", el).forEach((tr) => tr.onclick = (e) => { if (!e.target.closest("[data-del]")) open(items.find((x) => x.id === +tr.dataset.id)); });
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
