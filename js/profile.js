// Профиль как в Telegram: галочка, подарки вокруг аватарки, истории (кружок 24 часа и архив),
// музыка в профиле, свой канал и несколько юзернеймов. Данные хранит сервер (server/profiles.py).
(() => {
  "use strict";
  const A = window.App, { $, esc, fmt, STAR } = A;

  // ---------- галочки: формы из открытого набора Tabler Icons (лицензия MIT), разные цвета ----------
  const T = {
    rosette: "M12.01 2.011a3.2 3.2 0 0 1 2.113 .797l.154 .145l.698 .698a1.2 1.2 0 0 0 .71 .341l.135 .008h1a3.2 3.2 0 0 1 3.195 3.018l.005 .182v1c0 .27 .092 .533 .258 .743l.09 .1l.697 .698a3.2 3.2 0 0 1 .147 4.382l-.145 .154l-.698 .698a1.2 1.2 0 0 0 -.341 .71l-.008 .135v1a3.2 3.2 0 0 1 -3.018 3.195l-.182 .005h-1a1.2 1.2 0 0 0 -.743 .258l-.1 .09l-.698 .697a3.2 3.2 0 0 1 -4.382 .147l-.154 -.145l-.698 -.698a1.2 1.2 0 0 0 -.71 -.341l-.135 -.008h-1a3.2 3.2 0 0 1 -3.195 -3.018l-.005 -.182v-1a1.2 1.2 0 0 0 -.258 -.743l-.09 -.1l-.697 -.698a3.2 3.2 0 0 1 -.147 -4.382l.145 -.154l.698 -.698a1.2 1.2 0 0 0 .341 -.71l.008 -.135v-1l.005 -.182a3.2 3.2 0 0 1 3.013 -3.013l.182 -.005h1a1.2 1.2 0 0 0 .743 -.258l.1 -.09l.698 -.697a3.2 3.2 0 0 1 2.269 -.944z",
    circle: "M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336z",
    square: "M12 2c-.218 0 -.432 .002 -.642 .005l-.616 .017l-.299 .013l-.579 .034l-.553 .046c-4.785 .464 -6.732 2.411 -7.196 7.196l-.046 .553l-.034 .579c-.005 .098 -.01 .198 -.013 .299l-.017 .616l-.004 .318l-.001 .324c0 .218 .002 .432 .005 .642l.017 .616l.013 .299l.034 .579l.046 .553c.464 4.785 2.411 6.732 7.196 7.196l.553 .046l.579 .034c.098 .005 .198 .01 .299 .013l.616 .017l.642 .005l.642 -.005l.616 -.017l.299 -.013l.579 -.034l.553 -.046c4.785 -.464 6.732 -2.411 7.196 -7.196l.046 -.553l.034 -.579c.005 -.098 .01 -.198 .013 -.299l.017 -.616l.005 -.642l-.005 -.642l-.017 -.616l-.013 -.299l-.034 -.579l-.046 -.553c-.464 -4.785 -2.411 -6.732 -7.196 -7.196l-.553 -.046l-.579 -.034a28.058 28.058 0 0 0 -.299 -.013l-.616 -.017l-.318 -.004l-.324 -.001z",
    shield: "M11.998 2l.118 .007l.059 .008l.061 .013l.111 .034a.993 .993 0 0 1 .217 .112l.104 .082l.255 .218a11 11 0 0 0 7.189 2.537l.342 -.01a1 1 0 0 1 1.005 .717a13 13 0 0 1 -9.208 16.25a1 1 0 0 1 -.502 0a13 13 0 0 1 -9.209 -16.25a1 1 0 0 1 1.005 -.717a11 11 0 0 0 7.531 -2.527l.263 -.225l.096 -.075a.993 .993 0 0 1 .217 -.112l.112 -.034a.97 .97 0 0 1 .119 -.021l.115 -.007z",
    hex: "M10.425 1.414l-6.775 3.996a3.21 3.21 0 0 0 -1.65 2.807v7.285a3.226 3.226 0 0 0 1.678 2.826l6.695 4.237c1.034 .57 2.22 .57 3.2 .032l6.804 -4.302c.98 -.537 1.623 -1.618 1.623 -2.793v-7.284l-.005 -.204a3.223 3.223 0 0 0 -1.284 -2.39l-.107 -.075l-.007 -.007a1.074 1.074 0 0 0 -.181 -.133l-6.776 -3.995a3.33 3.33 0 0 0 -3.216 0z",
    heart: "M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z",
  };
  const CHECKS = {
    classic: { name: "Классика", shape: "rosette", c1: "#5ab8ff", c2: "#1d6ff0", tick: "#fff" },
    mint: { name: "Мята", shape: "circle", c1: "#62efb8", c2: "#11a76c", tick: "#fff" },
    violet: { name: "Аметист", shape: "hex", c1: "#c6a4ff", c2: "#6f3ff2", tick: "#fff" },
    gold: { name: "Золото", shape: "rosette", c1: "#ffe68a", c2: "#e8920c", tick: "#fff" },
    rose: { name: "Роза", shape: "heart", c1: "#ffa2cc", c2: "#e2337a", tick: "#fff" },
    fire: { name: "Огонь", shape: "rosette", c1: "#ffc24a", c2: "#ff2f45", tick: "#fff" },
    ice: { name: "Лёд", shape: "shield", c1: "#b8f6ff", c2: "#2b9ae6", tick: "#fff" },
    dark: { name: "Ночь", shape: "square", c1: "#4a4a52", c2: "#0d0d10", tick: "#ffd75a" },
  };
  let gid = 0;
  A.check = (style, cls = "") => {
    const c = CHECKS[style] || CHECKS.classic, id = "ck" + ++gid;
    const tick = c.shape === "heart" ? "M8.6 11.2l2.4 2.4l4.4-4.4" : "M8.5 12.2l2.4 2.4l4.6-4.6";
    return `<svg class="vcheck ${cls}" viewBox="0 0 24 24" aria-label="Подтверждённый аккаунт"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.c1}"/><stop offset="1" stop-color="${c.c2}"/></linearGradient></defs>
      <path d="${T[c.shape]}" fill="url(#${id})"/><path d="${tick}" fill="none" stroke="${c.tick}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };
  A.verMark = (u) => (u && u.verified ? A.check(u.check) : "");
  A.CHECKS = CHECKS;

  // ---------- истории: просмотренные помним на устройстве ----------
  const seen = new Set((() => { try { return JSON.parse(localStorage.getItem("dc_seen_stories") || "[]"); } catch { return []; } })());
  const markSeen = (id) => { seen.add(id); try { localStorage.setItem("dc_seen_stories", JSON.stringify([...seen].slice(-500))); } catch {} };
  A.storyRing = (u) => (u && u.story ? (seen.has(u.story) ? "st-ring seen" : "st-ring") : "");

  // подарки вокруг аватарки (до 6 штук)
  // подарки вокруг аватарки: углы и радиус как в образце (низ свободен, там ник)
  const ORBIT_ANGLES = [-120, -60, -165, -15, 155, 25], ORBIT_R = 80;
  A.orbitHtml = (ids) => {
    ids = (ids || []).filter((g) => A.byId[g]).slice(0, 6);
    if (!ids.length) return "";
    return `<span class="orbit">${ids.map((g, i) => {
      const a = (ORBIT_ANGLES[i] * Math.PI) / 180;
      return `<span class="orb" style="left:${(Math.cos(a) * ORBIT_R).toFixed(1)}px;top:${(Math.sin(a) * ORBIT_R).toFixed(1)}px;animation-delay:${(i * 0.45).toFixed(2)}s"><img src="${A.byId[g].img}" alt=""></span>`;
    }).join("")}</span>`;
  };
  const FRAMES = { wings: { name: "Золотые крылья", src: "img/frame-wings.png" } };
  A.FRAMES = FRAMES;
  A.profileAva = (u, avaHtml) => `<button class="pr-ava ${A.storyRing(u)} ${u.frame && FRAMES[u.frame] ? "framed" : ""}" data-stories="${u.id}" aria-label="Истории">${u.frame && FRAMES[u.frame] ? `<img class="pr-frame" src="${FRAMES[u.frame].src}" alt="">` : ""}${avaHtml}${A.orbitHtml(u.orbit)}</button>`;

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
    const t = e.target.closest(".pr-tag[data-copy], .tgp [data-copy]");
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
    if (!list.length) return uid === A.myId ? A.addStory() : A.toast("Историй пока нет");
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
      const NC = A.NAME_COLORS || {};
      $("#peBody").innerHTML = `
        <h4 class="sec-title">Оформление</h4>
        <section class="list"><button class="row pn-row" data-look-open><span class="grow">Цвет и узор фона профиля</span><span class="hint">›</span></button></section>
        <h4 class="sec-title">Цвет ника</h4>
        <div class="pe-colors">
          <button class="pe-color none ${!me.name_color ? "on" : ""}" data-nc="" aria-label="Обычный">Aa</button>
          ${Object.entries(NC).map(([k, v]) => { const grad = v.startsWith("linear"); return `<button class="pe-color ${me.name_color === k ? "on" : ""} ${grad && !me.verified ? "lock" : ""}" data-nc="${k}" style="background:${v}" aria-label="${k}">${grad && !me.verified ? "🔒" : ""}</button>`; }).join("")}
        </div>
        <p class="pn-note">Градиенты доступны с галочкой.</p>
        <h4 class="sec-title">Описание</h4>
        <div class="pe-add"><textarea id="peBio" maxlength="140" rows="2" placeholder="Пара слов о себе">${esc(me.bio || "")}</textarea></div>
        <button class="mini-btn" data-bio-save>Сохранить описание</button>
        <h4 class="sec-title">Галочка</h4>
        ${me.verified ? `<div class="pe-checks">${Object.entries(CHECKS).map(([k, c]) => `<button class="pe-check ${me.check === k ? "on" : ""}" data-check="${k}">${A.check(k)}<span>${c.name}</span></button>`).join("")}</div>
          <p class="pn-note">Рядом с именем и в профиле: «Аккаунт верифицирован организацией DuckChance».</p>`
          : `<button class="cta inline" data-buy-check>Купить галочку за ${STAR}100</button><p class="pn-note">Галочка рядом с именем и надпись «Аккаунт верифицирован организацией DuckChance». Дизайн можно выбрать после покупки.</p>`}
        <h4 class="sec-title">Рамка аватарки</h4>
        <div class="pe-frames"><button class="pe-frame ${!me.frame ? "on" : ""}" data-frame="">Без рамки</button>
          ${Object.entries(FRAMES).map(([k, f]) => `<button class="pe-frame ${me.frame === k ? "on" : ""}" data-frame="${k}"><img src="${f.src}" alt=""><span>${f.name}</span></button>`).join("")}</div>
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
        <h4 class="sec-title" id="peOrbitT">Подарки вокруг аватарки · ${orbit.length} из 6</h4>
        ${gifts.length ? `<div class="pe-gifts">${gifts.map((g) => `<button class="pe-gift ${orbit.includes(g) ? "on" : ""}" data-orbit="${g}" style="${A.bg(A.byId[g])}"><i class="pat"></i>${A.pic(A.byId[g])}</button>`).join("")}</div>
          <button class="cta inline" data-orbit-save>Сохранить подарки</button>` : `<p class="pn-note">Выиграйте подарки, и их можно будет поставить вокруг аватарки.</p>`}
        <h4 class="sec-title">Истории</h4>
        <button class="cta inline second" data-story-add>Добавить историю</button>
        <p class="pn-note">Фото или видео. 24 часа видна кружком на аватарке, потом остаётся в профиле в разделе «Истории».</p>`;
    };
    const save = async (body) => { try { const r = await A.api("POST", "/api/profile", body); me = r.me; paint(); if (A.refreshMe) A.refreshMe(); return true; } catch (e) { A.toast(e && e.message === "not verified" ? "Сначала купите галочку" : "Не получилось сохранить"); return false; } };
    $("#peBody").onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-look-open")) { A.closeSheet(); return setTimeout(() => { const be = document.querySelector("#bannerEdit"); if (be) be.click(); }, 320); }
      if (b.dataset.check) return save({ check: b.dataset.check });
      if (b.dataset.frame != null) return save({ frame: b.dataset.frame || null });
      if (b.dataset.nc != null) {
        if (b.classList.contains("lock")) return A.toast("Градиентный ник доступен с галочкой");
        return save({ name_color: b.dataset.nc || null });
      }
      if (b.hasAttribute("data-bio-save")) {
        try { const r = await A.api("POST", "/api/me", { bio: $("#peBio").value.trim() }); me = { ...me, bio: r.me.bio }; A.toast("Описание сохранено"); if (A.refreshMe) A.refreshMe(); } catch { A.toast("Не получилось сохранить"); }
        return;
      }
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
        const h = $("#peOrbitT"); if (h) h.textContent = `Подарки вокруг аватарки · ${orbit.length} из 6`;
        return;
      }
      if (b.hasAttribute("data-orbit-save")) { if (await save({ orbit })) A.toast("Подарки вокруг аватарки сохранены"); return; }
      if (b.hasAttribute("data-story-add")) return A.addStory();
    };
    paint();
    A.openSheet(ed);
  }
  A.openProfileEditor = openEditor;

  // ---------- профиль целиком, как в Telegram ----------
  const NAME_COLORS = {
    red: "#ff5a5a", orange: "#ff9f43", violet: "#a974ff", green: "#3ecf6f", cyan: "#2ec4e6", blue: "#3b9cff", pink: "#ff6fb5",
    sunset: "linear-gradient(90deg,#ff5a5a,#ffb443)", berry: "linear-gradient(90deg,#a974ff,#ff6fb5)", sea: "linear-gradient(90deg,#3ecf6f,#2ec4e6)",
    night: "linear-gradient(90deg,#3b9cff,#a974ff)", gold: "linear-gradient(90deg,#ffe27a,#f09a12)", aqua: "linear-gradient(90deg,#2ec4e6,#3b9cff)",
    fire: "linear-gradient(90deg,#ffcf3a,#ff3d3d)",
  };
  A.NAME_COLORS = NAME_COLORS;
  const nameStyle = (c) => {
    const v = NAME_COLORS[c]; if (!v) return "";
    const glow = v.startsWith("linear") ? v.match(/#[0-9a-f]{6}/gi).pop() : v;     // свечение ника его цветом, как в образце
    return (v.startsWith("linear") ? `background:${v};-webkit-background-clip:text;background-clip:text;color:transparent` : `color:${v}`) + `;--glow:${glow}`;
  };
  // искры: смещение от центра аватарки (px) и размер
  const SPARKS = [[-58, -64, 10], [54, -72, 13], [-100, -24, 12], [96, -36, 9], [-74, 44, 15], [78, 52, 11], [-30, -100, 8], [34, -106, 10],
    [-114, 64, 9], [110, 74, 13], [2, -124, 8], [-126, -64, 11], [124, -60, 9], [-48, 80, 8], [52, 88, 9], [-90, -94, 13], [92, -98, 8], [-138, 14, 10], [140, 16, 12]];
  const SPARK = `<svg viewBox="0 0 24 24"><path d="M12 0C12.7 7.3 16.7 11.3 24 12C16.7 12.7 12.7 16.7 12 24C11.3 16.7 7.3 12.7 0 12C7.3 11.3 11.3 7.3 12 0Z"/></svg>`;
  // узор подарка кольцами вокруг аватарки, как обложка профиля в Telegram
  const RINGS = [[56, 8, 0.32, 15], [88, 12, 0.24, 16], [120, 16, 0.17, 17], [154, 20, 0.11, 17], [188, 24, 0.06, 16]];
  const patHtml = () => RINGS.map(([r, n, o, sz], k) => Array.from({ length: n }, (_, i) => {
    const a = ((i + (k % 2) * 0.5) / n) * Math.PI * 2;
    return `<i style="left:${(Math.cos(a) * r * 1.3).toFixed(1)}px;top:${(Math.sin(a) * r).toFixed(1)}px;opacity:${o};width:${sz}px"></i>`;
  }).join("")).join("");
  const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "").replace(".", ",") + "к" : String(n));
  const seenText = (u) => { const s = Date.now() / 1000 - (u.seen || 0); return s < 120 ? "в сети" : s < 3600 ? `был(а) ${Math.round(s / 60)} мин назад` : s < 86400 ? `был(а) ${Math.round(s / 3600)} ч назад` : "был(а) давно"; };
  // иконки Tabler Icons (MIT)
  const ICON = {
    shield: `<svg viewBox="0 0 24 24"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/></svg>`,
    pen: `<svg viewBox="0 0 24 24"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/></svg>`,
    x: `<svg viewBox="0 0 24 24"><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg>`,
    copy: `<svg viewBox="0 0 24 24"><path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/></svg>`,
    cal: `<svg viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/></svg>`,
    eye: `<svg viewBox="0 0 24 24"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/></svg>`,
    note: `<svg viewBox="0 0 24 24"><path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M9 17v-13h10v13"/><path d="M9 8h10"/></svg>`,
    chev: `<svg viewBox="0 0 24 24"><path d="M9 6l6 6l-6 6"/></svg>`,
    lock: `<svg viewBox="0 0 24 24"><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/></svg>`,
  };
  A.ICON = ICON;
  const giftTile = (g, attrs, staked) => `<button class="tgp-gift" ${attrs} style="${A.bg(g)}"><i class="pat"></i>${A.pic(g)}<em class="tgp-rib">${String(g.rare).replace(".", ",")}%</em>${staked ? `<i class="tgp-lock">${ICON.lock}</i>` : ""}</button>`;
  // u: полная карточка с сервера; opts.own: свой профиль; avaHtml: аватарка (кружок с фото)
  A.profileView = (u, opts = {}) => {
    const look = opts.look || {};
    const style = look.c1 ? `--c1:${look.c1};--c2:${look.c2};--cp:${look.cp || look.c2}` + (look.sym ? `;--sym:url('${look.sym}')` : "") : "";
    const since = u.since ? new Date(u.since * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "";
    const tab = opts.tab || "gifts";
    const inv = opts.own ? [...A.state().inv].filter((it) => A.byId[it.id]).sort((a, b) => A.byId[b.id].price - A.byId[a.id].price) : null;
    const others = (u.gifts || []).filter((g) => A.byId[g]);
    const grid = inv ? inv.map((it) => giftTile(A.byId[it.id], `data-uid="${it.uid}"`, !!it.stake)).join("") : others.map((g) => giftTile(A.byId[g], `data-g="${g}"`)).join("");
    const online = seenText(u) === "в сети";
    const ch = u.channel;
    return `<div class="tgp" style="${style}">
      <div class="tgp-head">
        <div class="tgp-top">
          ${opts.own ? `<button class="tgp-ic" data-pv="fair" aria-label="Честная игра">${ICON.shield}</button><button class="tgp-ic" data-pv="edit" aria-label="Изменить профиль">${ICON.pen}</button>` : ""}
          ${opts.own || opts.close ? `<button class="tgp-ic" data-pv="close" aria-label="Закрыть">${ICON.x}</button>` : ""}
        </div>
        <div class="tgp-hero"><div class="tgp-c">
          ${look.sym ? `<div class="tgp-pat">${patHtml()}</div>` : ""}
          ${SPARKS.map(([x, y, sz], i) => `<i class="tgp-spark" style="left:${x}px;top:${y}px;width:${sz}px;animation-delay:${(i * 0.31).toFixed(2)}s">${SPARK}</i>`).join("")}
          ${A.profileAva(u, opts.avaHtml || "")}
        </div></div>
        <div class="tgp-name"><span class="tgp-nm ${u.name_color ? "glow" : ""}" style="${nameStyle(u.name_color)}">${esc(u.name)}</span>${A.verMark(u)}${opts.giftMark || ""}</div>
        <div class="tgp-pills"><span class="tgp-pill ${online ? "on" : ""}">${seenText(u)}</span></div>
        ${u.balance != null ? `<button class="tgp-bal" data-pv="balance">Баланс: ${STAR}<b>${fmt(u.balance)}</b>${ICON.chev}</button>` : ""}
      </div>
      ${u.music ? `<button class="tgp-music" data-music="${esc(u.music.url)}">${ICON.note}<span>${esc(u.music.title)}</span><b class="pm-eq"><i></i><i></i><i></i></b>${ICON.chev}</button>` : ""}
      <div class="tgp-body">
        ${opts.acts || ""}
        ${ch ? `<button class="tgp-chan" data-chan="${ch.id}">
          <span class="ava tint" style="--h:${(ch.id * 47) % 360};${ch.photo ? `background-image:url('${esc(ch.photo)}')` : ""}">${ch.photo ? "" : esc(ch.title.charAt(0))}</span>
          <span class="tgp-chan-t"><b>${esc(ch.title)}</b><span>Канал</span></span><i>${fmt(ch.members)} ${plural(ch.members)}</i></button>` : ""}
        <div class="tgp-info">
          ${u.handle ? `<div class="tgp-row"><b class="tgp-handle" data-copy="@${esc(u.handle)}">@${esc(u.handle)}${ICON.copy}</b>
            ${(u.tags || []).length ? `<span class="tgp-also">а также ${(u.tags || []).map((t) => `<b data-copy="@${esc(t)}">@${esc(t)}</b>`).join(", ")}</span>` : `<span>Имя пользователя</span>`}</div>` : ""}
          ${u.bio ? `<div class="tgp-row"><b class="pre">${esc(u.bio)}</b><span>Описание</span></div>` : ""}
          ${since ? `<div class="tgp-line">${ICON.cal}<span>В DuckChance с ${since}</span></div>` : ""}
          <div class="tgp-line">${ICON.eye}<span>${fmtK(u.views || 0)}</span></div>
        </div>
        ${u.verified ? `<div class="tgp-verified">Аккаунт верифицирован организацией «DuckChance».</div>` : ""}
        <div class="tgp-tabs"><button data-pvtab="gifts" class="${tab === "gifts" ? "on" : ""}">Подарки</button><button data-pvtab="stories" class="${tab === "stories" ? "on" : ""}">Истории</button></div>
        <div class="tgp-tab">${tab === "gifts" ? (grid ? `<div class="tgp-gifts">${grid}</div>` : `<p class="tgp-empty">${opts.own ? "Подарков пока нет: выиграйте их в играх" : "Подарков пока нет"}</p>`) : `<div class="pr-st-box"></div>`}</div>
      </div></div>`;
  };
  // общие действия профиля (вкладки, кнопки сверху, подарки)
  A.bindProfileView = (root, u, opts, repaint) => {
    root.onclick = (e) => {
      const t = e.target.closest("[data-pvtab]");
      if (t) { opts.tab = t.dataset.pvtab; repaint(); if (opts.tab === "stories") A.storiesGrid(u.id, root.querySelector(".pr-st-box")); return; }
      const g = e.target.closest(".tgp-gift[data-g]"); if (g && A.openGift) return A.openGift(A.byId[g.dataset.g], null);
      const mine = e.target.closest(".tgp-gift[data-uid]");
      if (mine && A.openGift) { const it = A.state().inv.find((x) => x.uid === Number(mine.dataset.uid)); if (it) return A.openGift(A.byId[it.id], it.uid); }
      const b = e.target.closest("[data-pv]"); if (!b) return;
      const a = b.dataset.pv;
      if (a === "edit") return openEditor();
      if (a === "fair") return document.querySelector("#fairBtn") && document.querySelector("#fairBtn").click();
      if (a === "balance" && opts.own) return document.querySelector("[data-deposit]") && document.querySelector("[data-deposit]").click();
      if (a === "close") { if (opts.onClose) return opts.onClose(); const up = document.querySelector('[data-tab="pageUp"]'); if (up) up.click(); }
    };
  };

  // ---------- свой профиль на вкладке «Профиль» ----------
  let meCard = null, meAt = 0;
  async function loadMe(force) {
    if (!A.api || !A.apiReady || !A.apiReady() || !A.myId) return null;
    if (!force && meCard && Date.now() - meAt < 20000) return meCard;
    try { meCard = await A.api("GET", `/api/user/${A.myId}`); meAt = Date.now(); } catch {}
    return meCard;
  }
  let myTab = "gifts";
  function paint(u) {
    const view = $("#pfView"), banner = $("#pfBanner");
    if (!view || !u) return;
    const av = banner && banner.querySelector(".ava.xl");
    const look = A.bannerLook ? A.bannerLook() : {};
    const g = look.gift && A.byId[look.gift] ? A.byId[look.gift] : null;
    const opts = { own: true, look, tab: myTab, avaHtml: av ? av.outerHTML.replace(/\sdata-ava(="[^"]*")?/, "") : "",
      giftMark: g ? `<img class="nm-gift" src="${g.img}" alt="">` : "" };
    const draw = () => { myTab = opts.tab; view.innerHTML = A.profileView(u, opts); };
    draw();
    view.hidden = false;
    if (banner) banner.hidden = true;
    const rich = $("#pfRich"); if (rich) rich.hidden = true;
    A.bindProfileView(view, u, opts, draw);
    if (myTab === "stories") A.storiesGrid(u.id, view.querySelector(".pr-st-box"));
  }
  // пока сервер не ответил, рисуем профиль по данным с телефона (без старой шапки)
  function localCard() {
    const tu = A.user || {};
    return { id: A.myId || tu.id || 0, name: [tu.first_name, tu.last_name].filter(Boolean).join(" ") || "Гость", handle: "", tags: [],
      seen: Date.now() / 1000, balance: A.state().balance, gifts: [], verified: false, views: 0, since: 0, story: 0 };
  }
  A.paintMyProfile = async () => { paint(meCard || localCard()); const c = await loadMe(); if (c) paint(c); };
  A.refreshMe = async () => { paint(await loadMe(true)); };
  A.repaintStories = () => { if (meCard) paint(meCard); document.querySelectorAll(".pr-ava[data-stories]").forEach((w) => { if (w.dataset.ring) w.className = "pr-ava " + w.dataset.ring; }); };
})();
