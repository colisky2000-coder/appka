/* Страницы личного кабинета пользователя. */
(() => {
  const { $, $$, esc, money, fmtDate, fmtDateTime, isoDay, ago, nl2br, linkify, qs, icon, initial, md, cover } = App;
  const P = App.pages;
  const S = () => App.cfg.settings;

  // ================= Дашборд =================
  P.dashboard = {
    feature: "dashboard",
    crumbs: [],
    async render(el) {
      const [d, news] = await Promise.all([App.get("/api/dashboard"), App.get("/api/news")]);
      const unread = news.filter((n) => !n.read).length;
      const statCards = [
        ["box", "Офферов в партнёрке", d.stats.offers, "опубликовано сейчас"],
        ["target", "Заявки", d.stats.conversions30, "за 30 дней"],
        ["click", "Переходы", d.stats.clicks30, "за 30 дней"],
        ["file", "Всего заявок", d.stats.conversions_total, "за всё время"],
      ];
      el.innerHTML = `
        <div class="page-head"><span class="avatar lg">${esc(initial(App.me.name))}</span>
          <div><h1>Добро пожаловать, ${esc(App.me.name)}</h1><p>${esc(S().dashboard_subtitle)}</p></div></div>

        <div class="card">
          <div class="row"><div class="card-title m0">${icon("trophy")}Топ участников</div><span class="spacer"></span>
            <div class="seg" id="top-seg"><button data-p="top30" class="active">30 дней</button><button data-p="top_all">За всё время</button></div></div>
          <div id="podium"></div>
          <p class="hint">${esc(S().top_note)}</p>
        </div>

        ${d.team.length ? `<div class="card"><div class="card-title">${icon("users")}Команда и каналы</div>
          ${d.team.map((t) => `<div class="team-item"><span class="ini">${esc(initial(t.name))}</span><div>
            <b>${esc(t.name)}</b><div class="small">${esc(t.role)}</div>
            <div class="links">${t.links.map((l) => {
              const href = /^https?:\/\//.test(l) ? l : l.startsWith("@") ? `https://t.me/${l.slice(1)}` : "";
              return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(l)} ↗</a>` : `<span>${esc(l)}</span>`;
            }).join("")}</div></div></div>`).join("")}</div>` : ""}

        <div class="card"><div class="card-title">${icon("chart")}Мой аккаунт</div>
          <div class="grid g2">${statCards.map(([ic, l, v, n]) => `<div class="stat"><div class="lbl">${icon(ic)}${l}</div><div class="val">${v}</div><small>${n}</small></div>`).join("")}</div></div>

        <div class="card" id="notifs">
          <div class="row mb"><div class="card-title m0">${icon("bell")}Уведомления</div>
            ${unread ? App.badge(`${unread} новых`) : ""}<span class="spacer"></span>
            ${unread ? `<button class="link-btn" id="read-all">Прочитать всё</button>` : ""}</div>
          ${news.length ? news.map((n) => `<div class="notif ${n.read ? "" : "unread"}">
              <div class="h"><b>${esc(n.title)}</b><time>${fmtDateTime(n.created_at)}</time></div>
              <p class="clip">${esc(n.body)}</p>
              <div class="row"><button class="link-btn" data-open="${n.id}">Читать целиком</button>
              ${n.read ? "" : `<button class="link-btn muted" data-read="${n.id}">Отметить прочитанным</button>`}</div></div>`).join("")
            : App.empty("bell", "Уведомлений пока нет")}
        </div>`;
      el._data = { d, news };
    },
    mount(el) {
      const { d, news } = el._data;
      const drawTop = (key) => {
        const { top, me } = d[key];
        const order = [1, 0, 2];
        $("#podium", el).innerHTML = top.length ? `<div class="podium">${order.map((i) => top[i] ? `
          <div class="place p${i + 1} ${top[i].me ? "mine" : ""}"><div class="ava">${esc(initial(top[i].name))}<span class="num">${i + 1}</span></div>
            <div class="nm">${esc(top[i].name)}</div><div class="sum">${top[i].me ? "" : "≈ "}${money(top[i].sum)}</div><div class="col"></div></div>` : "<div></div>").join("")}</div>
            ${me && me.place > 3 ? `<p class="hint">Ваше место: <b>${me.place}</b> · ${money(me.sum)}</p>` : ""}`
          : App.empty("trophy", "Рейтинг пока пуст", "Он появится после первых одобренных заявок.");
      };
      drawTop("top30");
      $$("#top-seg button", el).forEach((b) => b.onclick = () => { $$("#top-seg button", el).forEach((x) => x.classList.toggle("active", x === b)); drawTop(b.dataset.p); });
      $("#read-all", el)?.addEventListener("click", async () => { await App.post("/api/news/read-all").catch(App.fail); App.rerender(); });
      $$("[data-read]", el).forEach((b) => b.onclick = async () => { await App.post(`/api/news/${b.dataset.read}/read`).catch(App.fail); App.rerender(); });
      $$("[data-open]", el).forEach((b) => b.onclick = () => {
        const n = news.find((x) => x.id === +b.dataset.open);
        App.modal(n.title, `<p class="muted">${fmtDateTime(n.created_at)}</p><div class="body-text">${linkify(n.body)}</div>`, null,
          { onClose: () => { if (!n.read) App.rerender(); } });
        if (!n.read) App.post(`/api/news/${n.id}/read`).catch(() => {});
      });
    },
  };

  // ================= База знаний =================
  // Открыть статью: внешняя ссылка — в новой вкладке, текст — в окне
  App.openArticle = async (id) => {
    try {
      const a = await App.get(`/api/articles/${id}` + (App.programParam() ? "?" + App.programParam() : ""));
      if (a.url && !a.body) return window.open(a.url, "_blank", "noopener");
      App.modal(a.title, `${a.cover ? cover(a.cover, a.title, "wide-cover") : ""}
        <p class="muted">${esc(a.category)}${a.category ? " · " : ""}${fmtDate(a.created_at)}</p>
        <div class="prose">${md(a.body)}</div>
        ${a.url ? `<a class="btn mt" href="${esc(a.url)}" target="_blank" rel="noopener">${icon("ext")}Открыть источник</a>` : ""}`, null, { wide: true });
    } catch (e) { App.fail(e); }
  };
  // Карточка статьи или файла с превью
  App.contentCard = (x) => {
    const isFile = x.kind === "material";
    const href = isFile ? (x.download || x.url) : "";
    const tag = isFile ? `a href="${esc(href)}" ${x.download ? "" : 'target="_blank" rel="noopener"'}` : `button data-article="${x.id}"`;
    const badge = isFile ? (x.download ? icon("download") : icon("ext")) : (x.url ? icon("ext") : "");
    return `<${tag} class="card-media">${cover(x.cover, x.title)}
      <div class="cm-body">${badge ? `<span class="cm-badge">${badge}</span>` : ""}
        <h3>${esc(x.title)}</h3><p>${esc(x.description || (isFile ? x.filename : "") || "")}</p>
        <time>${icon("clock")}${ago(x.created_at)}</time></div></${isFile ? "a" : "button"}>`;
  };
  App.bindContentCards = (root) => $$("[data-article]", root).forEach((b) => b.onclick = () => App.openArticle(+b.dataset.article));

  P.manuals = {
    feature: "manuals",
    crumbs: ["База знаний"],
    async render(el) {
      const [arts, mats] = await Promise.all([App.get("/api/articles"), App.get("/api/materials")]);
      const cats = [...new Set(arts.map((a) => a.category).filter(Boolean))];
      el._data = arts;
      el.innerHTML = `${App.pageHead("book", "База знаний", "Статьи, руководства и рабочие файлы")}
        <div class="tabs"><button class="tab active" data-tab="a">${icon("book")}Статьи</button><button class="tab" data-tab="m">${icon("folder")}Файлы</button></div>
        <div data-pane="a">
          <div class="input-icon w280 mb">${icon("search")}<input class="input" id="q" placeholder="Поиск статей..."></div>
          ${cats.length ? `<div class="chips mb" id="cats"><button class="chip active" data-c="">Все<sup>${arts.length}</sup></button>
            ${cats.map((c) => `<button class="chip" data-c="${esc(c)}">${esc(c)}<sup>${arts.filter((a) => a.category === c).length}</sup></button>`).join("")}</div>` : ""}
          <div class="media-grid" id="arts"></div>
        </div>
        <div data-pane="m" hidden>
          ${mats.length ? `<div class="media-grid">${mats.map(App.contentCard).join("")}</div>` : `<div class="card soft">${App.empty("folder", "Файлов пока нет")}</div>`}
        </div>`;
    },
    mount(el) {
      const arts = el._data;
      let cat = "", q = "";
      const draw = () => {
        const list = arts.filter((a) => (!cat || a.category === cat) && (a.title + " " + a.description).toLowerCase().includes(q));
        $("#arts", el).innerHTML = list.length ? list.map(App.contentCard).join("")
          : `<div class="card soft span-all">${App.empty(arts.length ? "search" : "book", arts.length ? "Ничего не найдено" : "Статей пока нет")}</div>`;
        App.bindContentCards($("#arts", el));
      };
      draw();
      $("#q", el).oninput = (e) => { q = e.target.value.toLowerCase().trim(); draw(); };
      $$("#cats .chip", el).forEach((c) => c.onclick = () => { cat = c.dataset.c; $$("#cats .chip", el).forEach((x) => x.classList.toggle("active", x === c)); draw(); });
      App.tabs(el);
    },
  };

  // ================= Обучение =================
  const withProgram = (url) => url + (App.programParam() ? (url.includes("?") ? "&" : "?") + App.programParam() : "");
  const openTarget = (t) => {
    if (!t) return;
    if (t.type === "lesson") location.hash = `#/lesson/${t.id}`;
    else if (t.type === "article") App.openArticle(t.id);
    else window.open(t.url, t.type === "material" && t.url.startsWith("/api/") ? "_self" : "_blank", "noopener");
  };
  const targetLabel = (t) => !t ? "" : t.type === "lesson" ? `Открыть: ${t.title}` : t.type === "url" ? "Перейти по ссылке" : `Открыть: ${t.title}`;
  const taskHtml = (attr, id, text, done) => `<label class="task ${done ? "done" : ""}">
    <input type="checkbox" ${attr}="${id}" ${done ? "checked" : ""}><span class="box">${icon("check")}</span><span class="tt">${esc(text)}</span></label>`;
  let selectedStep = null; // выбранная точка роадмапа

  P.learn = {
    feature: "learning",
    crumbs: ["Обучение", "Роадмап"],
    async render(el) { el._data = await App.get(withProgram("/api/learn")); },
    mount(el) {
      let d = el._data;
      // При открытии роадмапа выделяем текущий шаг; дальше выбор держится между перерисовками
      selectedStep = d.current_step_id || d.steps[d.steps.length - 1]?.id || null;
      const reload = async () => { try { d = await App.get(withProgram("/api/learn")); draw(); } catch (e) { App.fail(e); } };
      const draw = () => {
        const pr = d.progress, pct = pr.steps_total ? Math.round((pr.steps_done / pr.steps_total) * 100) : 0;
        const cur = d.steps.find((s) => s.id === d.current_step_id);
        const allDone = pr.steps_total > 0 && !cur;
        let cont = "";
        if (cur) cont = `<button class="btn primary lg" id="continue">${icon("play")}Продолжить: ${esc(cur.target && cur.target.type === "lesson" ? cur.target.title : cur.title)}</button>`;
        else if (!pr.steps_total && d.next_lesson_id) cont = `<a class="btn primary lg" href="#/lesson/${d.next_lesson_id}">${icon("play")}Начать обучение</a>`;
        const idx = d.steps.findIndex((s) => s.id === selectedStep);
        const st = d.steps[idx];
        el.innerHTML = `
          <div class="learn-hero">
            <div class="flex1 minw0"><div class="hint caps">${esc(S().learn_title || "Обучение")}</div><h1>${esc(d.program.title)}</h1>
              ${d.program.description ? `<p class="muted m0">${esc(d.program.description)}</p>` : ""}
              <div class="progress lg mt"><div style="width:${pct}%"></div></div>
              <div class="hint">Пройдено ${pr.steps_done} из ${pr.steps_total} шагов · уроков ${pr.lessons_done} из ${pr.lessons_total}</div></div>
            <div class="hero-cta">${allDone ? `<div class="done-banner">${icon("trophy")}<span>${esc(S().learn_done_text)}</span></div>` : cont}</div>
          </div>
          ${d.steps.length ? `
          <div class="card roadmap-card"><div class="roadmap" id="rm"><div class="rm-track">
            ${d.steps.map((s, i) => `<button class="rm-point ${s.done ? "done" : ""} ${s.id === d.current_step_id ? "current" : ""} ${s.id === selectedStep ? "sel" : ""}" data-step="${s.id}">
              <span class="dot">${s.done ? icon("check") : i + 1}</span><span class="rm-label">${esc(s.title)}</span></button>`).join("")}
          </div></div></div>
          ${st ? `<div class="card step-panel">
            <div class="row">${App.badge(`Шаг ${idx + 1} из ${d.steps.length}`, "gray")}${st.done ? App.badge("Выполнен", "ok") : st.id === d.current_step_id ? App.badge("Сейчас") : ""}</div>
            <h2>${esc(st.title)}</h2>
            ${st.description ? `<div class="prose muted">${md(st.description)}</div>` : ""}
            ${st.target ? `<button class="btn accent-o" id="open-target">${icon("arrow")}${esc(targetLabel(st.target))}</button>` : ""}
            <div class="tasks">${st.tasks.length ? st.tasks.map((t) => taskHtml("data-task", t.id, t.text, t.done)).join("")
              : st.target?.type === "lesson" ? `<p class="hint">Шаг отметится сам, когда вы нажмёте «Урок пройден» в уроке.</p>${taskHtml("data-stepdone", st.id, "Шаг выполнен", st.done)}`
              : taskHtml("data-stepdone", st.id, "Шаг выполнен", st.done)}</div>
            <div class="row step-nav">
              <button class="btn sm ghost" id="prev-step" ${idx <= 0 ? "disabled" : ""}>${icon("back")}Назад</button><span class="spacer"></span>
              <button class="btn sm" id="next-step" ${idx >= d.steps.length - 1 ? "disabled" : ""}>Следующий шаг${icon("chev")}</button></div>
          </div>` : ""}`
          : `<div class="card soft">${App.empty("target", "Роадмап пока пуст", "Шаги появятся, когда их добавят в программу.")}</div>`}`;
        // прокрутить линию к выбранной точке
        const selEl = $(".rm-point.sel", el);
        if (selEl) { const rm = $("#rm", el); rm.scrollLeft = selEl.offsetLeft - rm.clientWidth / 2 + selEl.clientWidth / 2; }
        $$("[data-step]", el).forEach((b) => b.onclick = () => { selectedStep = +b.dataset.step; draw(); });
        $("#prev-step", el)?.addEventListener("click", () => { selectedStep = d.steps[idx - 1].id; draw(); });
        $("#next-step", el)?.addEventListener("click", () => { selectedStep = d.steps[idx + 1].id; draw(); });
        $("#open-target", el)?.addEventListener("click", () => openTarget(st.target));
        $("#continue", el)?.addEventListener("click", () => {
          if (cur.target) openTarget(cur.target); else { selectedStep = cur.id; draw(); $(".step-panel", el)?.scrollIntoView({ behavior: "smooth" }); }
        });
        const toggle = async (url, checked, wasDone) => {
          try {
            await App.post(url, { done: checked });
            const before = st.done;
            await reload();
            const now = d.steps.find((x) => x.id === st.id);
            if (!before && now?.done) {
              App.toast("Шаг выполнен");
              const next = d.steps.find((x) => !x.done);
              if (next) setTimeout(() => { selectedStep = next.id; draw(); }, 700);
            }
          } catch (e) { App.fail(e); draw(); }
        };
        $$("[data-task]", el).forEach((c) => c.onchange = () => { c.closest(".task").classList.toggle("done", c.checked); toggle(`/api/tasks/${c.dataset.task}/done`, c.checked); });
        $$("[data-stepdone]", el).forEach((c) => c.onchange = () => {
          if (st.target?.type === "lesson") {
            const lesson = d.lessons.find((l) => l.id === st.target.id);
            return toggle(`/api/lessons/${st.target.id}/done`, c.checked, lesson?.done);
          }
          toggle(`/api/steps/${st.id}/done`, c.checked);
        });
      };
      draw();
    },
  };

  P.lessons = {
    feature: "learning",
    crumbs: ["Обучение", "Уроки"],
    async render(el) {
      const d = await App.get(withProgram("/api/learn"));
      const pr = d.progress;
      el.innerHTML = `${App.pageHead("play", "Уроки", `${d.program.title} · пройдено ${pr.lessons_done} из ${pr.lessons_total}`)}
        ${d.lessons.length ? `<div class="media-grid">${d.lessons.map((l) => `
          <a class="card-media lesson-card ${l.done ? "done" : ""} ${l.id === d.next_lesson_id ? "next" : ""}" href="#/lesson/${l.id}">
            <div class="cover-wrap">${cover(l.cover, l.title)}${l.has_video ? `<span class="play-badge">${icon("play")}</span>` : ""}</div>
            <div class="cm-body"><div class="row gap8">${App.badge(`Урок ${l.num}`, "gray")}${l.done ? App.badge("Пройден", "ok") : l.id === d.next_lesson_id ? App.badge("Следующий") : ""}
              ${l.is_published ? "" : App.badge("черновик", "bad")}</div>
              <h3>${esc(l.title)}</h3>${l.duration ? `<time>${icon("clock")}${esc(l.duration)}</time>` : ""}</div></a>`).join("")}</div>`
          : `<div class="card soft">${App.empty("play", "Уроков пока нет")}</div>`}`;
    },
  };

  P.lesson = {
    feature: "learning",
    crumbs: ["Обучение", "Урок"],
    async render(el, id) {
      const l = await App.get(withProgram(`/api/lessons/${+id}`));
      el._data = l;
      const video = l.embed
        ? `<div class="video" id="video">${cover(l.cover, l.title, "video-cover")}<button class="play-btn" id="play" aria-label="Смотреть">${icon("play")}</button></div>`
        : l.video_url ? `<div class="video">${cover(l.cover, l.title, "video-cover")}<a class="play-btn" href="${esc(l.video_url)}" target="_blank" rel="noopener" aria-label="Смотреть">${icon("play")}</a></div>
            <p class="hint">Видео откроется на сайте площадки.</p>` : "";
      el.innerHTML = `<a class="link-btn" href="#/lessons">${icon("back")} Все уроки</a>
        <div class="lesson-head"><div class="hint">Урок ${l.num} из ${l.total}${l.duration ? " · " + esc(l.duration) : ""}</div>
          <h1>${esc(l.title)}</h1></div>
        ${video}
        ${l.body ? `<div class="card prose">${md(l.body)}</div>` : ""}
        ${l.todo.length ? `<div class="card"><div class="card-title">${icon("check")}Что сделать после урока</div>
          <div class="tasks">${l.todo.map((t) => taskHtml("data-task", t.id, t.text, t.done)).join("")}</div></div>` : ""}
        <div class="lesson-nav">
          ${l.prev_id ? `<a class="btn ghost" href="#/lesson/${l.prev_id}">${icon("back")}Предыдущий</a>` : "<span></span>"}
          <div class="row">${l.done ? `<button class="btn sm ghost" id="undone">Снять отметку</button>` : ""}
            ${l.done ? (l.next_id ? `<a class="btn primary" href="#/lesson/${l.next_id}">Следующий урок${icon("arrow")}</a>` : `<a class="btn primary" href="#/learn">К роадмапу${icon("arrow")}</a>`)
              : `<button class="btn primary" id="done">${icon("check")}Урок пройден${l.next_id ? " → дальше" : ""}</button>`}</div>
        </div>`;
    },
    mount(el) {
      const l = el._data;
      $("#play", el)?.addEventListener("click", () => {
        $("#video", el).innerHTML = `<iframe src="${esc(l.embed)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
      });
      $$("[data-task]", el).forEach((c) => c.onchange = async () => {
        c.closest(".task").classList.toggle("done", c.checked);
        try { await App.post(`/api/tasks/${c.dataset.task}/done`, { done: c.checked }); } catch (e) { App.fail(e); c.checked = !c.checked; }
      });
      $("#done", el)?.addEventListener("click", async () => {
        try {
          await App.post(`/api/lessons/${l.id}/done`, { done: true });
          App.toast("Урок пройден");
          location.hash = l.next_id ? `#/lesson/${l.next_id}` : "#/learn";
        } catch (e) { App.fail(e); }
      });
      $("#undone", el)?.addEventListener("click", async () => { await App.post(`/api/lessons/${l.id}/done`, { done: false }).catch(App.fail); App.rerender(); });
    },
  };

  P["learn-materials"] = {
    feature: "learning",
    crumbs: ["Обучение", "Материалы"],
    async render(el) {
      const items = await App.get(withProgram("/api/learn/materials"));
      el.innerHTML = `${App.pageHead("folder", "Материалы", "Статьи и файлы программы")}
        ${items.length ? `<div class="media-grid">${items.map(App.contentCard).join("")}</div>` : `<div class="card soft">${App.empty("folder", "Материалов пока нет")}</div>`}`;
    },
    mount(el) { App.bindContentCards(el); },
  };

  // Ссылка-приглашение для уже вошедшего пользователя
  P.join = {
    crumbs: ["Приглашение"],
    async render(el, code) {
      let inv;
      try { inv = await App.get(`/api/invite/${encodeURIComponent(code)}`); }
      catch (e) { el.innerHTML = `<div class="card soft narrow">${App.empty("lock", "Приглашение недействительно", e.message)}</div>`; return; }
      if (App.me.tariff?.name === inv.tariff) { location.hash = "#/" + App.home(); return; }
      el._code = code;
      el.innerHTML = `<div class="card narrow center">${icon("gift", "gold big")}<h2>Доступ к «${esc(inv.tariff)}»</h2>
        ${inv.description ? `<p class="muted">${esc(inv.description)}</p>` : ""}
        ${App.me.tariff ? `<p class="hint">Ваш текущий тариф «${esc(App.me.tariff.name)}» будет заменён.</p>` : ""}
        ${inv.days ? `<p class="hint">Доступ на ${inv.days} дн.</p>` : ""}
        <button class="btn primary block" id="activate">Активировать</button></div>`;
    },
    mount(el) {
      $("#activate", el)?.addEventListener("click", async () => {
        try { await App.post(`/api/invite/${encodeURIComponent(el._code)}/activate`); await App.reloadConfig(); App.toast("Доступ активирован"); location.hash = "#/" + App.home(); }
        catch (e) { App.fail(e); }
      });
    },
  };

  // ================= Закуп трафика =================
  const topupDialog = (instructions) => App.modal("Пополнить баланс", `
    <form id="tu">${instructions ? `<div class="notice">${linkify(instructions)}</div>` : ""}
      <div class="field"><label>Сумма, ₽</label><input class="input" name="amount" type="number" min="1" step="0.01" required></div>
      <div class="field"><label>Комментарий (например, номер платежа)</label><input class="input" name="note" maxlength="300"></div>
      <div class="form-error"></div>
      <div class="row"><button class="btn primary" type="submit">Отправить заявку</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
    (m, close) => App.onSubmit($("#tu", m), async (d) => {
      await App.post("/api/topups", d); close(); App.toast("Заявка отправлена — баланс пополнится после проверки"); App.rerender();
    }));

  P.traffic = {
    feature: "traffic",
    crumbs: ["Закуп трафика"],
    async render(el) {
      const t = await App.get("/api/traffic");
      el._data = t;
      const tStatus = { pending: "На проверке", approved: "Зачислено", rejected: "Отклонено" };
      el.innerHTML = `${App.pageHead("cart", "Закуп трафика", "Покупка строк трафика для работы")}
        <div class="grid g3 mb">
          <div class="stat"><div class="lbl">${icon("wallet", "gold")}Ваш баланс</div><div class="val">${money(t.balance, 2)}</div>
            <button class="btn ghost sm pl0" data-topup>${icon("card")}Пополнить баланс</button></div>
          <div class="stat"><div class="lbl">${icon("box", "ok")}Свободно строк</div><div class="val ok">${t.available}</div><small>по ${money(t.price, 2)} за строку</small></div>
          <div class="stat"><div class="lbl">${icon("download", "info")}Куплено вами</div><div class="val info">${t.bought_rows}</div><small>на ${money(t.spent, 2)} за ${t.purchases.length} покупок</small></div>
        </div>
        <div class="card">
          <h3 class="card-h">Купить строки</h3>
          <p class="hint mb">Формат строки: ${esc(t.format)}</p>
          <div class="field"><label>Количество строк</label>
            <div class="qty"><button class="sq" data-d="-1" aria-label="Меньше">${icon("minus")}</button><input class="input" id="qty" type="number" min="1" value="${Math.min(100, Math.max(1, t.available))}">
            <button class="sq" data-d="1" aria-label="Больше">${icon("plus")}</button><button class="btn sm" id="all">всё</button></div></div>
          <div class="summary">
            <div class="ln"><span>Цена за строку</span><span class="muted">${money(t.price, 2)}</span></div>
            <div class="ln"><span>Строк</span><span class="muted" id="s-rows"></span></div>
            <div class="ln total"><span class="muted">Итого</span><b id="s-total"></b></div>
            <button class="btn block primary mt" id="buy">${icon("cart")}Купить</button>
          </div>
          <div id="buy-err"></div>
        </div>
        ${t.topups.length ? `<div class="card"><div class="card-title">${icon("card")}Заявки на пополнение</div>
          <div class="table-wrap"><table><tr><th>Дата</th><th>Сумма</th><th>Статус</th><th>Комментарий</th></tr>
          ${t.topups.map((x) => `<tr><td>${fmtDateTime(x.created_at)}</td><td class="mono">${money(x.amount, 2)}</td><td>${App.badge(tStatus[x.status] || x.status, App.statusTone(x.status === "approved" ? "active" : x.status === "rejected" ? "rejected" : "pending"))}</td><td>${esc(x.admin_note)}</td></tr>`).join("")}</table></div></div>` : ""}
        <div class="card"><div class="card-title">${icon("history")}Мои покупки</div>
          ${t.purchases.length ? `<div class="table-wrap"><table><tr><th>Дата</th><th>Строк</th><th>Сумма</th><th></th></tr>
            ${t.purchases.map((p) => `<tr><td>${fmtDateTime(p.created_at)}</td><td>${p.rows}</td><td class="mono">${money(p.total, 2)}</td>
              <td><a class="link-btn" href="/api/traffic/purchases/${p.id}/download">${icon("download")} Скачать</a></td></tr>`).join("")}</table></div>`
            : App.empty("history", "История покупок пуста", "После покупки здесь появится файл со строками.")}
        </div>`;
    },
    mount(el) {
      const t = el._data, inp = $("#qty", el);
      const calc = () => {
        const n = Math.max(0, parseInt(inp.value, 10) || 0), total = Math.round(n * t.price * 100) / 100;
        $("#s-rows", el).textContent = n;
        $("#s-total", el).textContent = money(total, 2);
        let err = "";
        if (n > t.available) err = `Столько строк нет в наличии: свободно ${t.available}`;
        else if (total > t.balance) err = `Недостаточно средств: не хватает ${money(total - t.balance, 2)}`;
        $("#buy-err", el).innerHTML = err ? `<div class="alert"><span>${esc(err)}</span>${total > t.balance ? `<button class="btn sm" data-topup>${icon("card")}Пополнить баланс</button>` : ""}</div>` : "";
        $("#buy", el).disabled = !!err || n === 0;
        $$("[data-topup]", el).forEach((b) => b.onclick = () => topupDialog(t.topup_instructions));
      };
      $$("[data-d]", el).forEach((b) => b.onclick = () => { inp.value = Math.max(1, (parseInt(inp.value, 10) || 0) + +b.dataset.d); calc(); });
      $("#all", el).onclick = () => { inp.value = t.available; calc(); };
      inp.oninput = calc;
      $("#buy", el).onclick = async () => {
        const n = parseInt(inp.value, 10);
        if (!(await App.confirm(`Купить ${n} строк за ${money(n * t.price, 2)}?`, "Купить"))) return;
        try { await App.post("/api/traffic/buy", { rows: n }); App.toast("Покупка оформлена"); App.reloadMe(); App.rerender(); }
        catch (e) { App.fail(e); }
      };
      calc();
    },
  };

  // ================= Партнёрка: офферы =================
  function linkBlock(o, access) {
    const l = o.link;
    if (!access) return `<p class="hint">${icon("lock")} Ссылки откроются после одобрения доступа.</p>`;
    if (!l) return `<button class="btn sm primary" data-getlink="${o.id}">${icon("link")}Получить ссылку</button>`;
    if (l.status === "requested") return `<div class="notice">${icon("clock")} Ссылка запрошена и ожидает выдачи.</div>`;
    if (l.status === "disabled") return `<div class="notice">${icon("lock")} Ссылка отключена администратором.</div>`;
    return `
      ${l.limit ? `<div class="row small"><span>Заявок по ссылке</span><span class="spacer"></span><span class="mono">${l.used}/${l.limit}</span></div>
        <div class="progress"><div style="width:${Math.min(100, (l.used / l.limit) * 100)}%"></div></div>` : ""}
      <div class="linkbox">${esc(l.url)}</div>
      <div class="row">
        <button class="btn sm" data-copy="${esc(l.url)}">${icon("copy")}Скопировать ссылку</button>
        <label class="row gap8 small"><span class="switch"><input type="checkbox" data-form="${l.id}" ${l.form_enabled ? "checked" : ""}><span></span></span>Форма заявки</label>
        ${l.form_enabled ? `<button class="btn sm ghost" data-copy="${esc(l.form_url)}">${icon("copy")}Ссылка на форму</button>` : ""}
      </div>
      <p class="hint">${esc(S().form_note)}</p>`;
  }
  function offerCard(o, access, compact) {
    return `<div class="offer ${compact ? "compact" : ""}">
      <div class="top">
        <span class="logo-o">${esc(o.partner[0] || "")}</span>
        <div class="minw0"><h4>${esc(o.name)}</h4><div class="partner">${esc(o.partner)}</div></div>
        <div class="pay"><b>${money(o.payout)}</b><small>выплата</small></div>
        <button class="star ${o.favorite ? "on" : ""}" data-star="${o.id}" title="${o.favorite ? "Убрать из избранного" : "В избранное"}">${icon("star")}</button>
      </div>
      <div class="tags">${o.type ? App.badge(o.type.toUpperCase()) : ""}${o.tax_note ? App.badge(o.tax_note, "gray") : ""}</div>
      <div class="body">
        ${o.description ? `<details><summary>${icon("chev")}Описание и целевое действие</summary><p>${nl2br(o.description)}</p></details>` : ""}
        <div class="mt">${linkBlock(o, access)}</div>
      </div></div>`;
  }
  function bindOffers(el, reload) {
    $$("[data-star]", el).forEach((b) => b.onclick = async () => { try { await App.post(`/api/offers/${b.dataset.star}/favorite`); reload(); } catch (e) { App.fail(e); } });
    $$("[data-copy]", el).forEach((b) => b.onclick = () => App.copy(b.dataset.copy));
    $$("[data-getlink]", el).forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        const l = await App.post(`/api/offers/${b.dataset.getlink}/link`);
        App.toast(l.status === "active" ? "Ссылка готова" : "Ссылка запрошена");
        reload();
      } catch (e) { App.fail(e); b.disabled = false; }
    });
    $$("[data-form]", el).forEach((c) => c.onchange = async () => {
      try { await App.patch(`/api/links/${c.dataset.form}`, { form_enabled: c.checked }); App.toast(c.checked ? "Форма включена" : "Форма выключена"); reload(); }
      catch (e) { App.fail(e); c.checked = !c.checked; }
    });
  }
  const accessBanner = (access) => access ? "" : `
    <div class="card accent row"><span class="gift">${icon("lock")}</span><div class="flex1"><b>Доступ к ссылкам</b><p class="muted m0">${esc(S().links_access_note)}</p></div>
      <button class="btn accent-o" id="req-access">Запросить доступ</button></div>`;
  const bindAccess = (el) => $("#req-access", el)?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await App.post("/api/access-request", {}); App.toast("Заявка на доступ отправлена"); e.target.textContent = "Заявка отправлена"; }
    catch (ex) { App.fail(ex); e.target.disabled = false; }
  });

  let offerView = "full";
  try { offerView = localStorage.getItem("cab:offerView") || "full"; } catch { /* ignore */ }
  const offerFilters = { q: "", partner: "", type: "" };

  P.offers = {
    feature: "offers",
    crumbs: ["Партнёрка", "Офферы"],
    async render(el) {
      const data = await App.get("/api/offers");
      el._data = data;
      const s = S();
      const partners = [...new Set(data.offers.map((o) => o.partner))];
      const types = [...new Set(data.offers.map((o) => o.type).filter(Boolean))];
      el.innerHTML = `${App.pageHead("handshake", "Партнёрка", s.offers_subtitle)}
        ${partners.length > 1 ? `<div class="tabs" id="ptabs"><button class="tab" data-p="">Все</button>${partners.map((p) => `<button class="tab" data-p="${esc(p)}">${esc(p)}</button>`).join("")}</div>` : ""}
        ${s.bonus_enabled ? `<div class="promo"><span class="gift">${icon("gift")}</span>
          <div class="flex1"><h3>${esc(s.bonus_title)}</h3>${s.bonus_badge ? App.badge(s.bonus_badge) : ""}<p>${nl2br(s.bonus_text)}</p>${s.bonus_note ? `<small>${nl2br(s.bonus_note)}</small>` : ""}</div>
          ${App.can("billing") ? `<a class="btn accent-o" href="#/billing">Тарифы →</a>` : ""}</div>` : ""}
        ${accessBanner(data.links_access)}
        <div class="filters">
          <div class="input-icon">${icon("search")}<input class="input" id="oq" placeholder="Поиск по названию" value="${esc(offerFilters.q)}"></div>
          <select class="input" id="opart"><option value="">Все партнёры</option>${partners.map((p) => `<option ${p === offerFilters.partner ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
          <select class="input" id="otype"><option value="">Все типы</option>${types.map((p) => `<option ${p === offerFilters.type ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        </div>
        <div class="row mb"><span class="hint" id="ocount"></span><span class="spacer"></span>
          <div class="seg" id="oview"><button data-v="full">${icon("grid")} Расширенный</button><button data-v="compact">${icon("list")} Компакт</button></div></div>
        <div id="olist"></div>`;
    },
    mount(el) {
      const data = el._data, f = offerFilters;
      const draw = () => {
        const list = data.offers.filter((o) => (!f.partner || o.partner === f.partner) && (!f.type || o.type === f.type) && o.name.toLowerCase().includes(f.q));
        $("#ocount", el).textContent = `Показано ${list.length} из ${data.offers.length}`;
        $("#olist", el).innerHTML = list.length ? list.map((o) => offerCard(o, data.links_access, offerView === "compact")).join("")
          : `<div class="card soft">${App.empty("search", data.offers.length ? "Офферы не найдены" : "Офферов пока нет")}</div>`;
        $$("#oview button", el).forEach((b) => b.classList.toggle("active", b.dataset.v === offerView));
        $$("#ptabs .tab", el).forEach((t) => t.classList.toggle("active", t.dataset.p === f.partner));
        bindOffers($("#olist", el), App.rerender);
      };
      $("#oq", el).oninput = (e) => { f.q = e.target.value.toLowerCase().trim(); draw(); };
      $("#opart", el).onchange = (e) => { f.partner = e.target.value; draw(); };
      $("#otype", el).onchange = (e) => { f.type = e.target.value; draw(); };
      $$("#ptabs .tab", el).forEach((t) => t.onclick = () => { f.partner = t.dataset.p; $("#opart", el).value = f.partner; draw(); });
      $$("#oview button", el).forEach((b) => b.onclick = () => { offerView = b.dataset.v; try { localStorage.setItem("cab:offerView", offerView); } catch { /* ignore */ } draw(); });
      bindAccess(el);
      draw();
    },
  };

  // ================= Избранное и ссылки =================
  P.favorites = {
    feature: "favorites",
    crumbs: ["Партнёрка", "Избранное и ссылки"],
    async render(el) {
      const [data, links] = await Promise.all([App.get("/api/offers"), App.get("/api/links")]);
      el._data = data;
      const favs = data.offers.filter((o) => o.favorite);
      const forms = links.filter((l) => l.form_enabled && l.status === "active");
      const toCatalog = `<br><a class="btn sm mt" href="#/offers">Перейти в каталог</a>`;
      const lStatus = { requested: "Запрошена", active: "Активна", disabled: "Отключена" };
      el.innerHTML = `${App.pageHead("star", "Избранное и ссылки", "Отмеченные офферы, ваши ссылки и формы заявок. Реальный адрес партнёра скрыт — переходы считаются у нас.")}
        ${accessBanner(data.links_access)}
        <div class="tabs"><button class="tab active" data-tab="fav">Избранное</button><button class="tab" data-tab="links">Мои ссылки</button><button class="tab" data-tab="forms">Формы заявок</button></div>
        <div data-pane="fav">${favs.length ? favs.map((o) => offerCard(o, data.links_access)).join("")
          : `<div class="card soft">${App.empty("star", "Избранных офферов пока нет", "Нажмите звезду на карточке оффера в каталоге.", toCatalog)}</div>`}</div>
        <div data-pane="links" hidden>${links.length ? `<div class="table-wrap"><table><tr><th>Оффер</th><th>Статус</th><th>Ссылка</th><th>Переходы</th><th>Заявки</th><th></th></tr>
          ${links.map((l) => `<tr><td>${esc(l.offer_name)}</td><td>${App.badge(lStatus[l.status] || l.status, App.statusTone(l.status))}</td>
            <td class="mono">${esc(l.url || "—")}</td><td>${l.clicks}</td><td>${l.used}${l.limit ? "/" + l.limit : ""}</td>
            <td>${l.url ? `<button class="link-btn" data-copy="${esc(l.url)}">Копировать</button>` : ""}</td></tr>`).join("")}</table></div>`
          : `<div class="card soft">${App.empty("link", "Ссылок пока нет", "Откройте оффер в каталоге и нажмите «Получить ссылку».", toCatalog)}</div>`}</div>
        <div data-pane="forms" hidden>${forms.length ? `<div class="table-wrap"><table><tr><th>Оффер</th><th>Адрес формы</th><th></th></tr>
          ${forms.map((l) => `<tr><td>${esc(l.offer_name)}</td><td class="mono">${esc(l.form_url)}</td><td><button class="link-btn" data-copy="${esc(l.form_url)}">Копировать</button></td></tr>`).join("")}</table></div>`
          : `<div class="card soft">${App.empty("file", "Все формы выключены", "Включите форму на карточке оффера — клиент сможет сам оставить заявку.")}</div>`}</div>`;
    },
    mount(el) { App.tabs(el); bindOffers(el, App.rerender); bindAccess(el); },
  };

  // ================= Заявки =================
  const ticketDialog = (topic, conversions = []) => App.modal("Новый вопрос", `
    <form id="nt">
      ${topic === "conversion" && conversions.length ? `<div class="field"><label>Заявка</label><select class="input" name="conversion_id"><option value="">— не выбрана —</option>
        ${conversions.map((c) => `<option value="${c.id}">#${c.id} · ${esc(c.fio)} · ${esc(c.inn)}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label>Тема</label><input class="input" name="subject" maxlength="200" required></div>
      <div class="field"><label>Сообщение</label><textarea class="input" name="body" rows="5" required></textarea></div>
      <div class="form-error"></div>
      <div class="row"><button class="btn primary" type="submit">Отправить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
    (m, close) => App.onSubmit($("#nt", m), async (d) => {
      const t = await App.post("/api/tickets", { ...d, topic });
      close(); App.toast("Обращение отправлено"); location.hash = `#/ticket/${t.id}`;
    }));
  App.ticketDialog = ticketDialog;

  const ticketList = (tickets) => tickets.length ? `<div class="list">${tickets.map((t) => `
    <a class="list-item" href="#/ticket/${t.id}"><div class="flex1"><b>${esc(t.subject)}</b><div class="hint">${fmtDateTime(t.updated_at)}</div></div>
      ${App.badge({ open: "Открыт", answered: "Есть ответ", closed: "Закрыт" }[t.status] || t.status, App.statusTone(t.status))}</a>`).join("")}</div>`
    : `<div class="card soft">${App.empty("chat", "Обращений пока нет")}</div>`;

  P.conversions = {
    feature: "conversions",
    crumbs: ["Партнёрка", "Заявки"],
    async render(el) {
      const [data, tickets] = await Promise.all([App.get("/api/offers"), App.get("/api/tickets?topic=conversion")]);
      el._offers = data.offers;
      const s = S(), now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      el.innerHTML = `${App.pageHead("", "Заявки", "Создание и отслеживание ваших заявок", true)}
        <div class="tabs"><button class="tab active" data-tab="apps">Заявки</button><button class="tab" data-tab="q">${icon("chat")}Вопросы по заявкам</button></div>
        <div data-pane="apps">
          <div class="row mb"><button class="btn sm primary" id="new-app">${icon("plus")}Новая заявка</button><button class="btn sm" id="ask">${icon("chat")}Вопрос по заявке</button></div>
          <div class="grid g2 mb">
            ${s.conv_notice1_title || s.conv_notice1_text ? `<div class="card accent m0"><div class="row top"><span class="gift">${icon("warn")}</span>
              <div class="flex1">${App.badge("ВАЖНО")}<h3 class="card-h mt8">${esc(s.conv_notice1_title)}</h3><p class="m0">${nl2br(s.conv_notice1_text)}</p></div></div></div>` : ""}
            ${s.conv_notice2_title || s.conv_notice2_text ? `<div class="card soft m0"><div class="row top"><span class="gift info">${icon("send")}</span>
              <div class="flex1">${App.badge("TELEGRAM", "info")}<h3 class="card-h mt8">${esc(s.conv_notice2_title)}</h3><p class="m0">${nl2br(s.conv_notice2_text)}</p>
              ${s.conv_notice2_url ? `<a class="link-btn mt inline-block" href="${esc(s.conv_notice2_url)}" target="_blank" rel="noopener">Перейти в канал ↗</a>` : ""}</div></div></div>` : ""}
          </div>
          <div class="card">
            <div class="row"><div class="input-icon flex2">${icon("search")}<input class="input" id="cq" placeholder="ИНН, ФИО, телефон..."></div>
              <select class="input flex1" id="cst"><option value="">Все статусы</option>${Object.entries(App.cfg.statuses).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
              <select class="input flex1" id="coffer"><option value="">Все офферы</option>${data.offers.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>
            <div class="row mt"><span>С</span><input class="input wauto" type="date" id="cfrom" value="${isoDay(from)}"><span>по</span><input class="input wauto" type="date" id="cto" value="${isoDay(to)}"></div>
          </div>
          <div id="ctable">${App.loading()}</div>
        </div>
        <div data-pane="q" hidden>${ticketList(tickets)}</div>`;
    },
    mount(el) {
      App.tabs(el);
      let rows = [];
      const draw = async () => {
        try {
          rows = await App.get("/api/conversions?" + qs({ q: $("#cq", el).value, status: $("#cst", el).value, offer: $("#coffer", el).value, from: $("#cfrom", el).value, to: $("#cto", el).value }));
        } catch (e) { return App.fail(e); }
        $("#ctable", el).innerHTML = `<div class="table-wrap"><table><tr><th>Дата</th><th>Оффер</th><th>ИНН</th><th>ФИО</th><th>Статус</th><th>Дата статуса</th><th>Сумма</th></tr>
          ${rows.length ? rows.map((r) => `<tr><td>${fmtDate(r.created_at)}</td><td>${esc(r.offer_name)}</td><td class="mono">${esc(r.inn)}</td><td>${esc(r.fio)}</td>
            <td>${App.badge(r.status_name, App.statusTone(r.status))}${r.comment ? `<div class="hint wrap">${esc(r.comment)}</div>` : ""}</td>
            <td>${fmtDate(r.status_changed_at)}</td><td class="mono">${money(r.amount)}</td></tr>`).join("")
          : `<tr><td colspan="7">${App.empty("file", "Заявок не найдено")}</td></tr>`}</table></div>`;
      };
      let timer;
      $("#cq", el).addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(draw, 300); });
      ["#cst", "#coffer", "#cfrom", "#cto"].forEach((s) => $(s, el).addEventListener("change", draw));
      draw();
      $("#ask", el).onclick = () => ticketDialog("conversion", rows);
      $("#new-app", el).onclick = () => {
        if (!el._offers.length) return App.toast("Нет доступных офферов", true);
        App.modal("Новая заявка", `
          <form id="na"><div class="field"><label>Оффер</label><select class="input" name="offer_id">${el._offers.map((o) => `<option value="${o.id}">${esc(o.partner)} — ${esc(o.name)}</option>`).join("")}</select></div>
          <div class="field"><label>ИНН</label><input class="input" name="inn" inputmode="numeric" required placeholder="10 или 12 цифр"></div>
          <div class="field"><label>ФИО</label><input class="input" name="fio" required></div>
          <div class="field"><label>Телефон</label><input class="input" name="phone" type="tel"></div>
          <div class="field"><label>Субметка (необязательно)</label><input class="input" name="subid" maxlength="80"></div>
          <div class="form-error"></div>
          <div class="row"><button class="btn primary" type="submit">Создать</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
          (m, close) => App.onSubmit($("#na", m), async (d) => { await App.post("/api/conversions", d); close(); App.toast("Заявка создана"); draw(); }));
      };
    },
  };

  // ================= Статистика =================
  P.stats = {
    feature: "stats",
    crumbs: ["Партнёрка", "Статистика"],
    async render(el) {
      const data = await App.get("/api/offers");
      const to = new Date(), from = new Date(Date.now() - 29 * 864e5);
      el.innerHTML = `${App.pageHead("chart", "Статистика", "Переходы, заявки и начисления с учётом вашей ставки")}
        <form class="card" id="sf">
          <div class="row bottom"><div class="field m0"><label>Период с</label><input class="input" type="date" name="from" value="${isoDay(from)}"></div>
            <div class="field m0"><label>по</label><input class="input" type="date" name="to" value="${isoDay(to)}"></div>
            ${[7, 30, 90].map((d) => `<button type="button" class="btn sm" data-days="${d}">${d} дней</button>`).join("")}</div>
          <div class="grid g2 mt">
            <div class="field"><label>Оффер</label><select class="input" name="offer"><option value="">Все офферы</option>${data.offers.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>
            <div class="field"><label>Статус заявки</label><select class="input" name="status"><option value="">Все статусы</option>${Object.entries(App.cfg.statuses).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
            <div class="field"><label>Субметка</label><select class="input" name="subid"><option value="">Не выбрана</option></select></div>
            <div class="field"><label>Группировка</label><select class="input" name="group"><option value="day">По дням</option><option value="offer">По офферам</option><option value="subid">По субметкам</option></select></div>
          </div>
          <div class="row"><label class="row gap8"><span class="switch"><input type="checkbox" name="unique" value="1"><span></span></span>Только уникальные переходы</label><span class="spacer"></span>
            <a class="btn sm" id="csv">${icon("download")}CSV</a></div>
        </form>
        <div id="sres">${App.loading()}</div>`;
    },
    mount(el) {
      const form = $("#sf", el);
      let subidsLoaded = false;
      const params = () => { const d = Object.fromEntries(new FormData(form)); return qs(d); };
      const load = async () => {
        $("#csv", el).href = "/api/stats.csv?" + params();
        let s;
        try { s = await App.get("/api/stats?" + params()); } catch (e) { return App.fail(e); }
        if (!subidsLoaded && s.subids.length) {
          form.subid.innerHTML += s.subids.map((x) => `<option>${esc(x)}</option>`).join(""); subidsLoaded = true;
        }
        const t = s.totals;
        $("#sres", el).innerHTML = `
          <div class="grid g3 mb">
            <div class="stat"><div class="lbl">${icon("click")}ПЕРЕХОДЫ</div><div class="val">${t.clicks}</div><small>${form.unique.checked ? "уникальные" : "все переходы"}</small></div>
            <div class="stat"><div class="lbl">${icon("trend")}ЗАЯВКИ</div><div class="val">${t.conversions}</div><small>CR ${t.cr.toFixed(2)} % · AR ${t.ar.toFixed(2)} %</small></div>
            <div class="stat"><div class="lbl">${icon("cash")}ДОСТУПНО К ВЫВОДУ</div><div class="val accent">${money(t.available)}</div><small>Подтверждено партнёром</small></div>
            <div class="stat"><div class="lbl">${icon("cash")}В ХОЛДЕ</div><div class="val">${money(t.hold)}</div><small>Решение есть, ждём выплату</small></div>
            <div class="stat"><div class="lbl">${icon("hourglass")}В РАБОТЕ</div><div class="val">${money(t.work)}</div><small>Заявка рассматривается</small></div>
            <div class="stat"><div class="lbl">${icon("check")}ВЫПЛАЧЕНО</div><div class="val ok">${money(t.paid)}</div><small>За выбранный период</small></div>
          </div>
          ${s.rows.length ? `<div class="table-wrap"><table><tr><th>${{ day: "Дата", offer: "Оффер", subid: "Субметка" }[form.group.value]}</th><th>Переходы</th><th>Заявки</th><th>Сумма</th></tr>
            ${s.rows.map((r) => `<tr><td>${esc(form.group.value === "day" ? fmtDate(r.key) : r.key)}</td><td>${r.clicks}</td><td>${r.conversions}</td><td class="mono">${money(r.amount)}</td></tr>`).join("")}</table></div>`
            : `<div class="card soft">${App.empty("chart", "Ничего не найдено", "Когда по вашим ссылкам пойдут переходы, они появятся здесь.")}</div>`}`;
      };
      $$("[data-days]", el).forEach((b) => b.onclick = () => {
        form.to.value = isoDay(new Date()); form.from.value = isoDay(new Date(Date.now() - (b.dataset.days - 1) * 864e5)); load();
      });
      form.addEventListener("change", load);
      form.addEventListener("submit", (e) => { e.preventDefault(); load(); });
      load();
    },
  };

  // ================= Доходы =================
  P.income = {
    feature: "income",
    crumbs: ["Доходы"],
    async render(el) {
      const d = await App.get("/api/income");
      const s = d.summary;
      const kinds = { topup: "Пополнение", purchase: "Покупка трафика", tariff: "Оплата тарифа", adjust: "Корректировка" };
      el.innerHTML = `${App.pageHead("wallet", "Доходы", "Начисления по заявкам и движение баланса")}
        <div class="grid g3 mb">
          <div class="stat"><div class="lbl">${icon("cash")}Доступно к выводу</div><div class="val accent">${money(s.available)}</div><small>Одобрено партнёром</small></div>
          <div class="stat"><div class="lbl">${icon("cash")}В холде</div><div class="val">${money(s.hold)}</div><small>Ждём подтверждения выплаты</small></div>
          <div class="stat"><div class="lbl">${icon("hourglass")}В работе</div><div class="val">${money(s.work)}</div><small>Заявки на рассмотрении</small></div>
          <div class="stat"><div class="lbl">${icon("check")}Выплачено</div><div class="val ok">${money(s.paid)}</div><small>За всё время</small></div>
          <div class="stat"><div class="lbl">${icon("wallet")}Баланс</div><div class="val">${money(d.balance, 2)}</div><small>Для покупок в кабинете</small></div>
        </div>
        <div class="card"><div class="card-title">${icon("file")}Начисления</div>
          ${d.conversions.length ? `<div class="table-wrap"><table><tr><th>Дата статуса</th><th>Оффер</th><th>Клиент</th><th>Статус</th><th>Сумма</th></tr>
            ${d.conversions.map((c) => `<tr><td>${fmtDate(c.status_changed_at || c.created_at)}</td><td>${esc(c.offer_name)}</td><td>${esc(c.fio)}</td>
              <td>${App.badge(c.status_name, App.statusTone(c.status))}</td><td class="mono">${money(c.amount)}</td></tr>`).join("")}</table></div>`
            : App.empty("cash", "Начислений пока нет")}</div>
        <div class="card"><div class="card-title">${icon("history")}Движение баланса</div>
          ${d.transactions.length ? `<div class="table-wrap"><table><tr><th>Дата</th><th>Операция</th><th>Сумма</th></tr>
            ${d.transactions.map((t) => `<tr><td>${fmtDateTime(t.created_at)}</td><td>${esc(kinds[t.kind] || t.kind)}${t.note ? `<div class="hint">${esc(t.note)}</div>` : ""}</td>
              <td class="mono ${t.amount < 0 ? "bad" : "ok"}">${t.amount > 0 ? "+" : ""}${money(t.amount, 2)}</td></tr>`).join("")}</table></div>`
            : App.empty("history", "Операций пока нет")}</div>`;
    },
  };

  // ================= Поддержка =================
  P.support = {
    feature: "support",
    crumbs: ["Поддержка"],
    async render(el) {
      const tickets = await App.get("/api/tickets");
      el.innerHTML = `${App.pageHead("chat", "Поддержка", S().support_subtitle)}
        <button class="btn primary mb" id="nt-btn">${icon("plus")}Новый вопрос</button>${ticketList(tickets)}`;
    },
    mount(el) { $("#nt-btn", el).onclick = () => ticketDialog("general"); },
  };

  const messagesHtml = (t) => `<div class="messages">${t.messages.map((m) => `
    <div class="msg ${m.is_admin ? "admin" : "mine"}"><div class="msg-h">${m.is_admin ? "Поддержка" : "Вы"} · ${fmtDateTime(m.created_at)}</div><div>${linkify(m.body)}</div></div>`).join("")}</div>`;
  App.messagesHtml = messagesHtml;

  P.ticket = {
    feature: "support",
    crumbs: ["Поддержка", "Обращение"],
    async render(el, id) {
      const t = await App.get(`/api/tickets/${+id}`);
      el.innerHTML = `<a class="link-btn" href="#/support">${icon("back")} Все обращения</a>
        <div class="row mt mb"><h2 class="m0 flex1">${esc(t.subject)}</h2>${App.badge({ open: "Открыт", answered: "Есть ответ", closed: "Закрыт" }[t.status], App.statusTone(t.status))}</div>
        ${t.conversion_id ? `<p class="hint">По заявке #${t.conversion_id}</p>` : ""}
        <div class="card">${messagesHtml(t)}</div>
        ${t.status !== "closed" ? `<form class="card" id="reply"><div class="field"><label>Ответ</label><textarea class="input" name="body" rows="4" required></textarea></div>
          <div class="form-error"></div><div class="row"><button class="btn primary" type="submit">${icon("send")}Отправить</button><span class="spacer"></span>
          <button type="button" class="btn sm" id="close-t">Закрыть обращение</button></div></form>` : ""}`;
    },
    mount(el, id) {
      const f = $("#reply", el);
      if (!f) return;
      App.onSubmit(f, async (d) => { await App.post(`/api/tickets/${+id}/messages`, d); App.rerender(); });
      $("#close-t", el).onclick = async () => { if (await App.confirm("Закрыть обращение?")) { await App.post(`/api/tickets/${+id}/close`).catch(App.fail); App.rerender(); } };
    },
  };

  // ================= Профиль =================
  P.profile = {
    crumbs: ["Профиль"],
    async render(el) {
      const [me, sessions] = await Promise.all([App.get("/api/me"), App.get("/api/me/sessions")]);
      const bot = App.cfg.telegram_bot;
      const toggle = (key, title, text, ic) => `<div class="setting">${ic ? icon(ic, "gold") : ""}<div class="txt"><b>${esc(title)}</b><span class="muted">${esc(text)}</span></div>
        <label class="switch"><input type="checkbox" data-set="${key}" ${me[key] ? "checked" : ""}><span></span></label></div>`;
      el.innerHTML = `${App.pageHead("user", "Мой профиль", "Личные данные и настройки")}
        <form class="card" id="pf">
          <div class="field"><label>Email</label><input class="input" value="${esc(me.email)}" disabled></div>
          <div class="field"><label>Отображаемое имя</label><input class="input" name="display_name" value="${esc(me.display_name)}" maxlength="120" placeholder="Как вас показывать в кабинете"></div>
          <div class="field"><label>Юзернейм в Telegram</label><input class="input" name="username" value="${esc(me.username)}" maxlength="64" placeholder="@username"></div>
          <div class="form-error"></div>
          <button class="btn" type="submit">${icon("check")}Сохранить</button>
        </form>
        <div class="card"><div class="card-title">${icon("send")}Уведомления в Telegram</div>
          ${me.telegram_linked ? `<div class="row"><span>${icon("check", "ok")} Telegram привязан</span><span class="spacer"></span><button class="btn sm" id="tg-off">Отвязать</button></div>`
            : bot ? `<p class="muted m0">Привяжите Telegram, чтобы получать уведомления о статусах заявок, ответах поддержки и пополнениях.</p><button class="btn block mt" id="tg-on">${icon("send")}Привязать через бота</button>`
            : `<p class="muted m0">Уведомления в Telegram пока не настроены администратором.</p>`}</div>
        <div class="card"><div class="card-title">${icon("bell")}Настройки</div>
          ${toggle("notify", "Получать уведомления", "Статусы заявок, ответы поддержки, пополнения")}
          ${toggle("show_in_top", "Показывать моё имя в топе", "Если выключено — в рейтинге вы отображаетесь как «Участник #N». Место и округлённая сумма видны всегда.")}</div>
        <div class="card"><div class="row"><div class="card-title m0">${icon("shield")}Активные сессии</div><span class="spacer"></span>
          ${sessions.length > 1 ? `<button class="btn sm" id="kill-all">Завершить остальные (${sessions.length - 1})</button>` : ""}</div>
          ${sessions.map((x) => `<div class="setting"><div class="txt"><b>${esc(uaName(x.user_agent))} ${x.current ? App.badge("Текущая") : ""}</b>
            <span class="hint">${esc(x.ip)} · активна ${fmtDateTime(x.last_active)}</span></div>${x.current ? "" : `<button class="btn sm" data-kill="${x.id}">Завершить</button>`}</div>`).join("")}</div>`;
    },
    mount(el) {
      App.onSubmit($("#pf", el), async (d) => { await App.patch("/api/me", d); App.toast("Сохранено"); App.reloadMe(); });
      $$("[data-set]", el).forEach((c) => c.onchange = async () => {
        try { await App.patch("/api/me", { [c.dataset.set]: c.checked }); App.toast("Сохранено"); } catch (e) { App.fail(e); c.checked = !c.checked; }
      });
      $("#tg-on", el)?.addEventListener("click", async () => {
        try { const r = await App.post("/api/me/telegram"); window.open(r.url, "_blank", "noopener"); App.toast("Нажмите «Start» в боте, затем обновите страницу"); } catch (e) { App.fail(e); }
      });
      $("#tg-off", el)?.addEventListener("click", async () => { await App.del("/api/me/telegram").catch(App.fail); App.rerender(); });
      $("#kill-all", el)?.addEventListener("click", async () => { await App.post("/api/me/sessions/revoke-others").catch(App.fail); App.rerender(); });
      $$("[data-kill]", el).forEach((b) => b.onclick = async () => { await App.del(`/api/me/sessions/${b.dataset.kill}`).catch(App.fail); App.rerender(); });
    },
  };
  function uaName(ua) {
    const b = /YaBrowser/.test(ua) ? "Яндекс.Браузер" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox/.test(ua) ? "Firefox" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Браузер";
    const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? `${b} · ${os}` : b;
  }

  P.password = {
    crumbs: ["Смена пароля"],
    async render(el) {
      el.innerHTML = `<form class="card narrow" id="pw">
        <div class="center mb"><span class="ph-icon">${icon("key")}</span><h2 class="mt8">Смена пароля</h2><p class="muted m0">После смены все другие устройства выйдут из аккаунта</p></div>
        <div class="field"><label>Текущий пароль</label><input class="input" type="password" name="current" autocomplete="current-password" required></div>
        <div class="field"><label>Новый пароль</label><input class="input" type="password" name="password" placeholder="Минимум 8 символов" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label>Повторите пароль</label><input class="input" type="password" name="password2" autocomplete="new-password" required></div>
        <div class="form-error"></div>
        <button class="btn primary block" type="submit">Сохранить пароль</button></form>`;
    },
    mount(el) {
      App.onSubmit($("#pw", el), async (d, form) => {
        if (d.password !== d.password2) throw new Error("Пароли не совпадают");
        await App.post("/api/auth/password", d); form.reset(); App.toast("Пароль изменён");
      });
    },
  };

  // ================= Тарифы =================
  P.billing = {
    feature: "billing",
    crumbs: ["Подписка"],
    async render(el) {
      const d = await App.get("/api/tariffs");
      el.innerHTML = `${App.pageHead("card", "Подписка", "Тарифы и оплата с баланса")}
        <p class="mb">Баланс: <b>${money(d.balance, 2)}</b>${d.until ? ` · текущий тариф действует до <b>${fmtDate(d.until)}</b>` : ""}</p>
        <div class="grid g3">${d.tariffs.map((t) => {
          const cur = t.id === d.current;
          return `<div class="card ${cur ? "accent" : ""}">${App.badge(t.name)}
            <h2 class="mono mt8">${t.price ? money(t.price) : "Бесплатно"}</h2>${t.price ? `<p class="hint m0">за ${t.period_days} дн.</p>` : ""}
            <p class="muted">${nl2br(t.description)}</p>${t.rate !== 100 ? `<p class="small">Ставка: ${t.rate}% от базовой</p>` : ""}
            <button class="btn block ${cur ? "" : "primary"}" data-buy="${t.id}" data-name="${esc(t.name)}" data-price="${t.price}" ${cur && !t.price ? "disabled" : ""}>
              ${cur ? (t.price ? "Продлить" : "Текущий тариф") : "Выбрать"}</button></div>`;
        }).join("")}</div>`;
    },
    mount(el) {
      $$("[data-buy]", el).forEach((b) => b.onclick = async () => {
        const price = +b.dataset.price;
        if (price && !(await App.confirm(`Оплатить тариф ${b.dataset.name} за ${money(price)} с баланса?`, "Оплатить"))) return;
        try { await App.post(`/api/tariffs/${b.dataset.buy}/buy`); App.toast("Тариф активирован"); await App.reloadMe(); App.rerender(); }
        catch (e) { App.fail(e); }
      });
    },
  };
})();
