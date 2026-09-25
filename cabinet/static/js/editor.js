/* Визуальный редактор текста уроков и статей: пишешь прямо в поле, оформляешь кнопками на панели.
   Заголовки, жирный/курсив, списки, цитаты, ссылки, картинки (кнопкой, Ctrl+V, перетаскиванием), видео.
   На выходе — HTML; сервер дополнительно чистит его по белому списку (backend/richtext.py). */
(() => {
  const { $, $$, esc, icon } = App;

  // ---------- вставка из буфера: оставляем текст и простое оформление, чужие стили и мусор убираем ----------
  const KEEP = new Set(["P", "BR", "H2", "H3", "H4", "B", "I", "U", "S", "UL", "OL", "LI", "BLOCKQUOTE", "A", "IMG", "HR", "PRE", "CODE"]);
  const MAP = { STRONG: "B", EM: "I", STRIKE: "S", DEL: "S", H1: "H2", H5: "H4", H6: "H4", DIV: "P" };
  const DROP = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME",
    "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "VIDEO", "AUDIO", "CANVAS"]);

  function cleanNodes(node) {
    const frag = document.createDocumentFragment();
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 3) { frag.appendChild(document.createTextNode(ch.nodeValue)); continue; }
      if (ch.nodeType !== 1 || DROP.has(ch.tagName)) continue;
      const st = (ch.getAttribute("style") || "").toLowerCase();
      const inner = cleanNodes(ch);
      // Жирный/курсив, заданный через style, сохраняем тегами
      if (ch.tagName === "SPAN" || (ch.tagName === "B" && /font-weight:\s*(normal|[1-4]00)/.test(st))) {
        let out = inner;
        const flags = [[/font-weight:\s*(bold|[6-9]00)/, "b"], [/font-style:\s*italic/, "i"],
          [/text-decoration[^;]*underline/, "u"], [/text-decoration[^;]*line-through/, "s"]];
        for (const [re, t] of flags) if (re.test(st)) { const e = document.createElement(t); e.appendChild(out); out = e; }
        frag.appendChild(out);
        continue;
      }
      const tag = MAP[ch.tagName] || ch.tagName;
      if (!KEEP.has(tag)) { frag.appendChild(inner); continue; }
      const el = document.createElement(tag);
      if (tag === "A") {
        const href = ch.getAttribute("href") || "";
        if (!/^(https?:|mailto:|tel:)/i.test(href)) { frag.appendChild(inner); continue; }
        el.setAttribute("href", href);
      }
      if (tag === "IMG") {
        const src = ch.getAttribute("src") || "";
        if (!/^https?:\/\//i.test(src) && !/^media\/u\//.test(src)) continue;
        el.setAttribute("src", src);
        el.setAttribute("alt", ch.getAttribute("alt") || "");
        frag.appendChild(el);
        continue;
      }
      el.appendChild(inner);
      frag.appendChild(el);
    }
    return frag;
  }
  const cleanHtml = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html"); // документ «инертный»: ничего не выполняется и не грузится
    const box = document.createElement("div");
    box.appendChild(cleanNodes(doc.body));
    return box.innerHTML;
  };
  const textToHtml = (text) => text.split(/\r?\n\s*\r?\n/).map((p) => `<p>${esc(p).replace(/\r?\n/g, "<br>")}</p>`).join("");

  // ---------- маленькое окно с одним полем (ссылка, видео) ----------
  const ask = (title, label, placeholder, value = "") => new Promise((resolve) => {
    let result = null;
    App.modal(title, `<form id="rte-ask"><div class="field"><label>${esc(label)}</label>
        <input class="input" name="v" type="url" placeholder="${esc(placeholder)}" value="${esc(value)}" required></div>
      <div class="form-error"></div>
      <div class="row"><button class="btn primary" type="submit">Вставить</button><button type="button" class="btn" data-close>Отмена</button></div></form>`,
    (m, close) => App.onSubmit($("#rte-ask", m), async (d) => { result = d.v.trim(); close(); }),
    { onClose: () => resolve(result) });
  });

  const BLOCKS = [["p", "Обычный текст"], ["h2", "Заголовок"], ["h3", "Подзаголовок"], ["h4", "Малый заголовок"]];
  // Быстрое оформление в начале строки, как в Teletype
  const SHORTCUTS = { "#": "H2", "##": "H3", "###": "H4", "-": "UL", "*": "UL", "1.": "OL", ">": "BLOCKQUOTE" };

  /**
   * Создаёт редактор внутри box. Возвращает { getHTML, focus }.
   * Картинки грузятся в /api/admin/uploads и вставляются как <img src="media/u/...">.
   */
  App.richEditor = (box, initial = "") => {
    box.classList.add("rte");
    box.innerHTML = `<div class="rte-bar">
        <button type="button" data-cmd="undo" title="Отменить (Ctrl+Z)">${icon("undo")}</button>
        <button type="button" data-cmd="redo" title="Повторить (Ctrl+Y)">${icon("redo")}</button><span class="sep"></span>
        <select data-block title="Стиль абзаца">${BLOCKS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <button type="button" data-cmd="bold" title="Жирный (Ctrl+B)">${icon("bold")}</button>
        <button type="button" data-cmd="italic" title="Курсив (Ctrl+I)">${icon("italic")}</button>
        <button type="button" data-cmd="underline" title="Подчёркнутый (Ctrl+U)">${icon("underline")}</button>
        <button type="button" data-cmd="strikeThrough" title="Зачёркнутый">${icon("strike")}</button><span class="sep"></span>
        <button type="button" data-cmd="insertUnorderedList" title="Маркированный список (или «- » в начале строки)">${icon("ul")}</button>
        <button type="button" data-cmd="insertOrderedList" title="Нумерованный список (или «1. » в начале строки)">${icon("ol")}</button>
        <button type="button" data-act="quote" title="Цитата (или «> » в начале строки)">${icon("quote")}</button><span class="sep"></span>
        <button type="button" data-act="link" title="Ссылка (Ctrl+K)">${icon("link")}</button>
        <button type="button" data-act="image" title="Картинка — можно вставить из буфера или перетащить">${icon("image")}</button>
        <button type="button" data-act="video" title="Видео по ссылке (YouTube, RuTube, VK Видео…)">${icon("video")}</button>
        <button type="button" data-act="hr" title="Разделитель">${icon("hr")}</button><span class="sep"></span>
        <button type="button" data-act="clear" title="Очистить оформление">${icon("clear")}</button>
      </div>
      <div class="rte-area prose" contenteditable="true" data-placeholder="Начните писать… «# » — заголовок, «- » — список, картинку можно просто вставить (Ctrl+V)"></div>
      <div class="rte-foot"><span data-status></span><span class="spacer"></span><span>Картинки: кнопка, Ctrl+V или перетаскивание</span></div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-file hidden multiple>`;
    const area = $(".rte-area", box), bar = $(".rte-bar", box), status = $("[data-status]", box), fileInput = $("[data-file]", box);
    area.innerHTML = initial ? App.rich(initial) : "<p><br></p>";
    const prepare = () => $$("figure.embed", area).forEach((f) => f.setAttribute("contenteditable", "false"));
    prepare();

    const exec = (cmd, val = null) => { area.focus(); document.execCommand(cmd, false, val); update(); };
    let saved = null;
    const inArea = (node) => node && area.contains(node);
    const saveSel = () => {
      const sel = document.getSelection();
      if (sel.rangeCount && inArea(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange();
    };
    const restoreSel = () => {
      area.focus();
      if (!saved) return;
      const sel = document.getSelection();
      sel.removeAllRanges(); sel.addRange(saved);
    };
    const insert = (html) => { restoreSel(); document.execCommand("insertHTML", false, html); prepare(); saveSel(); update(); };

    const blank = () => !area.textContent.trim() && !$("img, iframe, hr", area);
    function update() {
      area.classList.toggle("blank", blank());
      const sel = document.getSelection();
      if (!sel.rangeCount || !inArea(sel.anchorNode)) return;
      $$("[data-cmd]", bar).forEach((b) => {
        if (["undo", "redo"].includes(b.dataset.cmd)) return;
        try { b.classList.toggle("on", document.queryCommandState(b.dataset.cmd)); } catch { /* ignore */ }
      });
      const block = (document.queryCommandValue("formatBlock") || "p").toLowerCase();
      $("[data-block]", bar).value = BLOCKS.some(([v]) => v === block) ? block : "p";
      $('[data-act="quote"]', bar).classList.toggle("on", !!closest(sel.anchorNode, "BLOCKQUOTE"));
    }
    const closest = (node, tag) => {
      for (let n = node; n && n !== area; n = n.parentNode) if (n.nodeName === tag) return n;
      return null;
    };

    // ---------- картинки ----------
    const setStatus = (t) => { status.textContent = t; status.className = t ? "rte-uploading" : ""; };
    async function uploadFiles(files) {
      const imgs = [...files].filter((f) => f.type.startsWith("image/"));
      for (const f of imgs) {
        setStatus(`Загружаю «${f.name || "картинку"}»…`);
        try {
          const fd = new FormData(); fd.append("file", f);
          const r = await App.api("POST", "api/admin/uploads", undefined, { form: fd });
          insert(`<img src="${esc(r.url)}" alt="">`);
        } catch (e) { App.fail(e); }
      }
      setStatus("");
    }
    // Вставленные картинки со сторонних сайтов сохраняем у себя: чужие ссылки со временем перестают работать
    async function importExternal() {
      for (const img of $$("img", area)) {
        const src = img.getAttribute("src") || "";
        if (!/^https?:\/\//i.test(src) || img.dataset.tried) continue;
        img.dataset.tried = "1";
        setStatus("Сохраняю картинки…");
        try { const r = await App.post("api/admin/uploads", { url: src }); img.setAttribute("src", r.url); }
        catch { /* останется внешняя ссылка */ }
      }
      setStatus("");
    }

    // ---------- панель ----------
    bar.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); }); // не терять выделение
    $$("[data-cmd]", bar).forEach((b) => b.onclick = () => exec(b.dataset.cmd));
    $("[data-block]", bar).onchange = (e) => { restoreSel(); exec("formatBlock", `<${e.target.value}>`); };
    const actions = {
      quote: () => exec("formatBlock", closest(document.getSelection().anchorNode, "BLOCKQUOTE") ? "<p>" : "<blockquote>"),
      link: async () => {
        saveSel();
        const url = await ask("Ссылка", "Адрес ссылки", "https://");
        if (!url) return restoreSel();
        const href = /^(https?:|mailto:|tel:)/i.test(url) ? url : "https://" + url;
        restoreSel();
        if (document.getSelection().isCollapsed) insert(`<a href="${esc(href)}">${esc(url)}</a>&nbsp;`);
        else exec("createLink", href);
      },
      image: () => { saveSel(); fileInput.click(); },
      video: async () => {
        saveSel();
        const url = await ask("Видео", "Ссылка на видео (YouTube, RuTube, VK Видео, Vimeo, Дзен)", "https://");
        if (!url) return restoreSel();
        try { const r = await App.post("api/admin/embed", { url }); insert(`<figure class="embed"><iframe src="${esc(r.src)}"></iframe></figure><p><br></p>`); }
        catch (e) { App.fail(e); restoreSel(); }
      },
      hr: () => exec("insertHorizontalRule"),
      clear: () => { exec("removeFormat"); exec("unlink"); exec("formatBlock", "<p>"); },
    };
    $$("[data-act]", bar).forEach((b) => b.onclick = () => actions[b.dataset.act]());
    fileInput.onchange = () => { uploadFiles(fileInput.files); fileInput.value = ""; };

    // ---------- ввод ----------
    area.addEventListener("focus", () => {
      document.execCommand("defaultParagraphSeparator", false, "p");
      document.execCommand("styleWithCSS", false, false);
    });
    const topBlock = (node) => { while (node && node.parentNode !== area) node = node.parentNode; return node?.nodeType === 1 ? node : null; };
    area.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); actions.link(); return; }
      const sel = document.getSelection();
      if (!sel.isCollapsed || !sel.rangeCount) return;
      const block = topBlock(sel.anchorNode);
      if (!block) return;
      // Enter в конце заголовка или цитаты — дальше обычный абзац
      if (e.key === "Enter" && !e.shiftKey && /^(BLOCKQUOTE|H2|H3|H4)$/.test(block.nodeName)) {
        const rest = document.createRange();
        rest.selectNodeContents(block);
        rest.setStart(sel.anchorNode, sel.anchorOffset);
        if (!rest.toString().trim()) {
          e.preventDefault();
          document.execCommand("insertParagraph");
          document.execCommand("formatBlock", false, "<p>");
          update();
        }
        return;
      }
      if (e.key !== " " || !/^(P|DIV)$/.test(block.nodeName)) return;
      // Быстрое оформление, как в Teletype: «# » — заголовок, «- » — список, «> » — цитата
      const pre = document.createRange();
      pre.selectNodeContents(block);
      pre.setEnd(sel.anchorNode, sel.anchorOffset);
      const tag = SHORTCUTS[pre.toString()];
      if (!tag) return;
      e.preventDefault();
      pre.deleteContents(); // стираем маркер, остальной текст абзаца переносим в новый блок
      const el = document.createElement(tag);
      const target = tag === "UL" || tag === "OL" ? el.appendChild(document.createElement("li")) : el;
      while (block.firstChild) target.appendChild(block.firstChild);
      if (!target.textContent) target.innerHTML = "<br>";
      block.replaceWith(el);
      const caret = document.createRange();
      caret.setStart(target, 0); caret.collapse(true);
      sel.removeAllRanges(); sel.addRange(caret);
      saveSel(); update();
    });
    area.addEventListener("paste", (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const files = [...(cd.files || [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); saveSel(); uploadFiles(files); return; }
      const html = cd.getData("text/html"), text = cd.getData("text/plain");
      if (!html && !text) return;
      e.preventDefault();
      saveSel();
      insert(html ? cleanHtml(html) : textToHtml(text));
      importExternal();
    });
    area.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); box.classList.add("drag"); } });
    area.addEventListener("dragleave", () => box.classList.remove("drag"));
    area.addEventListener("drop", (e) => {
      box.classList.remove("drag");
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      // курсор — туда, куда бросили картинку
      const r = document.caretRangeFromPoint?.(e.clientX, e.clientY)
        || (() => { const p = document.caretPositionFromPoint?.(e.clientX, e.clientY); if (!p) return null; const x = document.createRange(); x.setStart(p.offsetNode, p.offset); return x; })();
      if (r && inArea(r.startContainer)) saved = r;
      uploadFiles(e.dataTransfer.files);
    });
    // Клик по картинке или видео выделяет его целиком: Delete / Backspace удалит
    area.addEventListener("click", (e) => {
      $$(".sel", area).forEach((x) => x.classList.remove("sel"));
      const t = e.target.closest("img, figure.embed");
      if (!t || !inArea(t)) return;
      t.classList.add("sel");
      const r = document.createRange(); r.selectNode(t);
      const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    });
    ["keyup", "mouseup", "input"].forEach((ev) => area.addEventListener(ev, () => { saveSel(); update(); }));
    update();

    return {
      focus: () => area.focus(),
      getHTML() {
        if (blank()) return "";
        const copy = area.cloneNode(true);
        $$("[contenteditable], [style]", copy).forEach((x) => { x.removeAttribute("contenteditable"); x.removeAttribute("style"); });
        $$(".sel", copy).forEach((x) => x.classList.remove("sel"));
        $$('[class=""]', copy).forEach((x) => x.removeAttribute("class"));
        $$("img[data-tried]", copy).forEach((x) => x.removeAttribute("data-tried"));
        return copy.innerHTML.trim();
      },
    };
  };
})();
