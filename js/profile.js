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

  // ---------- музыка: плеер внутри приложения (как в Telegram) ----------
  const audio = new Audio();
  audio.preload = "metadata";
  audio.setAttribute("playsinline", "");
  let queue = [], qi = 0, qOwner = "", sheetEl = null, barEl = null;
  const cur = () => queue[qi] || null;
  const tsec = (x) => { x = Math.max(0, Math.floor(x || 0)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`; };
  const NOTE = `<svg viewBox="0 0 24 24"><path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M9 17v-13h10v13"/><path d="M9 8h10"/></svg>`;
  const IC_PLAY = `<svg viewBox="0 0 24 24"><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z"/></svg>`;
  const IC_PAUSE = `<svg viewBox="0 0 24 24"><path d="M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z"/><path d="M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z"/></svg>`;
  const IC_PREV = `<svg viewBox="0 0 24 24"><path d="M19.496 4.136l-12 7a1 1 0 0 0 0 1.728l12 7a1 1 0 0 0 1.504 -.864v-14a1 1 0 0 0 -1.504 -.864z"/><path d="M4 4a1 1 0 0 1 .993 .883l.007 .117v14a1 1 0 0 1 -1.993 .117l-.007 -.117v-14a1 1 0 0 1 1 -1z"/></svg>`;
  const IC_NEXT = `<svg viewBox="0 0 24 24"><path d="M3 5v14a1 1 0 0 0 1.504 .864l12 -7a1 1 0 0 0 0 -1.728l-12 -7a1 1 0 0 0 -1.504 .864z"/><path d="M20 4a1 1 0 0 1 .993 .883l.007 .117v14a1 1 0 0 1 -1.993 .117l-.007 -.117v-14a1 1 0 0 1 1 -1z"/></svg>`;
  const coverHtml = (t, cls) => t && t.cover ? `<img class="${cls}" src="${esc(t.cover)}" alt="">` : `<span class="${cls} mp-nocover">${NOTE}</span>`;
  function paintMusic() {
    const t = cur(), on = !!t && !audio.paused;
    document.querySelectorAll("[data-music], [data-play]").forEach((b) => b.classList.toggle("on", !!t && on && (b.dataset.music ? b.dataset.music === t.url : b.dataset.playUrl === t.url)));
    if (barEl) {
      barEl.hidden = !t;
      document.body.classList.toggle("has-mbar", !!t);
      if (t) {
        barEl.querySelector(".mb-pp").innerHTML = on ? IC_PAUSE : IC_PLAY;
        barEl.querySelector(".mb-t").innerHTML = `<b>${esc(t.title)}</b>${t.performer ? `<span>${esc(t.performer)}</span>` : ""}`;
        barEl.querySelector(".mb-p").style.width = (audio.duration ? (audio.currentTime / audio.duration) * 100 : 0) + "%";
      }
    }
    if (sheetEl && !sheetEl.hidden && t) {
      sheetEl.querySelector(".mp-pp").innerHTML = on ? IC_PAUSE : IC_PLAY;
      const seek = sheetEl.querySelector(".mp-seek");
      if (!seek.dragging) seek.value = audio.duration ? Math.round((audio.currentTime / audio.duration) * 1000) : 0;
      sheetEl.querySelector(".mp-a").textContent = tsec(audio.currentTime);
      sheetEl.querySelector(".mp-b").textContent = audio.duration && isFinite(audio.duration) ? "-" + tsec(audio.duration - audio.currentTime) : (t.duration ? tsec(t.duration) : "");
    }
  }
  function mediaSession() {
    const t = cur(); if (!t || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.performer || qOwner, album: "DuckChance", artwork: t.cover ? [{ src: t.cover, sizes: "320x320", type: "image/jpeg" }] : [] });
      navigator.mediaSession.setActionHandler("play", () => play());
      navigator.mediaSession.setActionHandler("pause", () => audio.pause());
      navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
      navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    } catch {}
  }
  function load(i) { qi = ((i % queue.length) + queue.length) % queue.length; audio.src = cur().url; mediaSession(); paintSheet(); }
  function play() { const p = audio.play(); if (p) p.then(paintMusic, () => A.toast("Не получилось включить музыку")); paintMusic(); }
  function step(d) { if (!queue.length) return; load(qi + d); play(); }
  ["play", "pause", "timeupdate", "loadedmetadata", "durationchange"].forEach((ev) => audio.addEventListener(ev, paintMusic));
  audio.addEventListener("ended", () => { if (queue.length > 1) step(1); else { audio.currentTime = 0; paintMusic(); } });
  audio.addEventListener("error", () => { if (cur()) A.toast("Песня не загрузилась"); });
  // мини-плеер сверху, пока играет музыка
  function buildBar() {
    barEl = document.createElement("div");
    barEl.className = "mbar"; barEl.hidden = true;
    barEl.innerHTML = `<button class="mb-pp" aria-label="Пауза">${IC_PLAY}</button><button class="mb-t"></button><button class="mb-x" aria-label="Закрыть"><svg viewBox="0 0 24 24"><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg></button><i class="mb-p"></i>`;
    document.body.appendChild(barEl);
    barEl.querySelector(".mb-pp").onclick = () => (audio.paused ? play() : audio.pause());
    barEl.querySelector(".mb-t").onclick = () => openPlayer();
    barEl.querySelector(".mb-x").onclick = () => { audio.pause(); audio.removeAttribute("src"); audio.load(); queue = []; paintMusic(); };
  }
  // большой плеер: обложка, перемотка, кнопки, список песен
  function paintSheet() {
    if (!sheetEl) return;
    const t = cur(); if (!t) return;
    sheetEl.querySelector(".mp-cover").innerHTML = coverHtml(t, "mp-img");
    sheetEl.querySelector(".mp-title").innerHTML = `<b>${esc(t.title)}</b><span>${esc([t.performer, qOwner].filter(Boolean).join(" · "))}</span>`;
    sheetEl.querySelector(".mp-list").innerHTML = queue.length > 1 ? queue.map((x, k) => `<button class="mp-row ${k === qi ? "on" : ""}" data-k="${k}">${coverHtml(x, "mp-thumb")}<span><b>${esc(x.title)}</b><i>${esc(x.performer || "")}</i></span><em>${x.duration ? tsec(x.duration) : ""}</em></button>`).join("") : "";
    sheetEl.querySelectorAll(".mp-ctl .mp-prev, .mp-ctl .mp-next").forEach((b) => (b.disabled = queue.length < 2));
    paintMusic();
  }
  function openPlayer() {
    if (!cur()) return;
    if (!sheetEl) {
      sheetEl = document.createElement("section");
      sheetEl.className = "sheet"; sheetEl.id = "musicSheet"; sheetEl.hidden = true;
      sheetEl.setAttribute("role", "dialog"); sheetEl.setAttribute("aria-label", "Музыка");
      sheetEl.innerHTML = `<div class="grab"></div><header class="sheet-head"><h3>Музыка</h3><button class="sheet-x" data-close>Закрыть</button></header>
        <div class="sheet-body mp"><div class="mp-cover"></div><div class="mp-title"></div>
          <div class="mp-time"><input class="mp-seek" type="range" min="0" max="1000" value="0" aria-label="Перемотка"><div><span class="mp-a">0:00</span><span class="mp-b"></span></div></div>
          <div class="mp-ctl"><button class="mp-prev" aria-label="Назад">${IC_PREV}</button><button class="mp-pp" aria-label="Играть">${IC_PLAY}</button><button class="mp-next" aria-label="Дальше">${IC_NEXT}</button></div>
          <div class="mp-list"></div></div>`;
      document.body.appendChild(sheetEl);
      if (A.bindSheet) A.bindSheet(sheetEl);
      const seek = sheetEl.querySelector(".mp-seek");
      seek.addEventListener("input", () => { seek.dragging = true; if (audio.duration) sheetEl.querySelector(".mp-a").textContent = tsec((seek.value / 1000) * audio.duration); });
      seek.addEventListener("change", () => { seek.dragging = false; if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; });
      sheetEl.querySelector(".mp-pp").onclick = () => (audio.paused ? play() : audio.pause());
      sheetEl.querySelector(".mp-prev").onclick = () => step(-1);
      sheetEl.querySelector(".mp-next").onclick = () => step(1);
      sheetEl.querySelector(".mp-list").onclick = (e) => { const r = e.target.closest("[data-k]"); if (r) { load(Number(r.dataset.k)); play(); } };
    }
    paintSheet();
    A.openSheet(sheetEl);
  }
  // включить список песен (профиль игрока или песни из Telegram в настройках)
  A.playList = (list, start = 0, owner = "") => {
    list = (list || []).filter((t) => t && t.url);
    if (!list.length) return;
    if (!barEl) buildBar();
    const same = cur() && list[start] && cur().url === list[start].url;
    queue = list; qOwner = owner;
    if (!same) load(start); else { qi = start; paintSheet(); }
    play();
    openPlayer();
  };
  A.toggleMusic = (url) => A.playList([{ url, title: "Музыка" }], 0);
  A.musicOf = {};
  A.musicHtml = (m) => (m ? `<button class="pr-music" data-music="${esc(m.url)}"><i class="pm-ic"></i><span>${esc(m.title)}</span><b class="pm-eq"><i></i><i></i><i></i></b></button>` : "");

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
    const pl = e.target.closest("[data-play]");
    if (pl) { e.stopPropagation(); const r = A.musicOf[pl.dataset.play]; if (r) A.playList(r.list, r.start, r.owner); return; }
    const m = e.target.closest("[data-music]"); if (m) { e.stopPropagation(); return A.playList([{ url: m.dataset.music, title: m.textContent.trim() || "Музыка" }], 0); }
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
  let ed = null, bioT = 0;
  const ownLook = () => {
    const banner = $("#pfBanner"), av = banner && banner.querySelector(".ava.xl");
    return { look: A.bannerLook ? A.bannerLook() : {}, avaHtml: av ? av.outerHTML.replace(/\sdata-ava(="[^"]*")?/, "") : "" };
  };
  const chev = `<svg class="pe-chev" viewBox="0 0 24 24"><path d="M9 6l6 6l-6 6"/></svg>`;
  async function openEditor() {
    if (!A.api || !A.apiReady || !A.apiReady()) return A.toast("Редактирование профиля работает внутри Telegram");
    let me, chans = [];
    try { me = await A.api("GET", `/api/user/${A.myId}`); chans = ((await A.api("GET", "/api/chats")).chats || []).filter((c) => c.kind === "channel" && c.role === "owner"); }
    catch { return A.toast("Нет связи с сервером"); }
    if (!ed) {
      ed = document.createElement("section");
      ed.className = "sheet tall"; ed.id = "profSheet"; ed.hidden = true;
      ed.setAttribute("role", "dialog"); ed.setAttribute("aria-label", "Профиль");
      ed.innerHTML = `<div class="grab"></div><header class="sheet-head"><h3>Изменить профиль</h3><button class="sheet-x" data-close>Готово</button></header><div class="sheet-body pe" id="peBody"></div>`;
      document.body.appendChild(ed);
      if (A.bindSheet) A.bindSheet(ed);
    }
    const st = A.state();
    const gifts = [...new Set(st.inv.map((it) => it.id))].filter((g) => A.byId[g]).sort((a, b) => A.byId[b].price - A.byId[a].price).slice(0, 60);
    let orbit = [...(me.orbit || [])];
    const tracks = me.tg_music || [];
    const paint = () => {
      const NC = A.NAME_COLORS || {}, own = ownLook(), l = own.look || {};
      const tagsCount = (me.handle ? 1 : 0) + (me.tags || []).length;
      const lookStyle = l.c1 ? `--c1:${l.c1};--c2:${l.c2};--cp:${l.cp || l.c2}` + (l.sym ? `;--sym:url('${l.sym}')` : "") : "";
      const mus = me.music;
      $("#peBody").innerHTML = `
        <div class="pe-prev tgp" style="${lookStyle}">
          <div class="pe-prev-c">${A.profileAva({ ...me, orbit }, own.avaHtml)}</div>
          <div class="tgp-name"><span class="tgp-nm ${me.name_color ? "glow" : ""}" style="${nameStyle(me.name_color)}">${esc(me.name)}</span>${A.verMark(me)}</div>
        </div>

        <div class="pe-h">Цвет ника</div>
        <div class="pe-card pe-pad">
          <div class="pe-colors">
            <button class="pe-color none ${!me.name_color ? "on" : ""}" data-nc="" aria-label="Без цвета">Aa</button>
            ${Object.entries(NC).map(([k, v]) => { const lock = v.startsWith("linear") && !me.verified; return `<button class="pe-color ${me.name_color === k ? "on" : ""} ${lock ? "lock" : ""}" data-nc="${k}" style="--sw:${v}" aria-label="${k}">${lock ? A.ICON.lock : ""}</button>`; }).join("")}
          </div>
        </div>
        <p class="pe-foot">Градиенты открываются вместе с галочкой.</p>

        <div class="pe-h">Галочка</div>
        <div class="pe-card pe-pad">
          ${me.verified ? `<div class="pe-checks">${Object.entries(CHECKS).map(([k, c]) => `<button class="pe-check ${me.check === k ? "on" : ""}" data-check="${k}">${A.check(k)}<span>${c.name}</span></button>`).join("")}</div>`
            : `<div class="pe-buy">${A.check("classic")}<div><b>Галочка рядом с именем</b><span>и надпись «Аккаунт верифицирован организацией DuckChance»</span></div></div>
               <button class="pe-btn" data-buy-check>Купить за ${STAR}100</button>`}
        </div>

        <div class="pe-h">Рамка аватарки</div>
        <div class="pe-card pe-pad"><div class="pe-frames">
          <button class="pe-frame ${!me.frame ? "on" : ""}" data-frame=""><span class="pe-noframe"></span><span>Без рамки</span></button>
          ${Object.entries(FRAMES).map(([k, f]) => `<button class="pe-frame ${me.frame === k ? "on" : ""}" data-frame="${k}"><img src="${f.src}" alt=""><span>${f.name}</span></button>`).join("")}
        </div></div>

        <div class="pe-h">Описание</div>
        <div class="pe-card"><textarea id="peBio" maxlength="140" rows="2" placeholder="Пара слов о себе">${esc(me.bio || "")}</textarea><span class="pe-count" id="peBioN">${(me.bio || "").length}/140</span></div>
        <p class="pe-foot">Сохраняется само, когда вы перестаёте печатать.</p>

        <div class="pe-h">Музыка в профиле</div>
        <div class="pe-card">
          ${mus ? `<div class="pe-track cur">${coverHtml(mus, "pe-cov")}<span class="pe-tt"><b>${esc(mus.title)}</b><i>${esc(mus.performer || (mus.source === "telegram" ? "из профиля Telegram" : "свой файл"))}</i></span>
              <button class="pe-play" data-play-cur aria-label="Слушать">${IC_PLAY}</button></div>` : `<div class="pe-empty">Музыка не выбрана</div>`}
          ${tracks.length ? `<div class="pe-sub">Из профиля Telegram</div>${tracks.map((t, k) => `<div class="pe-track">${coverHtml(t, "pe-cov")}<span class="pe-tt"><b>${esc(t.title)}</b><i>${esc(t.performer || "")}</i></span>
              <button class="pe-play" data-tg-play="${k}" aria-label="Слушать">${IC_PLAY}</button>
              ${mus && mus.url === t.url ? `<span class="pe-on">В профиле</span>` : `<button class="pe-mini" data-tg-set="${k}">Поставить</button>`}</div>`).join("")}` : ""}
          <button class="pe-row" data-tg-sync>${NOTE}<span>${tracks.length ? "Обновить песни из Telegram" : "Взять песни из профиля Telegram"}</span>${chev}</button>
          <button class="pe-row" data-music-pick><svg viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M12 11v6"/><path d="M9.5 13.5l2.5 -2.5l2.5 2.5"/></svg><span>Загрузить свой аудиофайл</span>${chev}</button>
          ${mus ? `<button class="pe-row danger" data-music-del><svg viewBox="0 0 24 24"><path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/></svg><span>Убрать музыку из профиля</span></button>` : ""}
        </div>
        <p class="pe-foot">Песни, которые вы добавили себе в профиль Telegram, подтягиваются сами. Свой файл: MP3, M4A, OGG или WAV до 15 МБ.</p>

        <div class="pe-h">Юзернеймы · ${tagsCount} из 10</div>
        <div class="pe-card">
          ${me.handle ? `<div class="pe-line"><b>@${esc(me.handle)}</b><span class="pe-on">основной</span></div>` : ""}
          ${(me.tags || []).map((t) => `<div class="pe-line"><span>@${esc(t)}</span><button class="pe-mini" data-tag-main="${esc(t)}">Сделать основным</button><button class="pe-x" data-tag-del="${esc(t)}" aria-label="Освободить">${A.ICON.x}</button></div>`).join("")}
          ${tagsCount < 10 ? `<div class="pe-add"><span>@</span><input id="peTag" placeholder="${me.handle ? "ещё один юзернейм" : "юзернейм"}" maxlength="32" autocapitalize="off" autocomplete="off" spellcheck="false"><button class="pe-mini solid" data-tag-add>${me.handle ? `${STAR}50` : "Занять"}</button></div>` : ""}
        </div>
        <p class="pe-foot">Латиница, цифры и _, от 5 символов. Первый бесплатно, каждый следующий 50 звёзд. Только свободные.</p>

        <div class="pe-h">Канал в профиле</div>
        <div class="pe-card">
          ${chans.length ? [{ id: 0, title: "Не показывать" }, ...chans].map((c) => `<button class="pe-row" data-set-chan="${c.id}"><span>${esc(c.title)}</span>${(me.channel ? me.channel.id : 0) === c.id ? `<i class="pe-tick">${A.check("classic")}</i>` : ""}</button>`).join("")
            : `<div class="pe-empty">Создайте свой канал во вкладке «Чаты», и он появится здесь</div>`}
        </div>

        <div class="pe-h" id="peOrbitT">Подарки вокруг аватарки · ${orbit.length} из 6</div>
        <div class="pe-card pe-pad">
          ${gifts.length ? `<div class="pe-gifts">${gifts.map((g) => `<button class="pe-gift ${orbit.includes(g) ? "on" : ""}" data-orbit="${g}" style="${A.bg(A.byId[g])}"><i class="pat"></i>${A.pic(A.byId[g])}</button>`).join("")}</div>
            <button class="pe-btn" data-orbit-save>Сохранить подарки</button>` : `<div class="pe-empty">Выиграйте подарки, и их можно будет поставить вокруг аватарки</div>`}
        </div>

        <div class="pe-h">Оформление</div>
        <div class="pe-card">
          <button class="pe-row" data-look-open><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25"/><path d="M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M15.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/></svg><span>Цвет и узор фона профиля</span>${chev}</button>
          <button class="pe-row" data-story-add><svg viewBox="0 0 24 24"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M9 12h6"/><path d="M12 9v6"/></svg><span>Добавить историю</span>${chev}</button>
        </div>`;
      const bio = $("#peBio");
      bio.oninput = () => {
        $("#peBioN").textContent = `${bio.value.length}/140`;
        clearTimeout(bioT);
        bioT = setTimeout(async () => {
          try { const r = await A.api("POST", "/api/me", { bio: bio.value.trim() }); me = { ...me, bio: r.me.bio }; if (A.refreshMe) A.refreshMe(); } catch { A.toast("Описание не сохранилось"); }
        }, 900);
      };
    };
    const save = async (body) => { try { const r = await A.api("POST", "/api/profile", body); me = r.me; paint(); if (A.refreshMe) A.refreshMe(); return true; } catch (e) { A.toast(e && e.message === "not verified" ? "Сначала купите галочку" : "Не получилось сохранить"); return false; } };
    $("#peBody").onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-look-open")) { A.closeSheet(); return setTimeout(() => { const be = document.querySelector("#bannerEdit"); if (be) be.click(); }, 320); }
      if (b.dataset.check) return save({ check: b.dataset.check });
      if (b.dataset.frame != null) return save({ frame: b.dataset.frame || null });
      if (b.dataset.nc != null) {
        if (b.classList.contains("lock")) return A.toast("Градиентный ник открывается вместе с галочкой");
        A.hap.select();
        return save({ name_color: b.dataset.nc || null });
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
      if (b.hasAttribute("data-play-cur")) { const list = me.playlist && me.playlist.length ? me.playlist : [me.music]; return A.playList(list, Math.max(0, list.findIndex((t) => t.url === me.music.url)), "Вы"); }
      if (b.dataset.tgPlay != null) return A.playList(tracks, Number(b.dataset.tgPlay), "Вы");
      if (b.dataset.tgSet != null) { if (await save({ music: { ...tracks[Number(b.dataset.tgSet)], source: "telegram" } })) A.toast("Песня в профиле"); return; }
      if (b.hasAttribute("data-tg-sync")) {
        A.toast("Смотрим песни в вашем профиле Telegram…");
        try {
          me = (await A.api("POST", "/api/profile/tgmusic", {})).me;
          const n = (me.tg_music || []).length;
          A.toast(n ? `Нашли песен: ${n}` : "В профиле Telegram пока нет песен: добавьте их в Telegram, в разделе «Музыка» профиля");
          openEditor();
        } catch { A.toast("Не получилось связаться с Telegram"); }
        return;
      }
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
        const pv = $("#peBody .pe-prev-c"); if (pv) pv.innerHTML = A.profileAva({ ...me, orbit }, ownLook().avaHtml);
        return;
      }
      if (b.hasAttribute("data-orbit-save")) { if (await save({ orbit })) A.toast("Подарки вокруг аватарки сохранены"); return; }
      if (b.hasAttribute("data-story-add")) return A.addStory();
    };
    paint();
    if (ed.hidden) { $("#peBody").scrollTop = 0; A.openSheet(ed); }
  }
  A.openProfileEditor = openEditor;

  // ---------- профиль целиком, как в Telegram ----------
  const NAME_COLORS = {
    red: "#ff5a5a", orange: "#ff9f43", violet: "#a974ff", green: "#3ecf6f", cyan: "#2ec4e6", blue: "#3b9cff", pink: "#ff6fb5",
    sunset: "linear-gradient(90deg,#ff5a5a,#ffb443)", berry: "linear-gradient(90deg,#a974ff,#ff6fb5)", sea: "linear-gradient(90deg,#3ecf6f,#2ec4e6)",
    night: "linear-gradient(90deg,#3b9cff,#a974ff)", gold: "linear-gradient(90deg,#ffe27a,#f09a12)", aqua: "linear-gradient(90deg,#2ec4e6,#3b9cff)",
    fire: "linear-gradient(90deg,#ffcf3a,#ff3d3d)", candy: "linear-gradient(90deg,#ff6fb5,#2ec4e6)",
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
    if (u.music) {         // список песен игрока для плеера
      const list = (u.playlist && u.playlist.length ? u.playlist : [u.music]);
      A.musicOf[u.id] = { list, start: Math.max(0, list.findIndex((t) => t.url === u.music.url)), owner: u.name };
    }
    const ch = u.channel;
    return `<div class="tgp" style="${style}">
      <div class="tgp-head">
        <div class="tgp-top">
          ${opts.own ? `<button class="tgp-ic" data-pv="edit" aria-label="Изменить профиль">${ICON.pen}</button>` : ""}
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
      ${u.music ? `<button class="tgp-music" data-play="${u.id}" data-play-url="${esc(u.music.url)}">${ICON.note}<span>${esc([u.music.performer, u.music.title].filter(Boolean).join(" - "))}</span><b class="pm-eq"><i></i><i></i><i></i></b>${ICON.chev}</button>` : ""}
      <div class="tgp-body">
        ${opts.acts || ""}
        ${ch ? `<button class="tgp-chan" data-chan="${ch.id}">
          <span class="ava tint" style="--h:${(ch.id * 47) % 360};${ch.photo ? `background-image:url('${esc(ch.photo)}')` : ""}">${ch.photo ? "" : esc(ch.title.charAt(0))}</span>
          <span class="tgp-chan-t"><b>${esc(ch.title)}${A.verMark(ch)}</b><span>Канал</span></span><i>${fmt(ch.members)} ${plural(ch.members)}</i></button>` : ""}
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
    // перерисовываем только если что-то поменялось: иначе кнопки пропадают прямо под пальцем
    const draw = () => { myTab = opts.tab; const html = A.profileView(u, opts); if (html !== view._html) { view.innerHTML = html; view._html = html; } };
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
