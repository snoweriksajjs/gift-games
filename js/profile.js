// Профиль как в Telegram: галочка, подарки вокруг аватарки, истории (кружок 24 часа и архив),
// музыка в профиле, свой канал и несколько юзернеймов. Данные хранит сервер (server/profiles.py).
(() => {
  "use strict";
  const A = window.App, { $, esc, fmt, STAR } = A;

  // ---------- галочки: свои дизайны разных цветов и форм ----------
  const CHECKS = {
    classic: { name: "Классика", shape: "rosette", c1: "#4fb2ff", c2: "#1c6fe6", tick: "#fff" },
    mint: { name: "Мята", shape: "circle", c1: "#5ff0b6", c2: "#0fa56b", tick: "#fff" },
    violet: { name: "Аметист", shape: "hex", c1: "#c4a2ff", c2: "#7444f5", tick: "#fff" },
    gold: { name: "Золото", shape: "star", c1: "#ffe27a", c2: "#f09a12", tick: "#5b3700" },
    rose: { name: "Роза", shape: "diamond", c1: "#ff9cc8", c2: "#e23d7a", tick: "#fff" },
    fire: { name: "Огонь", shape: "rosette", c1: "#ffc043", c2: "#ff3b3b", tick: "#fff" },
    ice: { name: "Лёд", shape: "shield", c1: "#b4f6ff", c2: "#2f9fe6", tick: "#063b57" },
    dark: { name: "Ночь", shape: "rosette", c1: "#4a4a52", c2: "#0d0d10", tick: "#ffd75a" },
  };
  const poly = (n, r1, r2, rot = -Math.PI / 2) => {
    let d = "";
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n;
      d += (i ? "L" : "M") + (12 + Math.cos(a) * r).toFixed(2) + " " + (12 + Math.sin(a) * r).toFixed(2);
    }
    return d + "Z";
  };
  // розетка с мягкими зубцами
  const rosette = () => {
    const n = 10; let d = "";
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
      const p = (a, r) => (12 + Math.cos(a) * r).toFixed(2) + " " + (12 + Math.sin(a) * r).toFixed(2);
      d += (i ? "" : "M" + p(a0, 9.6)) + "Q" + p(a1, 12.6) + " " + p(a2, 9.6);
    }
    return d + "Z";
  };
  const SHAPES = {
    rosette: rosette(),
    circle: "M12 1.6a10.4 10.4 0 1 0 0 20.8a10.4 10.4 0 1 0 0-20.8z",
    hex: poly(3, 11.2, 11.2, -Math.PI / 2),
    star: poly(8, 11.8, 9.1),
    diamond: "M12 1.2 L22.8 12 L12 22.8 L1.2 12 Z",
    shield: "M12 1.4 L20.8 4.6 V11.2 C20.8 16.6 17.2 20.4 12 22.6 C6.8 20.4 3.2 16.6 3.2 11.2 V4.6 Z",
  };
  let gid = 0;
  A.check = (style, cls = "") => {
    const c = CHECKS[style] || CHECKS.classic, id = "ck" + ++gid;
    return `<svg class="vcheck ${cls}" viewBox="0 0 24 24" aria-label="Подтверждённый аккаунт"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.c1}"/><stop offset="1" stop-color="${c.c2}"/></linearGradient></defs>
      <path d="${SHAPES[c.shape]}" fill="url(#${id})"/><path d="M7.6 12.4l3 3 5.9-6.3" fill="none" stroke="${c.tick}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };
  A.verMark = (u) => (u && u.verified ? A.check(u.check) : "");
  A.CHECKS = CHECKS;

  // ---------- истории: просмотренные помним на устройстве ----------
  const seen = new Set((() => { try { return JSON.parse(localStorage.getItem("dc_seen_stories") || "[]"); } catch { return []; } })());
  const markSeen = (id) => { seen.add(id); try { localStorage.setItem("dc_seen_stories", JSON.stringify([...seen].slice(-500))); } catch {} };
  A.storyRing = (u) => (u && u.story ? (seen.has(u.story) ? "st-ring seen" : "st-ring") : "");

  // подарки вокруг аватарки (до 6 штук)
  A.orbitHtml = (ids) => {
    ids = (ids || []).filter((g) => A.byId[g]).slice(0, 6);
    if (!ids.length) return "";
    const n = ids.length;
    return `<span class="orbit">${ids.map((g, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + (n % 2 ? 0 : Math.PI / n);
      return `<img src="${A.byId[g].img}" alt="" style="left:${(50 + Math.cos(a) * 62).toFixed(1)}%;top:${(50 + Math.sin(a) * 58).toFixed(1)}%;animation-delay:${(i * 0.4).toFixed(1)}s">`;
    }).join("")}</span>`;
  };
  // аватарка профиля: кружок истории и подарки вокруг. Нажатие открывает истории
  A.profileAva = (u, avaHtml) => `<button class="pr-ava ${A.storyRing(u)}" data-stories="${u.id}" aria-label="Истории">${avaHtml}${A.orbitHtml(u.orbit)}</button>`;

  // ---------- музыка в профиле ----------
  const audio = new Audio();
  audio.preload = "none";
  let playing = "";
  audio.addEventListener("ended", () => { playing = ""; paintMusic(); });
  function paintMusic() { document.querySelectorAll("[data-music]").forEach((b) => b.classList.toggle("on", b.dataset.music === playing && !audio.paused)); }
  A.toggleMusic = (url) => {
    if (playing === url && !audio.paused) { audio.pause(); return paintMusic(); }
    if (playing !== url) { audio.src = url; playing = url; }
    audio.play().then(paintMusic, () => A.toast("Не получилось включить музыку"));
    paintMusic();
  };
  A.musicHtml = (m) => (m ? `<button class="pr-music ${playing === m.url && !audio.paused ? "on" : ""}" data-music="${esc(m.url)}"><i class="pm-ic"></i><span>${esc(m.title)}</span><b class="pm-eq"><i></i><i></i><i></i></b></button>` : "");

  // блок под шапкой профиля: канал, юзернеймы, галочка
  A.profileInfo = (u) => {
    const tags = u.tags || [];
    return `${u.channel ? `<button class="pr-channel" data-chan="${u.channel.id}">
        <span class="ava sm2 tint" style="--h:${(u.channel.id * 47) % 360};${u.channel.photo ? `background-image:url('${esc(u.channel.photo)}')` : ""}">${u.channel.photo ? "" : esc(u.channel.title.charAt(0))}</span>
        <span class="grow"><b>${esc(u.channel.title)}</b><span>Канал</span></span><i class="pr-subs">${fmt(u.channel.members)} ${plural(u.channel.members)}</i></button>` : ""}
      ${u.handle || tags.length ? `<div class="pr-tags">${u.handle ? `<button class="pr-tag main" data-copy="@${esc(u.handle)}">@${esc(u.handle)}</button>` : ""}
        ${tags.length ? `<span>${u.handle ? "а также " : ""}${tags.map((t) => `<button class="pr-tag" data-copy="@${esc(t)}">@${esc(t)}</button>`).join(", ")}</span>` : ""}</div>` : ""}
      ${u.verified ? `<p class="pr-verified">${A.check(u.check)} Аккаунт верифицирован организацией DuckChance.</p>` : ""}`;
  };
  const plural = (n) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? "подписчик" : m >= 2 && m <= 4 && (h < 12 || h > 14) ? "подписчика" : "подписчиков"; };

  // клики по профилю: музыка, канал, юзернейм, истории
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-music]"); if (m) { e.stopPropagation(); return A.toggleMusic(m.dataset.music); }
    const c = e.target.closest("[data-chan]"); if (c && A.openChat) { e.stopPropagation(); return A.openChat(Number(c.dataset.chan)); }
    const t = e.target.closest(".pr-tag[data-copy]");
    if (t) { e.stopPropagation(); try { navigator.clipboard.writeText(t.dataset.copy); } catch {} return A.toast("Скопировано: " + t.dataset.copy); }
    const s = e.target.closest("[data-stories]"); if (s) { e.stopPropagation(); return openStories(Number(s.dataset.stories)); }
    const g = e.target.closest("[data-story-at]"); if (g) { e.stopPropagation(); return openStories(Number(g.dataset.storyUser), Number(g.dataset.storyAt), true); }
  }, true);

  // ---------- просмотр историй ----------
  let view = null, list = [], at = 0, timer = 0, owner = null;
  function build() {
    view = document.createElement("div");
    view.className = "story-view"; view.hidden = true;
    view.innerHTML = `<div class="sv-bars"></div><div class="sv-head"><span class="sv-who"></span><button class="sv-del" hidden>Удалить</button><button class="sv-x" aria-label="Закрыть">×</button></div>
      <div class="sv-media"></div><p class="sv-cap"></p><button class="sv-prev" aria-label="Назад"></button><button class="sv-next" aria-label="Дальше"></button>`;
    document.body.appendChild(view);
    view.querySelector(".sv-x").onclick = close;
    view.querySelector(".sv-prev").onclick = () => show(at - 1);
    view.querySelector(".sv-next").onclick = () => show(at + 1);
    view.querySelector(".sv-del").onclick = async () => {
      const s = list[at];
      if (!s || !confirm("Удалить историю?")) return;
      try { await A.api("POST", `/api/story/${s.id}/delete`, {}); list.splice(at, 1); if (A.refreshMe) A.refreshMe(); if (!list.length) return close(); show(Math.min(at, list.length - 1)); } catch { A.toast("Не получилось удалить"); }
    };
  }
  async function openStories(uid, index, archive) {
    if (!A.api) return;
    let r;
    try { r = await A.api("GET", `/api/stories/${uid}`); } catch { return A.toast("Не получилось загрузить истории"); }
    // по аватарке: сначала свежие (за 24 часа), если их нет, то весь архив
    const fresh = r.stories.filter((s) => s.active);
    list = (archive || !fresh.length ? r.stories : fresh).slice().reverse();
    if (!list.length) return A.toast("Историй пока нет");
    owner = r.user;
    if (!view) build();
    view.hidden = false; document.body.style.overflow = "hidden";
    const start = archive && index != null ? list.findIndex((s) => s.id === index) : list.findIndex((s) => !seen.has(s.id));
    show(Math.max(0, start));
  }
  function close() {
    clearTimeout(timer); if (!view) return;
    const v = view.querySelector("video"); if (v) v.pause();
    view.hidden = true; document.body.style.overflow = "";
    if (A.repaintStories) A.repaintStories();
  }
  function show(i) {
    clearTimeout(timer);
    if (i < 0) i = 0;
    if (i >= list.length) return close();
    at = i;
    const s = list[i], mine = owner && owner.id === A.myId;
    view.querySelector(".sv-bars").innerHTML = list.map((_, k) => `<i class="${k < i ? "done" : k === i ? "now" : ""}"><b></b></i>`).join("");
    const ago = Math.max(1, Math.round((Date.now() / 1000 - s.created) / 3600));
    view.querySelector(".sv-who").innerHTML = `<b>${esc(owner.name)}</b>${A.verMark(owner)}<span>${s.active ? `${ago} ч назад` : new Date(s.created * 1000).toLocaleDateString("ru-RU")}${mine && s.views != null ? ` · ${fmt(s.views)} просм.` : ""}</span>`;
    view.querySelector(".sv-del").hidden = !mine;
    view.querySelector(".sv-cap").textContent = s.caption || "";
    const box = view.querySelector(".sv-media");
    const dur = (ms) => { const b = view.querySelector(".sv-bars .now b"); if (b) { b.style.animationDuration = ms + "ms"; } timer = setTimeout(() => show(at + 1), ms); };
    if (s.kind === "video") {
      box.innerHTML = `<video src="${esc(s.url)}" playsinline autoplay></video>`;
      const v = box.querySelector("video");
      v.onloadedmetadata = () => dur(Math.min(60000, (v.duration || 10) * 1000));
      v.onerror = () => dur(3000);
    } else {
      box.innerHTML = `<img src="${esc(s.url)}" alt="">`;
      dur(5000);
    }
    if (!mine) A.api("POST", `/api/story/${s.id}/view`, {}).catch(() => {});
    markSeen(s.id);
  }
  A.openStories = openStories;

  // архив историй в профиле (сетка)
  A.storiesGrid = async (uid, el) => {
    try {
      const r = await A.api("GET", `/api/stories/${uid}`);
      el.innerHTML = r.stories.length ? `<div class="pr-stories">${r.stories.map((s) => `<button class="pr-st" data-story-at="${s.id}" data-story-user="${uid}">
          ${s.kind === "video" ? `<video src="${esc(s.url)}#t=0.1" muted playsinline preload="metadata"></video><i class="pr-play"></i>` : `<img src="${esc(s.url)}" alt="" loading="lazy">`}
          ${s.active ? `<em>24 ч</em>` : ""}</button>`).join("")}</div>` : `<p class="pn-note">Историй пока нет</p>`;
    } catch { el.innerHTML = `<p class="pn-note">Не получилось загрузить истории</p>`; }
  };

  // ---------- загрузка файлов: фото сжимаем на устройстве, музыку и видео отправляем как есть ----------
  function pick(accept) {
    return new Promise((res) => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept;
      inp.onchange = () => res(inp.files && inp.files[0]);
      inp.click();
    });
  }
  async function toJpeg(file, max = 1600) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.86));
    } finally { URL.revokeObjectURL(url); }
  }
  A.addStory = async () => {
    const f = await pick("image/*,video/*");
    if (!f) return;
    if (f.size > 15e6 && !f.type.startsWith("image/")) return A.toast("Видео больше 15 МБ: выберите покороче");
    A.toast("Загружаем историю…");
    try {
      const blob = f.type.startsWith("image/") ? await toJpeg(f) : f;
      const { url } = await A.rawUpload(blob, "story");
      await A.api("POST", "/api/stories", { url });
      A.hap.win(); A.toast("История опубликована на 24 часа");
      if (A.refreshMe) A.refreshMe();
    } catch (e) { A.toast(e && e.status === 415 ? "Этот формат не подходит: фото JPG/PNG или видео MP4" : "Не получилось загрузить историю"); }
  };

  // ---------- редактор своего профиля ----------
  let ed = null;
  async function openEditor() {
    if (!A.api || !A.apiReady || !A.apiReady()) return A.toast("Редактирование профиля работает внутри Telegram");
    let me, chans = [];
    try { me = await A.api("GET", `/api/user/${A.myId}`); chans = ((await A.api("GET", "/api/chats")).chats || []).filter((c) => c.kind === "channel" && c.role === "owner"); }
    catch { return A.toast("Нет связи с сервером"); }
    if (!ed) {
      ed = document.createElement("section");
      ed.className = "sheet tall"; ed.id = "profSheet"; ed.hidden = true;
      ed.setAttribute("role", "dialog"); ed.setAttribute("aria-label", "Профиль");
      ed.innerHTML = `<div class="grab"></div><header class="sheet-head"><h3>Профиль</h3><button class="sheet-x" data-close>Готово</button></header><div class="sheet-body" id="peBody"></div>`;
      document.body.appendChild(ed);
      if (A.bindSheet) A.bindSheet(ed);
    }
    const st = A.state();
    const gifts = [...new Set(st.inv.map((it) => it.id))].filter((g) => A.byId[g]).sort((a, b) => A.byId[b].price - A.byId[a].price).slice(0, 60);
    let orbit = [...(me.orbit || [])];
    const tagsCount = (me.handle ? 1 : 0) + (me.tags || []).length;
    const paint = () => {
      $("#peBody").innerHTML = `
        <h4 class="sec-title">Галочка</h4>
        ${me.verified ? `<div class="pe-checks">${Object.entries(CHECKS).map(([k, c]) => `<button class="pe-check ${me.check === k ? "on" : ""}" data-check="${k}">${A.check(k)}<span>${c.name}</span></button>`).join("")}</div>
          <p class="pn-note">Рядом с именем и в профиле: «Аккаунт верифицирован организацией DuckChance».</p>`
          : `<button class="cta inline" data-buy-check>Купить галочку за ${STAR}100</button><p class="pn-note">Галочка рядом с именем и надпись «Аккаунт верифицирован организацией DuckChance». Дизайн можно выбрать после покупки.</p>`}
        <h4 class="sec-title">Юзернеймы · ${tagsCount} из 10</h4>
        <section class="list">
          ${me.handle ? `<div class="row"><span class="grow"><b>@${esc(me.handle)}</b> <i class="hint">основной</i></span></div>` : ""}
          ${(me.tags || []).map((t) => `<div class="row"><span class="grow">@${esc(t)}</span><button class="mini-btn ghost" data-tag-main="${esc(t)}">Основной</button><button class="mini-btn ghost" data-tag-del="${esc(t)}">×</button></div>`).join("")}
        </section>
        ${tagsCount < 10 ? `<div class="pe-add"><input id="peTag" placeholder="${me.handle ? "ещё один юзернейм" : "юзернейм"}" maxlength="32" autocapitalize="off" autocomplete="off" spellcheck="false"><button class="mini-btn" data-tag-add>${me.handle ? `Купить за ${STAR}50` : "Занять"}</button></div>
          <p class="pn-note">Латиница, цифры и _, от 5 символов. Первый юзернейм бесплатно, каждый следующий 50 звёзд. Брать можно только свободные.</p>` : ""}
        <h4 class="sec-title">Музыка в профиле</h4>
        ${me.music ? `${A.musicHtml(me.music)}<div class="pe-row"><button class="mini-btn ghost" data-music-pick>Заменить</button><button class="mini-btn ghost" data-music-del>Убрать</button></div>`
          : `<button class="cta inline second" data-music-pick>Выбрать аудиофайл</button>`}
        <p class="pn-note">MP3, M4A, OGG или WAV до 15 МБ. Её смогут включить все, кто откроет ваш профиль.</p>
        <h4 class="sec-title">Канал в профиле</h4>
        ${chans.length ? `<section class="list">${[{ id: 0, title: "Не показывать" }, ...chans].map((c) => `<button class="row pn-row ${(me.channel ? me.channel.id : 0) === c.id ? "sel" : ""}" data-set-chan="${c.id}"><span class="grow">${esc(c.title)}</span>${(me.channel ? me.channel.id : 0) === c.id ? "✓" : ""}</button>`).join("")}</section>`
          : `<p class="pn-note">Создайте свой канал во вкладке «Чаты», и его можно будет показать в профиле.</p>`}
        <h4 class="sec-title">Подарки вокруг аватарки · ${orbit.length} из 6</h4>
        ${gifts.length ? `<div class="pe-gifts">${gifts.map((g) => `<button class="pe-gift ${orbit.includes(g) ? "on" : ""}" data-orbit="${g}" style="${A.bg(A.byId[g])}"><i class="pat"></i>${A.pic(A.byId[g])}</button>`).join("")}</div>
          <button class="cta inline" data-orbit-save>Сохранить подарки</button>` : `<p class="pn-note">Выиграйте подарки, и их можно будет поставить вокруг аватарки.</p>`}
        <h4 class="sec-title">Истории</h4>
        <button class="cta inline second" data-story-add>Добавить историю</button>
        <p class="pn-note">Фото или видео. 24 часа видна кружком на аватарке, потом остаётся в профиле в разделе «Истории».</p>`;
    };
    const save = async (body) => { try { const r = await A.api("POST", "/api/profile", body); me = r.me; paint(); if (A.refreshMe) A.refreshMe(); return true; } catch (e) { A.toast(e && e.message === "not verified" ? "Сначала купите галочку" : "Не получилось сохранить"); return false; } };
    $("#peBody").onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.check) return save({ check: b.dataset.check });
      if (b.hasAttribute("data-buy-check")) {
        if (!confirm("Купить галочку за 100 звёзд?")) return;
        try { const r = await A.api("POST", "/api/verify/buy", {}); me = r.me; if (r.state) A.applyServer(r.state); A.hap.win(); A.toast("Галочка ваша, выберите дизайн"); paint(); if (A.refreshMe) A.refreshMe(); }
        catch (er) { A.toast(er && er.message === "not enough stars" ? "Не хватает звёзд" : "Не получилось купить"); }
        return;
      }
      if (b.hasAttribute("data-tag-add")) {
        const tag = ($("#peTag").value || "").trim().replace(/^@/, "");
        if (!tag) return A.toast("Введите юзернейм");
        try {
          if (!me.handle) { const r = await A.api("POST", "/api/handle", { handle: tag }); me = { ...me, ...r.me }; }
          else { if (!confirm(`Купить @${tag} за 50 звёзд?`)) return; const r = await A.api("POST", "/api/tags/add", { tag }); me = r.me; if (r.state) A.applyServer(r.state); }
          A.hap.win(); paint(); if (A.refreshMe) A.refreshMe();
        } catch (er) {
          A.toast(er && er.message === "taken" ? "Этот юзернейм уже занят" : er && (er.message === "bad tag" || er.message === "short") ? "От 5 символов: латиница, цифры и _" : er && er.message === "max tags" ? "Не больше 10 юзернеймов" : er && er.message === "not enough stars" ? "Не хватает звёзд" : "Не получилось");
        }
        return;
      }
      if (b.dataset.tagDel) { if (!confirm(`Освободить @${b.dataset.tagDel}? Звёзды не вернутся.`)) return; try { me = (await A.api("POST", "/api/tags/remove", { tag: b.dataset.tagDel })).me; paint(); if (A.refreshMe) A.refreshMe(); } catch { A.toast("Не получилось"); } return; }
      if (b.dataset.tagMain) { try { me = (await A.api("POST", "/api/tags/main", { tag: b.dataset.tagMain })).me; paint(); if (A.refreshMe) A.refreshMe(); } catch { A.toast("Не получилось"); } return; }
      if (b.hasAttribute("data-music-pick")) {
        const f = await pick("audio/*,.mp3,.m4a,.ogg,.wav");
        if (!f) return;
        if (f.size > 15e6) return A.toast("Файл больше 15 МБ");
        A.toast("Загружаем музыку…");
        try {
          const { url } = await A.rawUpload(f, "audio");
          const title = (prompt("Название трека", f.name.replace(/\.[a-z0-9]+$/i, "")) || f.name).slice(0, 64);
          if (await save({ music: { url, title } })) A.toast("Музыка в профиле");
        } catch (er) { A.toast(er && er.status === 415 ? "Это не аудиофайл: нужен MP3, M4A, OGG или WAV" : "Не получилось загрузить"); }
        return;
      }
      if (b.hasAttribute("data-music-del")) return save({ music: null });
      if (b.dataset.setChan != null) return save({ channel: Number(b.dataset.setChan) });
      if (b.dataset.orbit) {
        const g = b.dataset.orbit, i = orbit.indexOf(g);
        if (i >= 0) orbit.splice(i, 1); else if (orbit.length < 6) orbit.push(g); else return A.toast("Не больше 6 подарков");
        b.classList.toggle("on", orbit.includes(g)); A.hap.select();
        const h = b.closest(".sheet-body").querySelectorAll(".sec-title")[4]; if (h) h.textContent = `Подарки вокруг аватарки · ${orbit.length} из 6`;
        return;
      }
      if (b.hasAttribute("data-orbit-save")) { if (await save({ orbit })) A.toast("Подарки вокруг аватарки сохранены"); return; }
      if (b.hasAttribute("data-story-add")) return A.addStory();
    };
    paint();
    A.openSheet(ed);
  }
  A.openProfileEditor = openEditor;

  // ---------- свой профиль на вкладке «Профиль» ----------
  let meCard = null, meAt = 0;
  async function loadMe(force) {
    if (!A.api || !A.apiReady || !A.apiReady() || !A.myId) return null;
    if (!force && meCard && Date.now() - meAt < 20000) return meCard;
    try { meCard = await A.api("GET", `/api/user/${A.myId}`); meAt = Date.now(); } catch {}
    return meCard;
  }
  function paint(u) {
    const banner = $("#pfBanner"), rich = $("#pfRich");
    if (!banner || !rich || !u) return;
    // аватарка в обёртке: кружок истории и подарки вокруг
    let wrap = banner.querySelector(".pr-ava");
    const av = banner.querySelector(".ava.xl");
    if (!wrap && av) { wrap = document.createElement("button"); wrap.className = "pr-ava"; av.replaceWith(wrap); wrap.appendChild(av); }
    if (wrap) {
      wrap.className = `pr-ava ${A.storyRing(u)}`; wrap.dataset.stories = u.id;
      const o = wrap.querySelector(".orbit"); if (o) o.remove();
      wrap.insertAdjacentHTML("beforeend", A.orbitHtml(u.orbit));
    }
    let ck = banner.querySelector("#pfCheck");
    if (!ck) { ck = document.createElement("span"); ck.id = "pfCheck"; banner.querySelector("h1").appendChild(ck); }
    ck.innerHTML = A.verMark(u);
    rich.hidden = false;
    rich.innerHTML = `${A.musicHtml(u.music)}${A.profileInfo(u)}
      <div class="pr-acts"><button class="cta inline second" data-pe>Изменить профиль</button><button class="cta inline second" data-st-add>+ История</button></div>
      ${u.stories ? `<div class="pf-head"><h2>Истории</h2><span>${u.stories}</span></div><div id="pfStories"></div>` : ""}`;
    rich.querySelector("[data-pe]").onclick = () => openEditor();
    rich.querySelector("[data-st-add]").onclick = () => A.addStory();
    const sg = rich.querySelector("#pfStories"); if (sg) A.storiesGrid(u.id, sg);
  }
  A.paintMyProfile = async () => { if (meCard) paint(meCard); paint(await loadMe()); };
  A.refreshMe = async () => { paint(await loadMe(true)); };
  A.repaintStories = () => { if (meCard) paint(meCard); document.querySelectorAll(".pr-ava[data-stories]").forEach((w) => { if (w.dataset.ring) w.className = "pr-ava " + w.dataset.ring; }); };
})();
