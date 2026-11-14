// Чаты, группы и каналы как в Telegram: права и префиксы, фото, юзернеймы, приглашения, передача подарков.
// Стейкинг подарков и особый стиль редких коллекций тоже здесь. Сервер: server/app.py.
(() => {
  "use strict";
  const A = window.App, { $, all, STAR, fmt, byId, CATALOG, toast, hap, openSheet, closeSheet, tg, inTg, user } = A;
  const st = () => A.state();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- сервер ----------
  const PROD_API = "https://duck.2-27-12-205.sslip.io";   // сервер на VPS (server/app.py за nginx)
  const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const API = LOCAL ? "http://127.0.0.1:8790" : PROD_API;
  // на своём компьютере без Telegram входим тестовым игроком: ?as=2 открывает второго
  const devId = (() => {
    if (inTg || !LOCAL) return 0;
    const q = Number(new URLSearchParams(location.search).get("as"));
    return q > 0 ? 1000 + q : 1001;
  })();
  const myId = user ? user.id : devId;
  const canUse = !!API && (inTg || LOCAL);
  let me = null;   // моя карточка с сервера: юзернейм, «о себе»

  async function call(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (inTg) headers.Authorization = "tma " + tg.initData;
    else headers["X-Dev-User"] = `${devId}:${encodeURIComponent("Тест " + (devId - 1000))}`;
    const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "error"), { status: r.status });
    return j;
  }
  const fail = (e) => toast(e && e.status === 429 ? "Слишком часто, подождите немного" : e && e.status === 409 ? "Это имя уже занято"
    : e && e.status === 403 ? "Недостаточно прав" : "Нет связи с сервером");

  // ---------- мелочи ----------
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (ts) => { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function when(ts) {
    const d = new Date(ts * 1000), now = new Date();
    if (d.toDateString() === now.toDateString()) return hhmm(ts);
    if (now - d < 6 * 864e5) return d.toLocaleDateString("ru-RU", { weekday: "short" });
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  }
  function dayLabel(ts) {
    const d = new Date(ts * 1000), now = new Date(), y = new Date(now - 864e5);
    if (d.toDateString() === now.toDateString()) return "Сегодня";
    if (d.toDateString() === y.toDateString()) return "Вчера";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  }
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
  const members = (c) => c.kind === "dm" ? "" : `${fmt(c.members)} ${c.kind === "channel" ? plural(c.members, "подписчик", "подписчика", "подписчиков") : plural(c.members, "участник", "участника", "участников")}`;
  const kindName = (c) => c.kind === "channel" ? "Канал" : "Группа";
  const at = (u) => u && u.handle ? "@" + u.handle : "";
  function seenText(u) {
    const ago = Date.now() / 1000 - (u.seen || 0);
    if (ago < 120) return "в сети";
    if (ago < 3600) return `был(а) ${Math.round(ago / 60)} мин назад`;
    if (ago < 86400) return `был(а) в ${hhmm(u.seen)}`;
    return ago < 7 * 86400 ? "был(а) недавно" : "был(а) давно";
  }
  function confirmBox(text) {
    return new Promise((res) => {
      if (inTg && tg.showConfirm) try { return tg.showConfirm(text, (ok) => res(!!ok)); } catch {}
      res(window.confirm(text));
    });
  }
  function copy(text, ok = "Скопировано") {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { toast(ok); hap.soft(); }, () => toast("Не получилось скопировать"));
  }
  const chev = `<svg class="chev" viewBox="0 0 8 14" aria-hidden="true"><path d="m1 1 6 6-6 6" /></svg>`;

  // ---------- оформление: особый стиль, обложки, аватарки ----------
  const top = {};
  for (const g of CATALOG) top[g.gift] = Math.max(top[g.gift] || 0, g.price);
  const SPECIAL = new Set(Object.keys(top).filter((k) => top[k] >= 5000));
  const styleOf = (look) => { const g = look && look.gift && byId[look.gift]; return g && SPECIAL.has(g.gift) ? g : null; };
  const vars = (g) => `--c1:${g.c1};--c2:${g.c2};--cp:${g.cp};--sym:url('${g.sym}')`;
  // оформление пришло от другого игрока: пропускаем только цвета и картинки каталога
  const hexOk = (x) => /^#[0-9a-f]{3,8}$/i.test(x || "");
  function safeLook(look) {
    if (!look || !hexOk(look.c1) || !hexOk(look.c2) || !hexOk(look.cp)) return null;
    const sym = /^https:\/\/cdn\.changes\.tg\/[^"'()\s]+$/.test(look.sym || "") ? look.sym : null;
    return { c1: look.c1, c2: look.c2, cp: look.cp, sym, gift: look.gift && byId[look.gift] ? look.gift : null };
  }
  const BACKDROPS = [];
  { const seen = new Set(); for (const g of CATALOG) if (!seen.has(g.backdrop) && BACKDROPS.length < 21) { seen.add(g.backdrop); BACKDROPS.push({ c1: g.c1, c2: g.c2, cp: g.cp, sym: g.sym }); } }

  const hue = (n) => (Math.abs(Number(n)) * 47) % 360;
  const photoOk = (u) => (LOCAL ? /^https?:\/\/[^"'()\s]+$/ : /^https:\/\/[^"'()\s]+$/).test(u || "") ? u : "";
  function ava(u, cls = "") {
    const g = styleOf(u.look), photo = photoOk(u.photo);
    const style = `--h:${hue(u.id)};${g ? vars(g) + ";" : ""}${photo ? `background-image:url('${photo}');` : ""}`;
    return `<span class="ava ${cls} ${g ? "aring" : ""} ${photo ? "" : "tint"}" style="${style}">${photo ? "" : esc((u.name || "?").trim().charAt(0).toUpperCase())}</span>`;
  }
  function chatAva(c, cls = "") {
    if (c.kind === "dm") return ava(c.peer, cls);
    const photo = photoOk(c.photo);
    return `<span class="ava ${cls} ${photo ? "" : "tint"}" style="--h:${hue(c.id + 7)};${photo ? `background-image:url('${photo}')` : ""}">${photo ? "" : esc(c.title.trim().charAt(0).toUpperCase())}</span>`;
  }
  const giftMark = (look) => { const g = look && look.gift && byId[look.gift]; return g ? `<img class="nm-gift" src="${g.img}" alt="">` : ""; };
  const chatName = (c) => c.kind === "dm" ? esc(c.peer.name) + giftMark(c.peer.look) : esc(c.title);

  // обложка как у профиля в Telegram: цвет фона подарка и символы кольцами вокруг аватарки
  const RINGS = [[58, 7, 0.55, 20], [90, 11, 0.38, 18], [124, 15, 0.24, 17], [160, 19, 0.13, 15], [198, 23, 0.06, 14]];
  const ringsHtml = (cy) => RINGS.map(([r, n, o, sz], k) => Array.from({ length: n }, (_, i) => {
    const a = (i + (k % 2) * 0.5) / n * Math.PI * 2;
    return `<i style="left:calc(50% + ${(Math.cos(a) * r * 1.35).toFixed(1)}px);top:${(cy + Math.sin(a) * r * 0.8).toFixed(1)}px;opacity:${o};width:${sz}px"></i>`;
  }).join("")).join("");
  function cover(look, seed, inner, cls = "") {
    const l = safeLook(look);
    const style = l ? `--c1:${l.c1};--c2:${l.c2};--cp:${l.cp}` + (l.sym ? `;--sym:url('${l.sym}')` : "")
      : `--c1:hsl(${hue(seed)} 62% 62%);--c2:hsl(${hue(seed)} 58% 46%);--cp:hsl(${hue(seed)} 60% 32%)`;
    return `<div class="cover ${cls} ${l && l.sym ? "has" : ""}" style="${style}">${l && l.sym ? `<div class="pf-rings">${ringsHtml(cls.includes("sm") ? 52 : 74)}</div>` : ""}${inner}</div>`;
  }

  // ---------- фото: сжимаем на устройстве и загружаем ----------
  function pickFile() {
    return new Promise((res) => {
      const inp = $("#cvFile");
      inp.value = "";
      inp.onchange = () => res(inp.files && inp.files[0]);
      inp.click();
    });
  }
  function loadImg(src, cors) {
    return new Promise((res, rej) => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }
  async function shrink(file, max, square) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url);
      let w = img.naturalWidth, h = img.naturalHeight, sx = 0, sy = 0, sw = w, sh = h;
      if (square) { const s = Math.min(w, h); sx = (w - s) / 2; sy = (h - s) / 2; sw = sh = s; w = h = Math.min(max, s); }
      else { const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      return { data: cv.toDataURL("image/jpeg", 0.85), w, h };
    } finally { URL.revokeObjectURL(url); }
  }
  async function upload(max, square) {
    const f = await pickFile(); if (!f) return null;
    if (!/^image\//.test(f.type)) { toast("Нужна картинка"); return null; }
    toast("Загружаем фото…");
    const img = await shrink(f, max, square);
    const r = await call("POST", "/api/upload", { data: img.data });
    return { url: r.url, w: img.w, h: img.h };
  }

  // ---------- список чатов ----------
  let chats = [], listT = null, firstList = true;
  async function loadChats() {
    if (!canUse) return;
    try { chats = (await call("GET", "/api/chats")).chats; } catch { return; }
    if (A.tab === "pageChats") renderChats();
    const unread = chats.reduce((a, c) => a + (c.unread || 0), 0);
    $("#chatDot").hidden = !unread;
    if (cur) { const n = chats.filter((c) => c.id !== cur.id).reduce((a, c) => a + (c.unread || 0), 0); $("#cvBackN").hidden = !n; $("#cvBackN").textContent = n; }
    if (chats.some((c) => c.unread && c.last && c.last.gift)) claimIncoming();
  }
  const tick = (read) => `<svg class="tick ${read ? "read" : ""}" viewBox="0 0 18 12"><path d="M1 6.5 4.5 10 11 2.5" />${read ? `<path d="M7 9.2 7.8 10 14.5 2.5" />` : ""}</svg>`;
  function lastText(m) {
    if (!m) return "";
    if (m.kind === "service") return serviceText(m, true);
    if (m.kind === "deleted") return "Сообщение удалено";
    if (m.kind === "photo") return "Фото" + (m.text ? ", " + esc(m.text) : "");
    if (m.kind === "invite") return `Приглашение: ${esc(m.data.card ? m.data.card.title : "")}`;
    if (m.gift && byId[m.gift]) return `Подарок: ${esc(byId[m.gift].gift)}`;
    return esc(m.text);
  }
  const ICON_CHANNEL = `<svg class="ch-ic" viewBox="0 0 24 24"><path d="M3 10v4h3l5 4V6L6 10zM15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>`;
  const ICON_GROUP = `<svg class="ch-ic" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5M16 5.2a3 3 0 0 1 0 5.6M18 14c2 .6 3 2.3 3.3 5" /></svg>`;
  function chatRow(c, i = 0) {
    const m = c.last, mine = m && m.user.id === myId && m.kind !== "service";
    const who = m && m.kind !== "service" ? (mine ? "Вы: " : c.kind === "group" ? `<b class="ch-who">${esc(m.user.name)}: </b>` : "") : "";
    const icon = c.kind === "channel" ? ICON_CHANNEL : c.kind === "group" ? ICON_GROUP : "";
    return `<button class="ch-row ${firstList ? "stag" : ""}" style="--i:${i}" data-chat="${c.id}">${chatAva(c, "ch-ava")}
      <span class="ch-main"><span class="ch-l1"><b>${icon}${chatName(c)}</b><span class="ch-time">${mine && c.kind === "dm" ? tick(m.id <= (c.peer_read || 0)) : ""}${m ? when(m.created) : ""}</span></span>
      <span class="ch-l2"><span class="ch-prev">${m ? who + lastText(m) : esc(c.about || members(c))}</span>${c.unread ? `<i class="ch-badge">${c.unread > 99 ? "99+" : c.unread}</i>` : ""}</span></span></button>`;
  }
  function renderChats() {
    $("#chOff").hidden = true;
    const list = $("#chList");
    list.hidden = !!$("#chSearch").value.trim();
    list.innerHTML = chats.length ? chats.map(chatRow).join("")
      : `<div class="ch-empty"><span class="duck xl" data-duck="hi" data-loop></span><b>Пока нет чатов</b>Найдите игрока по имени или @нику или создайте свою группу или канал.</div>`;
    if (!chats.length) { A.initDucks(list); A.syncDucks(); }
    firstList = false;
  }
  function showOff() {
    $("#chList").hidden = true; $("#chOff").hidden = false;
    $("#chOffTitle").textContent = API ? "Откройте в Telegram" : "Чаты скоро заработают";
    $("#chOffText").textContent = API ? "Чаты работают внутри приложения в Telegram." : "Подключаем сервер для чатов.";
    $("#chNew").disabled = $("#chSearch").disabled = true;
    A.initDucks($("#chOff")); A.syncDucks();
  }

  // поиск людей, групп и каналов
  let searchT = null, searchSeq = 0, found = {};
  const userRow = (u) => `<button class="ch-row slim" data-user="${u.id}">${ava(u, "sm2")}<span class="ch-main"><span class="ch-l1"><b>${esc(u.name)}${giftMark(u.look)}</b></span><span class="ch-l2"><span class="ch-prev">${esc(at(u) || seenText(u))}</span></span></span></button>`;
  async function search(qs) {
    const box = $("#chFound"), seq = ++searchSeq;
    if (qs.length < 2) { box.hidden = true; $("#chList").hidden = false; return; }
    let r;
    try { r = await call("GET", "/api/search?q=" + encodeURIComponent(qs)); } catch (e) { return fail(e); }
    if (seq !== searchSeq) return;
    found = Object.fromEntries(r.users.map((u) => [u.id, u]));
    const users = r.users.map(userRow).join("");
    const groups = r.chats.map((c) => `<button class="ch-row slim" data-chat="${c.id}">${chatAva(c, "sm2")}<span class="ch-main"><span class="ch-l1"><b>${c.kind === "channel" ? ICON_CHANNEL : ICON_GROUP}${esc(c.title)}</b></span><span class="ch-l2"><span class="ch-prev">${c.handle ? "@" + esc(c.handle) + " · " : ""}${members(c)}</span></span></span></button>`).join("");
    box.innerHTML = (users ? `<h4 class="sec-title">Игроки</h4><section class="list ch-list">${users}</section>` : "") +
      (groups ? `<h4 class="sec-title">Группы и каналы</h4><section class="list ch-list">${groups}</section>` : "") +
      (!users && !groups ? `<div class="ch-empty">Никого не нашли</div>` : "");
    box.hidden = false; $("#chList").hidden = true;
  }

  // ---------- открытый чат ----------
  const view = $("#chatView"), msgsBox = $("#cvMsgs"), input = $("#cvInput");
  let cur = null, msgs = [], msgT = null, replyTo = null, peerRead = 0, typingNames = [], lastNow = 0, roles = {}, shownIds = new Set();
  const canPost = () => cur && cur.role && (cur.kind === "channel" ? cur.can.post : cur.can.send);

  async function openChat(id) {
    let c;
    try { c = await call("GET", `/api/chat/${id}`); } catch (e) { return fail(e); }
    if (A.sheet) closeSheet(true);
    cur = c; msgs = []; replyTo = null; peerRead = c.peer_read || 0; typingNames = []; lastNow = 0; roles = {}; shownIds = new Set();
    msgsBox.innerHTML = "";
    input.value = ""; grow();
    view.hidden = false; void view.offsetWidth; view.classList.add("on");
    $("#pageChats").classList.add("pushed");
    document.body.style.overflow = "hidden";
    A.keepBack = true;
    if (inTg) try { tg.BackButton.show(); } catch {}
    paintHead(); paintFoot(); paintPin(); setReply(null); paintWall();
    if (c.kind === "group") loadRoles();
    await pullMessages(true);
    clearInterval(msgT); msgT = setInterval(() => pullMessages(false), 1500);
  }
  function closeChat() {
    if (!cur) return;
    cur = null; clearInterval(msgT);
    view.classList.remove("on");
    $("#pageChats").classList.remove("pushed");
    setTimeout(() => { if (!cur) view.hidden = true; }, 300);
    document.body.style.overflow = "";
    A.keepBack = false;
    if (inTg) try { tg.BackButton.hide(); } catch {}
    loadChats();
  }
  async function refreshChat() {
    if (!cur) return;
    const id = cur.id;
    let c;
    try { c = await call("GET", `/api/chat/${id}`); } catch { return; }
    if (!cur || cur.id !== id) return;
    Object.assign(cur, c);
    paintHead(); paintFoot(); paintPin(); paintWall();
    if (cur.kind === "group") loadRoles();
  }
  async function loadRoles() {
    const id = cur.id;
    try {
      const list = (await call("GET", `/api/chat/${id}/members`)).members;
      if (cur && cur.id === id) { roles = Object.fromEntries(list.map((m) => [m.id, m])); renderMsgs(false); }
    } catch {}
  }
  function paintHead() {
    $("#cvAva").outerHTML = chatAva(cur).replace('class="ava', 'id="cvAva" class="ava');
    $("#cvTitle").innerHTML = chatName(cur);
    paintSub();
  }
  function paintSub() {
    let sub;
    if (typingNames.length) {
      const who = cur.kind === "dm" ? "" : typingNames.join(", ") + " ";
      sub = `<span class="typing">${esc(who)}печатает<i></i><i></i><i></i></span>`;
    } else sub = cur.kind === "dm" ? esc(seenText(cur.peer)) : members(cur);
    const el = $("#cvSub");
    if (el.innerHTML !== sub) el.innerHTML = sub;
    el.classList.toggle("on", !!typingNames.length || (cur.kind === "dm" && Date.now() / 1000 - (cur.peer.seen || 0) < 120));
  }
  function paintFoot() {
    const post = canPost();
    $("#cvFoot").hidden = !post;
    $("#cvJoin").hidden = post;
    if (!post) {
      const b = $("#cvJoinBtn");
      if (cur.banned) b.textContent = "Вы заблокированы в этом чате";
      else if (!cur.role) b.textContent = cur.kind === "channel" ? "Подписаться" : "Вступить в группу";
      else b.textContent = cur.kind === "channel" ? "Отписаться" : "Писать в группу запрещено";
      b.disabled = !!cur.banned || (!!cur.role && cur.kind === "group");
      b.classList.toggle("muted", !!cur.role);
    }
    $("#cvGift").hidden = !(cur.kind === "dm" && cur.can.gifts);
    syncFoot();
  }
  function syncFoot() {
    const foot = $("#cvFoot");
    foot.classList.toggle("has", !!input.value.trim());
    foot.classList.toggle("nogift", !cur || $("#cvGift").hidden);
  }
  function paintPin() {
    const p = cur.pinned, bar = $("#cvPin");
    bar.hidden = !p;
    if (p) { $("#cvPinText").textContent = p.kind === "photo" ? "Фото" : p.gift ? "Подарок" : p.text.slice(0, 80); $("#cvPinX").hidden = !cur.can.pin; }
  }
  function paintWall() {
    const l = safeLook(cur.kind === "dm" ? cur.peer.look : cur.look);
    const w = $("#cvWall");
    w.style.cssText = l && l.sym ? `--sym:url('${l.sym}');--wc:${l.c1}` : "";
    w.classList.toggle("has", !!(l && l.sym));
  }

  // служебные сообщения
  function serviceText(m, short) {
    const d = m.data || {}, n = esc(m.user.name), ch = cur ? cur.kind === "channel" : false;
    const t = {
      created: ch ? `Канал «${esc(d.title)}» создан` : `${n} создал(а) «${esc(d.title)}»`,
      joined: `${n} вступил(а) в группу`,
      left: `${n} покинул(а) группу`,
      title: ch ? `Название канала изменено на «${esc(d.title)}»` : `${n} изменил(а) название на «${esc(d.title)}»`,
      photo: ch ? "Фото канала обновлено" : `${n} изменил(а) фото группы`,
      photo_removed: ch ? "Фото канала удалено" : `${n} удалил(а) фото группы`,
      pinned: `${n} закрепил(а) сообщение`,
      removed: `${n} удалил(а) ${esc(d.name || "участника")}`,
    }[d.action] || "Изменения в чате";
    return short ? t.replace(/<[^>]+>/g, "") : t;
  }

  const ICON_REPLY = `<svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" /></svg>`;
  function bubble(m, prev, next) {
    if (m.kind === "service") {
      const ph = m.data && m.data.action === "photo" && photoOk(m.data.photo);
      return `<div class="m-service ${shownIds.size && !shownIds.has(m.id) ? "pop" : ""}" data-row="${m.id}"><span>${serviceText(m)}</span>${ph ? `<img src="${ph}" alt="">` : ""}</div>`;
    }
    const isChannel = cur.kind === "channel";
    const mine = m.user.id === myId && !isChannel;
    const plain = m.kind !== "photo" && m.kind !== "invite" && !m.gift;   // особый стиль только у обычного текста
    const g = isChannel || !plain ? null : styleOf(m.user.look);
    const same = (x) => x && x.kind !== "service" && x.kind !== "deleted" && x.user.id === m.user.id && Math.abs(x.created - m.created) < 300 && dayLabel(x.created) === dayLabel(m.created);
    const first = !same(prev), last = !same(next);
    const showAva = !mine && cur.kind === "group";
    const r = roles[m.user.id];
    const role = r ? (r.title || (r.role === "owner" ? "владелец" : r.role === "admin" ? "админ" : "")) : "";
    const name = isChannel ? (first ? `<span class="m-name ch">${esc(cur.title)}</span>` : "")
      : first && !mine && cur.kind === "group" ? `<span class="m-name" data-user="${m.user.id}" style="--h:${hue(m.user.id)}"><span>${esc(m.user.name)}</span>${giftMark(m.user.look)}${role ? `<i class="m-role">${esc(role)}</i>` : ""}</span>` : "";
    const q = m.reply && msgs.find((x) => x.id === m.reply && x.kind !== "deleted");
    const qg = q && !isChannel && styleOf(q.user.look);
    const quote = q ? `<span class="m-quote ${qg ? "styled" : ""}" data-goto="${q.id}" style="${qg ? vars(qg) : `--h:${hue(q.user.id)}`}"><b>${esc(isChannel ? cur.title : q.user.name)}</b><span>${q.kind === "photo" ? "Фото" : q.gift ? "Подарок" : esc(q.text.slice(0, 90))}</span></span>` : "";
    const meta = `<span class="m-meta"><time>${hhmm(m.created)}</time>${mine ? tick(cur.kind === "dm" && m.id <= peerRead) : ""}</span>`;
    let body = "", cls = "";
    if (m.kind === "photo" && m.data && photoOk(m.data.url)) {
      cls = m.text ? "photo cap" : "photo";
      body = `<button class="m-photo" data-photo="${m.data.url}" style="aspect-ratio:${m.data.w}/${m.data.h}"><img src="${m.data.url}" alt="" loading="lazy"></button>${m.text ? `<span class="m-text">${esc(m.text)}</span>` : ""}`;
    } else if (m.gift && byId[m.gift]) {
      const s = byId[m.gift];
      cls = "giftmsg";
      body = `<button class="m-giftcard" data-gift="${s.id}" style="${A.bg(s)}"><i class="pat"></i>${A.pic(s, true)}<b>${esc(s.gift)}</b><span>#${s.num}</span></button>
        <span class="m-gift-cap">${mine ? `Вы подарили ${esc(cur.peer ? cur.peer.name : "")}` : `Подарок от ${esc(m.user.name)}`}</span>
        <span class="m-gift-rows"><span>Модель</span><b>${esc(s.model)}</b><span>Фон</span><b>${esc(s.backdrop)}</b><span>Символ</span><b>${esc(s.symbol)}</b><span>Цена</span><b class="m-price">${STAR}${fmt(s.price)}</b></span>
        <span class="m-gift-btn" data-gift="${s.id}">Посмотреть</span>${m.text ? `<span class="m-text">${esc(m.text)}</span>` : ""}`;
    } else if (m.kind === "invite" && m.data && m.data.card) {
      cls = "invite";
      body = inviteCard(m.data.card) + (m.text ? `<span class="m-text">${esc(m.text)}</span>` : "");
    } else body = `<span class="m-text">${esc(m.text)}</span>`;
    const pop = shownIds.size && !shownIds.has(m.id) ? "pop" : "";
    return `<div class="m-row ${mine ? "me" : ""} ${first ? "first" : ""} ${last ? "last" : ""} ${pop}" data-row="${m.id}">
      ${showAva ? (last ? `<span class="m-ava" data-user="${m.user.id}">${ava(m.user, "sm")}</span>` : `<span class="m-ava"></span>`) : ""}
      <div class="msg ${cls} ${g ? "styled" : ""} ${isChannel ? "post" : ""}" data-mid="${m.id}" style="${g ? vars(g) : ""}">
        ${g ? `<i class="m-pat"></i>` : ""}${name}${quote}${body}${meta}</div>
      <i class="m-swipe">${ICON_REPLY}</i></div>`;
  }
  function inviteCard(c) {
    const g = c.look && c.look.gift && byId[c.look.gift];
    const joined = chats.some((x) => x.id === c.id);
    const own = c.owner || {};
    return `<div class="inv">${cover(c.look, c.id + 7, `${chatAva(c, "inv-ava")}${g ? `<img class="inv-gift" src="${g.img}" alt="">` : ""}`, "sm")}
      <div class="inv-body"><span class="inv-kind">${c.kind === "channel" ? ICON_CHANNEL : ICON_GROUP}${kindName(c)} · ${members(c)}</span><b>${esc(c.title)}</b>${c.about ? `<p>${esc(c.about)}</p>` : ""}
      ${own.name ? `<span class="inv-own">Владелец: ${esc(own.name)}${own.handle ? ` <i>@${esc(own.handle)}</i>` : ""}</span>` : ""}</div>
      <span class="inv-btn" data-open="${c.id}">${joined ? "Открыть" : c.kind === "channel" ? "Подписаться" : "Вступить"}</span></div>`;
  }
  function renderMsgs(stick) {
    const near = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight < 140;
    const vis = msgs.filter((m) => m.kind !== "deleted");
    let html = "", day = "";
    vis.forEach((m, i) => {
      const d = dayLabel(m.created);
      if (d !== day) { day = d; html += `<div class="m-day"><span>${d}</span></div>`; }
      html += bubble(m, vis[i - 1], vis[i + 1]);
    });
    if (!vis.length) html = `<div class="cv-empty">${emptyText()}</div>`;
    if (typingNames.length && cur.kind !== "channel") html += `<div class="m-row typing-row"><div class="msg typing-b"><i></i><i></i><i></i></div></div>`;
    msgsBox.innerHTML = html;
    vis.forEach((m) => shownIds.add(m.id));
    if (!shownIds.size) shownIds.add(0);
    if (!vis.length) { A.initDucks(msgsBox); A.syncDucks(); }
    if (stick || near) msgsBox.scrollTop = msgsBox.scrollHeight;
    syncDown();
  }
  function emptyText() {
    if (cur.kind === "dm") return `<span class="duck xl" data-duck="hi" data-loop></span><b>Сообщений пока нет</b>Напишите ${esc(cur.peer.name)} или отправьте подарок`;
    return cur.kind === "channel" ? "<b>Постов пока нет</b>" : "<b>Сообщений пока нет</b>";
  }
  let pulling = false, unseen = 0;
  async function pullMessages(first) {
    if (!cur || pulling) return;
    pulling = true;
    const id = cur.id, after = msgs.length ? msgs[msgs.length - 1].id : 0;
    try {
      const r = await call("GET", `/api/chat/${id}/messages?` + (after ? `after=${after}&` : "") + (lastNow ? `since=${lastNow}` : ""));
      if (!cur || cur.id !== id) return;
      lastNow = r.now;
      const fresh = r.messages.filter((m) => !msgs.some((x) => x.id === m.id));
      const gone = (r.deleted || []).filter((d) => { const m = msgs.find((x) => x.id === d); if (m && m.kind !== "deleted") { m.kind = "deleted"; return true; } return false; });
      const readChanged = (r.peer_read || 0) !== peerRead;
      peerRead = r.peer_read || 0;
      const typingChanged = r.typing.join() !== typingNames.join();
      typingNames = r.typing;
      if (typingChanged) paintSub();
      if ((r.pinned || 0) !== ((cur.pinned && cur.pinned.id) || 0)) refreshChat();
      const near = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight < 140;
      msgs = msgs.concat(fresh);
      if (first || fresh.length || gone.length || readChanged || typingChanged) {
        renderMsgs(first);
        if (!first && !near && fresh.some((m) => m.user.id !== myId)) { unseen += fresh.length; syncDown(); }
      }
      if (!first && fresh.some((m) => m.user.id !== myId && m.kind !== "service")) hap.tick();
      if (fresh.some((m) => m.gift && m.user.id !== myId)) claimIncoming();
      if (!first && fresh.some((m) => m.kind === "service")) refreshChat();
    } catch {} finally { pulling = false; }
  }
  function syncDown() {
    const far = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight > 300;
    if (!far) unseen = 0;
    $("#cvDown").classList.toggle("on", far);
    $("#cvDownN").hidden = !unseen; $("#cvDownN").textContent = unseen;
  }
  async function send() {
    const text = input.value.trim();
    if (!text || !canPost()) return;
    input.value = ""; grow(); syncFoot();
    const reply = replyTo; setReply(null);
    try {
      const m = await call("POST", `/api/chat/${cur.id}/messages`, { text, reply });
      if (!msgs.some((x) => x.id === m.id)) msgs.push(m);
      renderMsgs(true); hap.soft();
    } catch (e) { input.value = text; grow(); syncFoot(); fail(e); }
  }
  async function sendPhoto() {
    try {
      const ph = await upload(1280, false); if (!ph) return;
      const m = await call("POST", `/api/chat/${cur.id}/messages`, { photo: ph, text: input.value.trim(), reply: replyTo });
      input.value = ""; grow(); syncFoot(); setReply(null);
      if (!msgs.some((x) => x.id === m.id)) msgs.push(m);
      renderMsgs(true); hap.soft();
    } catch (e) { fail(e); }
  }
  function grow() { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; }
  let typedAt = 0;
  function typed() {
    if (!cur || Date.now() - typedAt < 3000 || !input.value.trim()) return;
    typedAt = Date.now();
    call("POST", `/api/chat/${cur.id}/typing`, {}).catch(() => {});
  }
  function setReply(m) {
    replyTo = m ? m.id : null;
    const bar = $("#cvReply");
    if (m) {
      $("#cvReplyName").textContent = cur.kind === "channel" ? cur.title : m.user.name;
      $("#cvReplyText").textContent = m.kind === "photo" ? "Фото" : m.gift ? "Подарок" : m.text.slice(0, 90);
      bar.hidden = false; void bar.offsetWidth; bar.classList.add("on");
      input.focus();
    } else { bar.classList.remove("on"); bar.hidden = true; }
  }
  function gotoMsg(id) {
    const row = msgsBox.querySelector(`[data-row="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
  }

  // ---------- всплывающее меню ----------
  const ctx = $("#ctx"), ctxMenu = $("#ctxMenu");
  function menu(anchor, items) {
    ctxMenu.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? "danger" : ""}">${esc(it.label)}</button>`).join("");
    ctx.hidden = false;
    const r = anchor.getBoundingClientRect(), mw = 230, mh = items.length * 46;
    const x = Math.min(window.innerWidth - mw - 10, Math.max(10, r.left + r.width / 2 - mw / 2));
    let y = r.bottom + 8;
    if (y + mh > window.innerHeight - 20) y = Math.max(10, r.top - mh - 8);
    ctxMenu.style.left = x + "px"; ctxMenu.style.top = y + "px";
    ctxMenu.style.transformOrigin = `${Math.round(r.left + r.width / 2 - x)}px ${y > r.top ? 0 : mh}px`;
    anchor.classList.add("ctx-on");
    void ctx.offsetWidth; ctx.classList.add("on");
    hap.select();
    ctxMenu.onclick = (e) => { const b = e.target.closest("[data-i]"); if (!b) return; hideMenu(); items[Number(b.dataset.i)].fn(); };
  }
  function hideMenu() {
    ctx.classList.remove("on");
    all(".ctx-on").forEach((x) => x.classList.remove("ctx-on"));
    setTimeout(() => { if (!ctx.classList.contains("on")) ctx.hidden = true; }, 180);
  }
  ctx.addEventListener("click", (e) => { if (e.target === ctx) hideMenu(); });

  function msgMenu(el, m) {
    const items = [];
    if (canPost()) items.push({ label: "Ответить", fn: () => setReply(m) });
    if (m.text) items.push({ label: "Копировать", fn: () => copy(m.text) });
    if (cur.can.pin) items.push({ label: cur.pinned && cur.pinned.id === m.id ? "Открепить" : "Закрепить", fn: () => pin(cur.pinned && cur.pinned.id === m.id ? 0 : m.id) });
    if (m.user.id !== myId && cur.kind !== "channel") items.push({ label: "Профиль", fn: () => openPanel(userScreen(m.user)) });
    if ((m.user.id === myId || cur.can.delete) && !m.gift) items.push({ label: "Удалить", danger: true, fn: () => del(m) });
    if (items.length) menu(el, items);
  }
  async function pin(id) {
    try { await call("POST", `/api/chat/${cur.id}/pin`, { msg: id }); hap.soft(); refreshChat(); pullMessages(false); } catch (e) { fail(e); }
  }
  async function del(m) {
    if (!(await confirmBox("Удалить сообщение у всех?"))) return;
    try {
      await call("POST", `/api/chat/${cur.id}/delete`, { msg: m.id });
      const row = msgsBox.querySelector(`[data-row="${m.id}"]`);
      if (row) { row.classList.add("gone"); await new Promise((r) => setTimeout(r, 220)); }
      m.kind = "deleted"; renderMsgs(false); hap.soft();
    } catch (e) { fail(e); }
  }
  function attachMenu() {
    const items = [];
    if (cur.kind === "channel" || cur.can.media) items.push({ label: "Фото", fn: sendPhoto });
    if (cur.kind === "dm" && cur.can.gifts) items.push({ label: "Подарок", fn: () => pickGift(cur.peer) });
    const mineGroups = chats.filter((c) => c.kind !== "dm" && c.id !== cur.id);
    if (mineGroups.length) items.push({ label: "Приглашение в группу или канал", fn: () => openPanel(pickChatScreen(mineGroups, "Пригласить в", (c) => sendInvite(cur.id, c.id))) });
    if (!items.length) return toast("Здесь можно только писать");
    menu($("#cvAttach"), items);
  }
  async function sendInvite(toChat, inviteId) {
    try {
      const m = await call("POST", `/api/chat/${toChat}/messages`, { invite: inviteId });
      closeSheet(); hap.win(); toast("Приглашение отправлено");
      if (cur && cur.id === toChat) { msgs.push(m); renderMsgs(true); } else openChat(toChat);
    } catch (e) { fail(e); }
  }

  // свайп влево по сообщению: ответить, как в Telegram
  let sw = null, swiped = false;
  msgsBox.addEventListener("pointerdown", (e) => {
    const r = e.target.closest(".m-row[data-row]"); if (!r || !canPost()) return;
    sw = { row: r, x: e.clientX, y: e.clientY, dx: 0, on: false };
  });
  msgsBox.addEventListener("pointermove", (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.on) { if (Math.abs(dy) > 10) { sw = null; return; } if (dx < -10) sw.on = true; else return; }
    sw.dx = Math.max(-80, Math.min(0, dx));
    sw.row.style.transform = `translateX(${sw.dx}px)`;
    const armed = sw.dx < -55;
    if (armed && !sw.row.classList.contains("armed")) hap.select();
    sw.row.classList.toggle("armed", armed);
  });
  const endSwipe = () => {
    if (!sw) return;
    const s = sw; sw = null;
    if (!s.on) return;
    s.row.style.transition = "transform .3s cubic-bezier(.2,.9,.3,1.25)"; s.row.style.transform = "";
    setTimeout(() => (s.row.style.transition = ""), 320);
    s.row.classList.remove("armed");
    swiped = true; setTimeout(() => (swiped = false), 60);
    if (s.dx < -55) { const m = msgs.find((x) => x.id === Number(s.row.dataset.row)); if (m) setReply(m); }
  };
  msgsBox.addEventListener("pointerup", endSwipe);
  msgsBox.addEventListener("pointercancel", endSwipe);

  // ---------- панель: профиль, чат, настройки (экраны со сдвигом, как в Telegram) ----------
  const panel = $("#panel"), stage = $("#pnStage");
  let stack = [];
  function openPanel(screen) {
    stack.forEach((s) => s.el.remove());
    stack = [];
    openSheet(panel);
    push(screen, true);
  }
  function push(screen, instant) {
    const el = document.createElement("div");
    el.className = "pn-screen" + (instant ? "" : " enter");
    stage.appendChild(el);
    const prev = stack[stack.length - 1];
    const s = { el, screen, conf: {} };
    stack.push(s);
    draw(s);
    if (!instant) { void el.offsetWidth; el.classList.remove("enter"); if (prev) prev.el.classList.add("behind"); }
  }
  function draw(s) {
    s.conf = s.screen(s.el) || {};
    if (stack[stack.length - 1] === s) head(s);
  }
  function head(s) {
    $("#pnTitle").textContent = s.conf.title || "";
    const back = $("#pnBack");
    back.innerHTML = stack.length > 1 ? `<svg viewBox="0 0 12 20"><path d="M10 2 2 10l8 8" /></svg>Назад` : "Закрыть";
    const act = $("#pnAct");
    act.textContent = s.conf.act ? s.conf.act.label : "";
    act.style.visibility = s.conf.act ? "" : "hidden";
  }
  function pop() {
    if (stack.length <= 1) return closeSheet();
    const s = stack.pop(), prev = stack[stack.length - 1];
    s.el.classList.add("leave");
    prev.el.classList.remove("behind");
    setTimeout(() => s.el.remove(), 320);
    draw(prev);   // экран под ним перерисовывается со свежими данными
  }
  $("#pnBack").addEventListener("click", pop);
  $("#pnAct").addEventListener("click", () => { const s = stack[stack.length - 1]; if (s && s.conf.act) s.conf.act.fn(); });
  A.sheetBack = (sheet) => { if (sheet === panel && stack.length > 1) { pop(); return true; } return false; };
  const row = (label, value, attrs = "", cls = "") => `<button class="row pn-row ${cls}" ${attrs}><span class="grow">${label}</span>${value != null && value !== "" ? `<span class="pn-val">${value}</span>` : ""}${chev}</button>`;
  const toggle = (label, key, on, dis) => `<label class="row pn-row"><span class="grow">${label}</span><input type="checkbox" class="sw" data-k="${key}" ${on ? "checked" : ""} ${dis ? "disabled" : ""}></label>`;
  const ACT = {
    dm: `<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" /></svg>`,
    gift: `<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M19 12v7H5v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></svg>`,
    link: `<svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>`,
    join: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>`,
    invite: `<svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="4" /><path d="M3 20c1-4 3.5-6 7-6s6 2 7 6M19 7v6M16 10h6" /></svg>`,
    gear: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>`,
    leave: `<svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>`,
  };
  const actBtn = (key, label, icon, cls = "") => `<button data-act="${key}" class="${cls}">${ACT[icon]}<span>${label}</span></button>`;

  // профиль игрока
  function userScreen(u0) {
    return (el) => {
      let u = u0;
      const paint = () => {
        const g = styleOf(u.look), mine = u.id === myId;
        const gifts = (u.gifts || []).filter((id) => byId[id]);
        el.innerHTML = `${cover(u.look, u.id, `${ava(u, "xl")}<h2>${esc(u.name)}${giftMark(u.look)}</h2><p class="${Date.now() / 1000 - u.seen < 120 ? "online" : ""}">${esc(seenText(u))}</p>`)}
          ${mine ? "" : `<div class="pn-acts">${actBtn("dm", "Сообщение", "dm")}${actBtn("gift", "Подарок", "gift")}${u.handle ? actBtn("copy", "Ссылка", "link") : ""}</div>`}
          ${u.handle || u.bio || g ? `<section class="list pn-info">
            ${u.handle ? `<button class="pn-line" data-act="copy"><b>@${esc(u.handle)}</b><span>имя пользователя</span></button>` : ""}
            ${u.bio ? `<div class="pn-line"><b class="pre">${esc(u.bio)}</b><span>о себе</span></div>` : ""}
            ${g ? `<div class="pn-line"><b>${esc(g.gift)} ✦</b><span>особый стиль коллекции</span></div>` : ""}
          </section>` : ""}
          ${gifts.length ? `<h4 class="sec-title">Подарки · ${gifts.length}</h4><div class="pn-gifts">${gifts.map((id) => `<button class="pn-gift" data-g="${id}" style="${A.bg(byId[id])}"><i class="pat"></i>${A.pic(byId[id])}<i class="pn-gnum">#${byId[id].num}</i></button>`).join("")}</div>` : ""}`;
      };
      el.onclick = async (e) => {
        const b = e.target.closest("[data-act]"), gb = e.target.closest("[data-g]");
        if (gb) return A.openGift(byId[gb.dataset.g], null);
        if (!b) return;
        if (b.dataset.act === "dm") { try { const c = await call("POST", "/api/dm", { user: u.id }); openChat(c.id); } catch (er) { fail(er); } }
        if (b.dataset.act === "gift") pickGift(u);
        if (b.dataset.act === "copy") copy("@" + u.handle, "Имя пользователя скопировано");
      };
      paint();
      call("GET", `/api/user/${u.id}`).then((x) => { u = x; if (el.isConnected) paint(); }).catch(() => {});
      return { title: "" };
    };
  }

  // экран группы или канала
  function chatScreen(c0) {
    return (el) => {
      let c = c0, list = [];
      const role = { owner: "владелец", admin: "админ" };
      const paint = () => {
        const showMembers = c.kind === "group" || (c.can && (c.can.ban || c.can.promote));
        el.innerHTML = `${cover(c.look, c.id + 7, `${chatAva(c, "xl")}<h2>${esc(c.title)}</h2><p>${kindName(c)} · ${members(c)}</p>`)}
          <div class="pn-acts">
            ${c.role ? actBtn("open", c.kind === "channel" ? "Канал" : "Чат", "dm") : actBtn("join", c.kind === "channel" ? "Подписаться" : "Вступить", "join")}
            ${actBtn("invite", "Пригласить", "invite")}
            ${c.can && c.can.info ? actBtn("settings", "Изменить", "gear") : ""}
            ${c.role && c.role !== "owner" ? actBtn("leave", "Выйти", "leave", "danger") : ""}
          </div>
          <section class="list pn-info">
            ${c.handle ? `<button class="pn-line" data-act="copylink"><b>@${esc(c.handle)}</b><span>публичная ссылка</span></button>` : ""}
            ${c.about ? `<div class="pn-line"><b class="pre">${esc(c.about)}</b><span>описание</span></div>` : ""}
            ${c.owner_card ? `<button class="pn-line" data-user="${c.owner_card.id}"><b>${esc(c.owner_card.name)}${c.owner_card.handle ? ` <i class="hint">@${esc(c.owner_card.handle)}</i>` : ""}</b><span>владелец</span></button>` : ""}
          </section>
          ${showMembers && list.length ? `<h4 class="sec-title">${c.kind === "channel" ? "Подписчики" : "Участники"} · ${list.length}</h4>
            <section class="list ch-list">${list.map((u) => `<button class="ch-row slim" data-user="${u.id}">${ava(u, "sm2")}<span class="ch-main"><span class="ch-l1"><b>${esc(u.name)}${giftMark(u.look)}</b>${u.title || role[u.role] ? `<i class="m-role">${esc(u.title || role[u.role])}</i>` : ""}</span><span class="ch-l2"><span class="ch-prev ${Date.now() / 1000 - u.seen < 120 ? "online" : ""}">${esc(seenText(u))}</span></span></span></button>`).join("")}</section>` : ""}`;
      };
      el.onclick = async (e) => {
        const b = e.target.closest("[data-act]"), ub = e.target.closest("[data-user]");
        if (ub) { const u = list.find((x) => x.id === Number(ub.dataset.user)) || c.owner_card; if (u && u.id !== myId) push(userScreen(u)); return; }
        if (!b) return;
        const a = b.dataset.act;
        if (a === "join") { try { await call("POST", `/api/chat/${c.id}/join`, {}); hap.win(); openChat(c.id); } catch (er) { fail(er); } }
        if (a === "open") { if (cur && cur.id === c.id) closeSheet(); else openChat(c.id); }
        if (a === "invite") push(inviteScreen(c));
        if (a === "settings") push(settingsScreen(c));
        if (a === "copylink") copy("@" + c.handle, "Ссылка скопирована");
        if (a === "leave") {
          if (!(await confirmBox(c.kind === "channel" ? "Отписаться от канала?" : "Выйти из группы?"))) return;
          try { await call("POST", `/api/chat/${c.id}/leave`, {}); closeSheet(); closeChat(); } catch (er) { fail(er); }
        }
      };
      paint();
      Promise.all([call("GET", `/api/chat/${c.id}`), call("GET", `/api/chat/${c.id}/members`).catch(() => ({ members: [] }))])
        .then(([x, m]) => { c = x; list = m.members; if (el.isConnected) paint(); }).catch(() => {});
      return { title: "" };
    };
  }

  // приглашение: карточка в Telegram, в чат DuckChance или ссылкой
  function inviteScreen(c) {
    return (el) => {
      const link = A.BOT_USERNAME ? `https://t.me/${A.BOT_USERNAME}?start=chat_${c.id}` : "";
      el.innerHTML = `<div class="pn-pad"><div class="msg invite solo">${inviteCard({ ...c, owner: c.owner_card || {} })}</div></div>
        <section class="list">
          ${row("Отправить в Telegram", null, 'data-act="tg"')}
          ${row("Отправить в чат DuckChance", null, 'data-act="app"')}
          ${row("Скопировать ссылку", null, 'data-act="copy"')}
        </section><p class="pn-note">В Telegram уйдёт такая же карточка: обложка, название, описание и владелец. По кнопке человек попадёт в ${c.kind === "channel" ? "канал" : "группу"}.</p>`;
      el.onclick = (e) => {
        const b = e.target.closest("[data-act]"); if (!b) return;
        if (b.dataset.act === "copy") copy(link, "Ссылка скопирована");
        if (b.dataset.act === "app") push(pickChatScreen(chats.filter((x) => x.id !== c.id), "Отправить в", (to) => sendInvite(to.id, c.id)));
        if (b.dataset.act === "tg") shareInvite(c, link);
      };
      return { title: "Пригласить" };
    };
  }
  function pickChatScreen(list, title, fn) {
    return (el) => {
      el.innerHTML = list.length ? `<section class="list ch-list">${list.map((c) => `<button class="ch-row slim" data-chat="${c.id}">${chatAva(c, "sm2")}<span class="ch-main"><span class="ch-l1"><b>${chatName(c)}</b></span><span class="ch-l2"><span class="ch-prev">${c.kind === "dm" ? esc(at(c.peer) || "личный чат") : members(c)}</span></span></span></button>`).join("")}</section>`
        : `<div class="ch-empty">Чатов пока нет</div>`;
      el.onclick = (e) => { const b = e.target.closest("[data-chat]"); if (b) fn(list.find((c) => c.id === Number(b.dataset.chat))); };
      return { title };
    };
  }

  // карточка-приглашение для Telegram: рисуем на canvas, бот отправляет её как фото с кнопкой
  async function drawInvite(c) {
    const W = 1200, H = 675, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const x = cv.getContext("2d"), l = safeLook(c.look), h = hue(c.id + 7);
    const c1 = l ? l.c1 : `hsl(${h},62%,62%)`, c2 = l ? l.c2 : `hsl(${h},58%,44%)`, cp = l ? l.cp : `hsl(${h},60%,30%)`;
    const cx = 300, cy = H / 2, F = "-apple-system, system-ui, sans-serif";
    const bgG = x.createRadialGradient(cx, cy, 40, cx, cy, 900); bgG.addColorStop(0, c1); bgG.addColorStop(1, c2);
    x.fillStyle = bgG; x.fillRect(0, 0, W, H);
    if (l && l.sym) {
      try {
        const sym = await loadImg(l.sym, true), t = document.createElement("canvas"); t.width = t.height = 96;
        const tx = t.getContext("2d"); tx.drawImage(sym, 0, 0, 96, 96); tx.globalCompositeOperation = "source-in"; tx.fillStyle = cp; tx.fillRect(0, 0, 96, 96);
        [[190, 8, .5, 58], [280, 12, .34, 52], [380, 16, .2, 46], [490, 22, .11, 40], [610, 28, .06, 36]].forEach(([r, n, o, s], k) => {
          for (let i = 0; i < n; i++) { const a = (i + (k % 2) * .5) / n * Math.PI * 2; x.globalAlpha = o; x.drawImage(t, cx + Math.cos(a) * r - s / 2, cy + Math.sin(a) * r * .82 - s / 2, s, s); }
        });
        x.globalAlpha = 1;
      } catch {}
    }
    x.save(); x.beginPath(); x.arc(cx, cy, 130, 0, Math.PI * 2); x.closePath();
    x.shadowColor = "rgba(0,0,0,.25)"; x.shadowBlur = 30; x.fillStyle = `hsl(${h},60%,55%)`; x.fill(); x.shadowBlur = 0; x.clip();
    let drew = false;
    if (photoOk(c.photo)) try { x.drawImage(await loadImg(c.photo, true), cx - 130, cy - 130, 260, 260); drew = true; } catch {}
    if (!drew) { x.fillStyle = "#fff"; x.font = `600 120px ${F}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(c.title.trim().charAt(0).toUpperCase(), cx, cy + 6); }
    x.restore();
    x.lineWidth = 8; x.strokeStyle = "rgba(255,255,255,.85)"; x.beginPath(); x.arc(cx, cy, 134, 0, Math.PI * 2); x.stroke();
    const g = l && l.gift && byId[l.gift];
    if (g) try { x.drawImage(await loadImg(g.img, true), cx + 64, cy + 50, 120, 120); } catch {}
    const L = 560, maxW = W - L - 70;
    const wrap = (text, font, lh, max, y0) => {
      x.font = font; const words = String(text).split(/\s+/); let line = "", y = y0, n = 0;
      for (let i = 0; i < words.length; i++) {
        const test = line ? line + " " + words[i] : words[i];
        if (x.measureText(test).width > maxW && line) { if (++n >= max) { x.fillText(line + "…", L, y); return y + lh; } x.fillText(line, L, y); y += lh; line = words[i]; }
        else line = test;
      }
      if (line) { x.fillText(line, L, y); y += lh; }
      return y;
    };
    x.textAlign = "left"; x.textBaseline = "alphabetic"; x.fillStyle = "rgba(255,255,255,.78)";
    x.font = `600 30px ${F}`; x.fillText(`${kindName(c).toUpperCase()} · ${members(c).toUpperCase()}`, L, 190);
    x.fillStyle = "#fff";
    let y = wrap(c.title, `700 66px ${F}`, 74, 2, 270);
    if (c.about) { x.fillStyle = "rgba(255,255,255,.9)"; y = wrap(c.about, `400 34px ${F}`, 44, 3, y + 14); }
    const own = c.owner_card || c.owner;
    if (own && own.name) { x.fillStyle = "rgba(255,255,255,.8)"; x.font = `500 30px ${F}`; x.fillText(`Владелец: ${own.name}${own.handle ? "  @" + own.handle : ""}`, L, Math.min(H - 120, y + 40)); }
    x.fillStyle = "rgba(255,255,255,.95)"; x.beginPath(); if (x.roundRect) x.roundRect(L, H - 94, 260, 62, 31); else x.rect(L, H - 94, 260, 62); x.fill();
    x.fillStyle = c2; x.font = `700 28px ${F}`; x.textAlign = "center"; x.fillText(c.kind === "channel" ? "Подписаться" : "Вступить", L + 130, H - 53);
    x.fillStyle = "rgba(255,255,255,.7)"; x.font = `600 26px ${F}`; x.textAlign = "right"; x.fillText("DuckChance", W - 50, H - 52);
    return cv.toDataURL("image/jpeg", 0.9);
  }
  async function shareInvite(c, link) {
    const fallback = () => {
      const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`${kindName(c)} «${c.title}» в DuckChance`)}`;
      if (inTg) try { return tg.openTelegramLink(url); } catch {}
      window.open(url, "_blank");
    };
    if (!inTg || !tg.shareMessage) return fallback();
    try {
      toast("Готовим карточку…");
      const image = await drawInvite(c);
      const r = await call("POST", `/api/chat/${c.id}/share`, { image });
      tg.shareMessage(r.id, (ok) => { if (ok) { hap.win(); toast("Приглашение отправлено"); } });
    } catch (e) { fallback(); }
  }
  A.drawInvite = drawInvite;   // для проверки карточки

  // настройки группы или канала
  function settingsScreen(c) {
    return (el) => {
      const d = { title: c.title, about: c.about || "", photo: c.photo || "", look: c.look, handle: c.handle || "" };
      let hState = "";
      const hint = "По ссылке группу находят через поиск. Латиница, цифры и подчёркивание, от 4 символов.";
      const gifts = [...new Set([...st().inv].sort((a, b) => byId[b.id].price - byId[a.id].price).map((x) => x.id))];
      const paint = () => {
        const l = safeLook(d.look);
        el.innerHTML = `<div class="st-top">${cover(d.look, c.id + 7, `${chatAva({ ...c, photo: d.photo, title: d.title || c.title }, "xl")}`, "sm")}
            <div class="st-photo-row"><button class="st-photo" data-act="photo">${d.photo ? "Изменить фото" : "Выбрать фото"}</button>${d.photo ? `<button class="st-photo danger" data-act="nophoto">Удалить</button>` : ""}</div></div>
          <section class="list st-form">
            <input class="st-in" data-f="title" maxlength="48" placeholder="Название" value="${esc(d.title)}">
            <textarea class="st-in" data-f="about" maxlength="255" rows="2" placeholder="Описание">${esc(d.about)}</textarea>
          </section>
          <h4 class="sec-title">Публичная ссылка</h4>
          <section class="list st-form"><label class="st-handle"><span>@</span><input class="st-in" data-f="handle" maxlength="24" placeholder="ссылка" value="${esc(d.handle)}" autocapitalize="off" autocomplete="off" spellcheck="false"></label></section>
          <p class="pn-note st-hint">${hState || hint}</p>
          <h4 class="sec-title">Обложка</h4>
          <div class="st-looks">
            <button class="st-look none ${!l ? "on" : ""}" data-look="-1">Нет</button>
            ${gifts.map((id) => `<button class="st-look ${l && l.gift === id ? "on" : ""} ${SPECIAL.has(byId[id].gift) ? "special" : ""}" data-gl="${id}">${A.chip(byId[id])}</button>`).join("")}
            ${BACKDROPS.map((b, i) => `<button class="st-look color ${l && !l.gift && l.c1 === b.c1 ? "on" : ""}" data-bl="${i}" style="background:radial-gradient(circle at 50% 35%, ${b.c1}, ${b.c2})"></button>`).join("")}
          </div>
          <p class="pn-note">Обложку видно в профиле ${c.kind === "channel" ? "канала" : "группы"}, на фоне чата и на карточках приглашений.</p>
          <section class="list">
            ${c.kind === "group" && c.can.ban ? row("Разрешения", `${Object.values(c.perms || {}).filter(Boolean).length}/5`, 'data-act="perms"') : ""}
            ${c.can.promote ? row("Администраторы", "", 'data-act="admins"') : ""}
            ${row(c.kind === "channel" ? "Подписчики" : "Участники", fmt(c.members), 'data-act="members"')}
            ${c.can.ban ? row("Чёрный список", "", 'data-act="bans"') : ""}
          </section>
          ${c.role === "owner" ? `<section class="list"><button class="row pn-row danger" data-act="drop">Удалить ${c.kind === "channel" ? "канал" : "группу"}</button></section>` : ""}`;
      };
      paint();
      let hT = null;
      el.oninput = (e) => {
        const f = e.target.dataset.f; if (!f) return;
        d[f] = e.target.value;
        if (f !== "handle") return;
        clearTimeout(hT);
        const h = d.handle.trim().replace(/^@/, "");
        hT = setTimeout(async () => {
          if (!h || h === c.handle) hState = "";
          else try { const r = await call("GET", "/api/handle?h=" + encodeURIComponent(h)); hState = !r.valid ? `<span class="bad">Только латиница, цифры и _, от 4 до 24 символов</span>` : r.free ? `<span class="ok">@${esc(h)} свободно</span>` : `<span class="bad">@${esc(h)} занято</span>`; } catch {}
          const n = el.querySelector(".st-hint"); if (n) n.innerHTML = hState || hint;
        }, 350);
      };
      el.onclick = async (e) => {
        const b = e.target.closest("[data-act],[data-look],[data-gl],[data-bl]"); if (!b) return;
        if (b.dataset.look) { d.look = null; hap.select(); return paint(); }
        if (b.dataset.gl) { const g = byId[b.dataset.gl]; d.look = { c1: g.c1, c2: g.c2, cp: g.cp, sym: g.sym, gift: g.id }; hap.select(); return paint(); }
        if (b.dataset.bl) { const k = BACKDROPS[Number(b.dataset.bl)]; d.look = { c1: k.c1, c2: k.c2, cp: k.cp, sym: k.sym }; hap.select(); return paint(); }
        const a = b.dataset.act;
        if (a === "photo") { try { const ph = await upload(640, true); if (ph) { d.photo = ph.url; paint(); } } catch (er) { fail(er); } }
        if (a === "nophoto") { d.photo = ""; paint(); }
        if (a === "perms") push(permsScreen(c));
        if (a === "admins") push(adminsScreen(c));
        if (a === "members") push(membersScreen(c, false));
        if (a === "bans") push(membersScreen(c, true));
        if (a === "drop") {
          if (!(await confirmBox(`Удалить ${c.kind === "channel" ? "канал" : "группу"} «${c.title}» навсегда? Все сообщения пропадут.`))) return;
          try { await call("POST", `/api/chat/${c.id}/drop`, {}); closeSheet(); closeChat(); toast("Удалено"); } catch (er) { fail(er); }
        }
      };
      return { title: "Изменить", act: { label: "Готово", fn: async () => {
        const body = {};
        if (d.title.trim() !== c.title) body.title = d.title.trim();
        if (d.about.trim() !== (c.about || "")) body.about = d.about.trim();
        if ((d.photo || "") !== (c.photo || "")) body.photo = d.photo || "";
        if (JSON.stringify(d.look || null) !== JSON.stringify(c.look || null)) body.look = d.look;
        if (d.handle.trim().replace(/^@/, "") !== (c.handle || "")) body.handle = d.handle.trim().replace(/^@/, "");
        if (!Object.keys(body).length) return pop();
        if (body.title === "") return toast("Введите название");
        try { Object.assign(c, await call("POST", `/api/chat/${c.id}/edit`, body)); hap.win(); toast("Сохранено"); refreshChat(); pop(); } catch (er) { fail(er); }
      } } };
    };
  }
  const PERM_LABELS = { send: "Отправка сообщений", media: "Отправка фото", gifts: "Отправка подарков", invite: "Добавление участников", pin: "Закрепление сообщений" };
  const RIGHT_LABELS = { info: "Изменение профиля", post: "Публикация сообщений", delete: "Удаление сообщений", ban: "Блокировка участников", invite: "Пригласительные ссылки", pin: "Закрепление сообщений", promote: "Назначение администраторов" };
  function permsScreen(c) {
    return (el) => {
      const perms = { ...c.perms };
      el.innerHTML = `<h4 class="sec-title">Что могут участники</h4><section class="list">${Object.keys(PERM_LABELS).map((k) => toggle(PERM_LABELS[k], k, perms[k])).join("")}</section>
        <p class="pn-note">Владелец и администраторы могут всё это всегда.</p>`;
      el.onchange = async (e) => {
        const k = e.target.dataset.k; if (!k) return;
        perms[k] = e.target.checked; hap.select();
        try { Object.assign(c, await call("POST", `/api/chat/${c.id}/edit`, { perms })); refreshChat(); } catch (er) { e.target.checked = !e.target.checked; perms[k] = e.target.checked; fail(er); }
      };
      return { title: "Разрешения" };
    };
  }
  const loadRolesIf = (c) => { if (cur && cur.id === c.id && c.kind === "group") loadRoles(); };
  function adminsScreen(c) {
    return (el) => {
      el.innerHTML = `<div class="ch-empty">Загружаем…</div>`;
      call("GET", `/api/chat/${c.id}/members`).then(({ members: list }) => {
        if (!el.isConnected) return;
        const admins = list.filter((u) => u.role !== "member");
        el.innerHTML = `<section class="list ch-list">${admins.map((u) => `<button class="ch-row slim" data-user="${u.id}">${ava(u, "sm2")}<span class="ch-main"><span class="ch-l1"><b>${esc(u.name)}</b>${u.title ? `<i class="m-role">${esc(u.title)}</i>` : ""}</span><span class="ch-l2"><span class="ch-prev">${u.role === "owner" ? "владелец" : "администратор"}</span></span></span></button>`).join("")}</section>
          <section class="list">${row("Добавить администратора", null, 'data-act="add"', "accent")}</section>
          <p class="pn-note">Админу можно дать префикс: короткую подпись рядом с именем в сообщениях, например «модератор».</p>`;
        el.onclick = (e) => {
          if (e.target.closest('[data-act="add"]')) return push(pickMemberScreen(list.filter((u) => u.role === "member"), (u) => push(adminScreen(c, u))));
          const b = e.target.closest("[data-user]"); if (!b) return;
          const u = list.find((x) => x.id === Number(b.dataset.user)); if (!u) return;
          if (u.role === "admin") push(adminScreen(c, u)); else if (u.role === "owner" && u.id === myId) push(titleScreen(c, u));
        };
      }).catch(fail);
      return { title: "Администраторы" };
    };
  }
  function pickMemberScreen(list, fn) {
    return (el) => {
      el.innerHTML = list.length ? `<section class="list ch-list">${list.map(userRow).join("")}</section>` : `<div class="ch-empty">Нет участников, кого можно назначить</div>`;
      el.onclick = (e) => { const b = e.target.closest("[data-user]"); if (b) fn(list.find((u) => u.id === Number(b.dataset.user))); };
      return { title: "Выберите участника" };
    };
  }
  function adminScreen(c, u) {
    return (el) => {
      const isAdmin = u.role === "admin";
      const rights = isAdmin ? { ...u.rights } : { info: true, post: true, delete: true, ban: true, invite: true, pin: true, promote: false };
      let title = u.title || "";
      const keys = Object.keys(RIGHT_LABELS).filter((k) => k !== "post" || c.kind === "channel");
      el.innerHTML = `<div class="pn-who">${ava(u, "lg")}<b>${esc(u.name)}${giftMark(u.look)}</b><span>${esc(at(u) || seenText(u))}</span></div>
        <h4 class="sec-title">Префикс</h4><section class="list st-form"><input class="st-in" data-f="title" maxlength="16" placeholder="админ" value="${esc(title)}"></section>
        <p class="pn-note">Виден рядом с именем в сообщениях вместо слова «админ».</p>
        <h4 class="sec-title">Что может этот администратор</h4>
        <section class="list">${keys.map((k) => toggle(RIGHT_LABELS[k], k, rights[k], c.role !== "owner" && !(c.can && c.can[k]))).join("")}</section>
        ${isAdmin ? `<section class="list"><button class="row pn-row danger" data-act="demote">Разжаловать</button></section>` : ""}`;
      el.oninput = (e) => { if (e.target.dataset.f === "title") title = e.target.value; };
      el.onchange = (e) => { const k = e.target.dataset.k; if (k) { rights[k] = e.target.checked; hap.select(); } };
      el.onclick = async (e) => {
        if (!e.target.closest('[data-act="demote"]')) return;
        if (!(await confirmBox(`Снять ${u.name} с поста администратора?`))) return;
        try { await call("POST", `/api/chat/${c.id}/admin`, { user: u.id, demote: true }); hap.soft(); loadRolesIf(c); pop(); } catch (er) { fail(er); }
      };
      return { title: isAdmin ? "Права админа" : "Новый админ", act: { label: "Готово", fn: async () => {
        try {
          await call("POST", `/api/chat/${c.id}/admin`, { user: u.id, rights, title: title.trim() });
          hap.win(); toast(isAdmin ? "Права сохранены" : `${u.name} теперь администратор`); loadRolesIf(c);
          if (!isAdmin) stack.splice(stack.length - 2, 1)[0].el.remove();   // убираем экран выбора участника
          pop();
        } catch (er) { fail(er); }
      } } };
    };
  }
  function titleScreen(c, u) {   // префикс владельца или участника
    return (el) => {
      let title = u.title || "";
      el.innerHTML = `<div class="pn-who">${ava(u, "lg")}<b>${esc(u.name)}</b><span>${u.role === "owner" ? "владелец" : "участник"}</span></div>
        <h4 class="sec-title">Префикс</h4><section class="list st-form"><input class="st-in" data-f="title" maxlength="16" placeholder="${u.role === "owner" ? "владелец" : "без префикса"}" value="${esc(title)}"></section>
        <p class="pn-note">Виден рядом с именем в сообщениях группы.</p>`;
      el.oninput = (e) => { if (e.target.dataset.f === "title") title = e.target.value; };
      return { title: "Префикс", act: { label: "Готово", fn: async () => {
        try { await call("POST", `/api/chat/${c.id}/title`, { user: u.id, title: title.trim() }); hap.win(); loadRolesIf(c); pop(); } catch (er) { fail(er); }
      } } };
    };
  }
  function membersScreen(c, banned) {
    return (el) => {
      el.innerHTML = `<div class="ch-empty">Загружаем…</div>`;
      const role = { owner: "владелец", admin: "админ" };
      const kick = async (u, ban) => {
        if (!(await confirmBox(ban ? `Заблокировать ${u.name}? Вернуться он не сможет.` : `Удалить ${u.name}?`))) return;
        try { await call("POST", `/api/chat/${c.id}/ban`, { user: u.id, ban }); hap.soft(); c.members = Math.max(0, c.members - 1); load(); } catch (er) { fail(er); }
      };
      const load = () => call("GET", `/api/chat/${c.id}/members`).then((r) => {
        if (!el.isConnected) return;
        const list = banned ? r.banned : r.members;
        el.innerHTML = list.length ? `<section class="list ch-list">${list.map((u) => `<button class="ch-row slim" data-user="${u.id}">${ava(u, "sm2")}<span class="ch-main"><span class="ch-l1"><b>${esc(u.name)}${giftMark(u.look)}</b>${u.title || role[u.role] ? `<i class="m-role">${esc(u.title || role[u.role])}</i>` : ""}</span><span class="ch-l2"><span class="ch-prev">${esc(at(u) || seenText(u))}</span></span></span></button>`).join("")}</section>`
          : `<div class="ch-empty">${banned ? "Никто не заблокирован" : "Пока никого"}</div>`;
        el.onclick = (e) => {
          const b = e.target.closest("[data-user]"); if (!b) return;
          const u = list.find((x) => x.id === Number(b.dataset.user)); if (!u) return;
          if (banned) return menu(b, [{ label: "Разблокировать", fn: async () => { try { await call("POST", `/api/chat/${c.id}/ban`, { user: u.id, unban: true }); hap.soft(); load(); } catch (er) { fail(er); } } }]);
          const items = [];
          if (u.id !== myId) items.push({ label: "Профиль", fn: () => push(userScreen(u)) });
          if (c.can.promote && u.role === "member") items.push({ label: "Назначить администратором", fn: () => push(adminScreen(c, u)) });
          if (c.can.promote && c.kind === "group" && (u.role === "member" || (u.role === "owner" && u.id === myId))) items.push({ label: "Префикс", fn: () => push(titleScreen(c, u)) });
          if ((c.can.ban && u.role === "member") || (c.role === "owner" && u.role === "admin")) {
            items.push({ label: `Удалить из ${c.kind === "channel" ? "канала" : "группы"}`, danger: true, fn: () => kick(u, false) });
            items.push({ label: "Заблокировать", danger: true, fn: () => kick(u, true) });
          }
          if (items.length) menu(b, items);
        };
      }).catch(fail);
      load();
      return { title: banned ? "Чёрный список" : c.kind === "channel" ? "Подписчики" : "Участники" };
    };
  }

  // свой юзернейм и «о себе»
  function handleScreen() {
    return (el) => {
      let h = (me && me.handle) || "", bio = (me && me.bio) || "", state = "";
      const rules = "Латиница, цифры и подчёркивание, от 4 символов. По этому имени вас найдут в поиске, оно уникально.";
      el.innerHTML = `<div class="pn-who">${ava({ id: myId, name: user ? user.first_name : "Вы", photo: user && user.photo_url, look: A.bannerLook() }, "lg")}<b>${esc(user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "Вы")}</b><span>${h ? "@" + esc(h) : "имя пользователя не задано"}</span></div>
        <h4 class="sec-title">Имя пользователя</h4>
        <section class="list st-form"><label class="st-handle"><span>@</span><input class="st-in" data-f="h" maxlength="24" placeholder="имя" value="${esc(h)}" autocapitalize="off" autocomplete="off" spellcheck="false"></label></section>
        <p class="pn-note st-hint">${rules}</p>
        <h4 class="sec-title">О себе</h4>
        <section class="list st-form"><textarea class="st-in" data-f="bio" maxlength="140" rows="3" placeholder="Пара слов о себе">${esc(bio)}</textarea></section>`;
      let t = null;
      el.oninput = (e) => {
        if (e.target.dataset.f === "bio") { bio = e.target.value; return; }
        if (e.target.dataset.f !== "h") return;
        h = e.target.value.trim().replace(/^@/, "");
        clearTimeout(t);
        t = setTimeout(async () => {
          if (!h || h === (me && me.handle)) state = "";
          else try { const r = await call("GET", "/api/handle?h=" + encodeURIComponent(h)); state = !r.valid ? `<span class="bad">Только латиница, цифры и _, от 4 до 24 символов</span>` : r.free ? `<span class="ok">@${esc(h)} свободно</span>` : `<span class="bad">@${esc(h)} уже занято</span>`; } catch {}
          el.querySelector(".st-hint").innerHTML = state || rules;
        }, 350);
      };
      return { title: "Профиль", act: { label: "Готово", fn: async () => {
        try {
          if (h !== ((me && me.handle) || "")) me = (await call("POST", "/api/handle", { handle: h })).me;
          if (bio !== ((me && me.bio) || "")) me = (await call("POST", "/api/me", { bio })).me;
          paintHandle(); hap.win(); toast("Сохранено"); closeSheet();
        } catch (er) { fail(er); }
      } } };
    };
  }
  function paintHandle() { $("#handleVal").textContent = me && me.handle ? "@" + me.handle : canUse ? "не задано" : ""; }

  // ---------- передача подарков ----------
  const pick = $("#pickSheet");
  let pickMode = null, pickPeer = null, pickUid = null;
  function pickGift(peer) {
    pickMode = "gift"; pickPeer = peer;
    $("#pkTitle").textContent = `Подарок для ${peer.name}`;
    $("#pkTools").hidden = true;
    const items = st().inv.filter((it) => !it.stake).sort((a, b) => byId[b.id].price - byId[a.id].price);
    $("#pkBody").innerHTML = items.length ? `<div class="grid">${items.map((it) => A.invTile(it)).join("")}</div>`
      : `<div class="ch-empty">Свободных подарков нет. Подарки в стейкинге передать нельзя.</div>`;
    openSheet(pick);
  }
  function pickUser(uid) {
    pickMode = "user"; pickUid = uid;
    $("#pkTitle").textContent = "Кому передать";
    $("#pkTools").hidden = false; $("#pkSearch").value = "";
    renderPickUsers(chats.filter((c) => c.kind === "dm").map((c) => c.peer), "Недавние");
    openSheet(pick);
  }
  function renderPickUsers(users, title) {
    found = Object.fromEntries(users.map((u) => [u.id, u]));
    $("#pkBody").innerHTML = users.length ? `<h4 class="sec-title">${title}</h4><section class="list ch-list">${users.map(userRow).join("")}</section>`
      : `<div class="ch-empty">Введите имя или @ник игрока</div>`;
  }
  let pkT = null;
  $("#pkSearch").addEventListener("input", () => {
    clearTimeout(pkT);
    const qs = $("#pkSearch").value.trim();
    pkT = setTimeout(async () => {
      if (qs.length < 2) return renderPickUsers(chats.filter((c) => c.kind === "dm").map((c) => c.peer), "Недавние");
      try { renderPickUsers((await call("GET", "/api/search?q=" + encodeURIComponent(qs))).users, "Игроки"); } catch (e) { fail(e); }
    }, 300);
  });
  $("#pkBody").addEventListener("click", (e) => {
    if (A.pressed) return;
    if (pickMode === "gift") { const t = e.target.closest("[data-uid]"); if (t) transferSheet(Number(t.dataset.uid), pickPeer); }
    else { const u = e.target.closest("[data-user]"); if (u && found[u.dataset.user]) transferSheet(pickUid, found[u.dataset.user]); }
  });
  // окно передачи, как в Telegram: подарок, от кого и кому, необратимость
  let sdAnim = null;
  function transferSheet(uid, peer) {
    const it = st().inv.find((x) => x.uid === uid);
    if (!it) return;
    if (it.stake) return toast("Подарок в стейкинге");
    const s = byId[it.id];
    const meCard = { id: myId, name: user ? user.first_name : "Вы", photo: user && user.photo_url, look: A.bannerLook() };
    $("#sdBody").innerHTML = `<div class="sd-art" style="${A.bg(s)}"><i class="pat"></i><span class="anim"></span>${A.pic(s, true)}</div>
      <div class="sd-name"><b>${esc(s.gift)}</b><span>#${s.num}</span></div>
      <div class="sd-attrs"><span><i>Модель</i>${esc(s.model)}</span><span><i>Фон</i>${esc(s.backdrop)}</span><span><i>Символ</i>${esc(s.symbol)}</span></div>
      <div class="sd-flow"><span class="sd-p">${ava(meCard, "lg")}<i>Вы</i></span><svg viewBox="0 0 48 24"><path d="M2 12h40M34 4l8 8-8 8" /></svg><span class="sd-p">${ava(peer, "lg")}<i>${esc(peer.name)}</i></span></div>
      <section class="list sd-rows">
        <div class="row"><span class="grow">Получатель</span><b>${esc(peer.handle ? "@" + peer.handle : peer.name)}</b></div>
        <div class="row"><span class="grow">Цена подарка</span><b class="sd-star">${STAR} ${fmt(s.price)}</b></div>
        <div class="row"><span class="grow">Комиссия</span><b class="ok">Бесплатно</b></div>
      </section>
      <p class="sd-text">После передачи подарок пропадёт из вашей коллекции. Отменить передачу будет нельзя.</p>
      <button class="cta inline" id="sdGo">Передать</button>`;
    openSheet($("#sendSheet"));
    if (sdAnim) { try { sdAnim.destroy(); } catch {} sdAnim = null; }
    if (!A.REDUCED && window.lottie && s.anim) {
      fetch(s.anim).then((r) => r.ok ? r.json() : Promise.reject()).then((data) => {
        const box = $("#sdBody .anim"); if (!box) return;
        sdAnim = window.lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: true, animationData: data });
        sdAnim.addEventListener("DOMLoaded", () => $("#sdBody .sd-art").classList.add("playing"));
      }).catch(() => {});
    }
    $("#sdGo").onclick = () => sendGift(uid, peer);
  }
  async function sendGift(uid, peer) {
    const it = st().inv.find((x) => x.uid === uid);
    if (!it || it.stake) return;
    const s = byId[it.id], btn = $("#sdGo");
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    let r;
    try { r = await call("POST", "/api/gift/send", { to: peer.id, gift: it.id }); } catch (e) { btn.disabled = false; btn.textContent = "Передать"; return fail(e); }
    // подарок уходит из инвентаря только после ответа сервера
    st().inv = st().inv.filter((x) => x.uid !== uid);
    A.stake.uids.delete(uid);
    A.save(); A.renderStake(); A.renderProfile(); A.renderTasks();
    closeSheet(); hap.win(); toast(`${s.gift} передан ${peer.name}`);
    syncMe(false);
    if (cur && cur.id === r.chat) pullMessages(false); else openChat(r.chat);
  }
  // входящие подарки забираются автоматически: сервер отдаёт каждый ровно один раз
  let claiming = false;
  async function claimIncoming() {
    if (!canUse || claiming) return;
    claiming = true;
    try {
      const { gifts } = await call("GET", "/api/gift/incoming");
      for (const g of gifts) {
        if (!byId[g.gift]) continue;
        try { await call("POST", `/api/gift/claim/${g.id}`, {}); } catch { continue; }
        A.grant(byId[g.gift]);
        hap.win(); toast(`${g.from.name} подарил вам ${byId[g.gift].gift}`);
      }
      if (gifts.length) { A.renderStake(); A.renderProfile(); A.renderTasks(); syncMe(false); }
    } catch {} finally { claiming = false; }
  }

  // ---------- стейкинг ----------
  const DAY = 86400000;
  const PLANS = [{ d: 7, r: 0.005 }, { d: 14, r: 0.012 }, { d: 30, r: 0.03 }];
  const reward = (s, p) => Math.max(1, Math.round(s.price * p.r));
  let lockUid = null, plan = PLANS[1];
  function left(ms) {
    if (ms <= 0) return "готово";
    const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3600000), m = Math.ceil((ms % 3600000) / 60000);
    return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
  }
  const dateRu = (t) => new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  function openLock(uid) {
    const it = st().inv.find((x) => x.uid === uid); if (!it || it.stake) return;
    lockUid = uid;
    const s = byId[it.id];
    $("#lkGift").innerHTML = `${A.chip(s)}<span class="grow"><b>${esc(s.gift)}</b> <span class="hint">#${s.num}</span><br><span class="hint">${STAR} ${fmt(s.price)}</span></span>`;
    renderPlans(s);
    openSheet($("#lockSheet"));
  }
  function renderPlans(s) {
    $("#lkPlans").innerHTML = PLANS.map((p) => `<button class="lk-plan ${p === plan ? "on" : ""}" data-d="${p.d}"><b>${p.d} ${plural(p.d, "день", "дня", "дней")}</b><span>+${STAR}${fmt(reward(s, p))}</span><i>${(p.r * 100).toString().replace(".", ",")}%</i></button>`).join("");
  }
  $("#lkPlans").addEventListener("click", (e) => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    plan = PLANS.find((p) => p.d === Number(b.dataset.d)); hap.select();
    const it = st().inv.find((x) => x.uid === lockUid); if (it) renderPlans(byId[it.id]);
  });
  $("#lkGo").addEventListener("click", () => {
    const it = st().inv.find((x) => x.uid === lockUid); if (!it || it.stake) return;
    const now = Date.now();
    it.stake = { from: now, until: now + plan.d * DAY, days: plan.d, reward: reward(byId[it.id], plan) };
    A.stake.uids.delete(it.uid);
    A.save(); A.renderStake(); A.renderProfile();
    closeSheet(); hap.coin(); toast(`В стейкинге до ${dateRu(it.stake.until)}`);
  });
  function renderStakes() {
    const items = st().inv.filter((it) => it.stake).sort((a, b) => a.stake.until - b.stake.until);
    $("#stkSec").hidden = !items.length;
    paintHandle();
    if (!items.length) return;
    const now = Date.now(), total = items.reduce((a, it) => a + it.stake.reward, 0);
    $("#stkSum").innerHTML = `+${STAR} ${fmt(total)}`;
    $("#stkList").innerHTML = items.map((it) => {
      const s = byId[it.id], k = it.stake, done = now >= k.until, prog = Math.min(1, (now - k.from) / (k.until - k.from));
      return `<div class="row stk-row" data-uid="${it.uid}">${A.chip(s, "sm")}
        <span class="grow stk-txt"><b>${esc(s.gift)}</b><span>${done ? "Срок вышел" : "Осталось " + left(k.until - now)}</span><i class="stk-bar"><i style="width:${(prog * 100).toFixed(1)}%"></i></i></span>
        ${done ? `<button class="mini-btn" data-claim="${it.uid}">Забрать ${STAR}${fmt(k.reward)}</button>` : `<span class="stk-r">+${STAR}${fmt(k.reward)}</span>`}</div>`;
    }).join("");
  }
  $("#stkList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-claim]");
    if (b) {
      const it = st().inv.find((x) => x.uid === Number(b.dataset.claim));
      if (!it || !it.stake || Date.now() < it.stake.until) return;
      st().balance += it.stake.reward;
      const r = it.stake.reward; delete it.stake;
      A.save(); A.renderBalance(true); A.renderStake(); A.renderProfile();
      hap.coin(); return toast(`+${fmt(r)} звёзд за стейкинг`);
    }
    const r = e.target.closest("[data-uid]");
    if (r) { const it = st().inv.find((x) => x.uid === Number(r.dataset.uid)); if (it) A.openGift(byId[it.id], it.uid); }
  });
  function unstake(uid) {
    const it = st().inv.find((x) => x.uid === uid); if (!it || !it.stake) return;
    if (Date.now() >= it.stake.until) { st().balance += it.stake.reward; toast(`+${fmt(it.stake.reward)} звёзд за стейкинг`); A.renderBalance(true); }
    else toast("Подарок снова свободен");
    delete it.stake;
    A.save(); A.renderStake(); A.renderProfile(); closeSheet();
  }

  // кнопки в карточке подарка
  A.giftActions = (s, uid) => {
    const mine = uid != null, it = mine && st().inv.find((x) => x.uid === uid), k = it && it.stake;
    $("#gcActs").hidden = !mine;
    $("#gcSend").hidden = !!k;
    $("#gcNote").hidden = !k;
    if (k) {
      const done = Date.now() >= k.until;
      $("#gcNote").innerHTML = done ? `Стейкинг завершён, награда ${STAR} ${fmt(k.reward)}` : `В стейкинге до ${dateRu(k.until)}. Награда ${STAR} ${fmt(k.reward)}`;
      $("#gcStake").innerHTML = done ? `Забрать ${STAR}${fmt(k.reward)}` : "Вернуть досрочно";
    } else $("#gcStake").textContent = "Стейкинг";
    $("#gcStake").onclick = async () => {
      if (!k) return openLock(uid);
      if (Date.now() < k.until && !(await confirmBox("Вернуть подарок досрочно? Награда сгорит."))) return;
      unstake(uid);
    };
    $("#gcSend").onclick = () => {
      if (!canUse) return toast(API ? "Передача работает в Telegram" : "Передача заработает после запуска сервера");
      pickUser(uid);
    };
  };

  // ---------- связь с ядром ----------
  A.styleOf = styleOf;
  A.SPECIAL = SPECIAL;
  A.onProfile = renderStakes;
  let lookT = null, sent = "";
  const giftIds = () => [...st().inv].sort((a, b) => byId[b.id].price - byId[a.id].price).map((x) => x.id).slice(0, 60);
  function syncMe(force) {
    if (!canUse) return;
    clearTimeout(lookT);
    lookT = setTimeout(() => {
      const body = { look: A.bannerLook(), gifts: giftIds() }, j = JSON.stringify(body);
      if (j === sent && !force) return;
      call("POST", "/api/me", body).then((r) => { sent = j; me = r.me; paintHandle(); if (r.pending) claimIncoming(); }).catch(() => {});
    }, force ? 0 : 1200);
  }
  A.onLook = () => syncMe(false);
  function closeViewer() { const v = $("#viewer"); v.classList.remove("on"); setTimeout(() => (v.hidden = true), 200); }
  A.onBack = () => { if (!ctx.hidden) return hideMenu(); if (!$("#viewer").hidden) return closeViewer(); closeChat(); };
  A.onTab = (id) => {
    clearInterval(listT);
    if (id !== "pageChats") return;
    if (!canUse) return showOff();
    renderChats(); loadChats();
    listT = setInterval(() => { if (!cur) loadChats(); }, 4000);
  };

  A.initSocial = () => {
    // отметка особого стиля на подарках в выборе обложки
    new MutationObserver(() => all("#bnGifts [data-g]").forEach((b) => b.classList.toggle("special", SPECIAL.has(byId[b.dataset.g].gift))))
      .observe($("#bnGifts"), { childList: true });

    $("#chList").addEventListener("click", (e) => { const r = e.target.closest("[data-chat]"); if (r) { hap.select(); openChat(Number(r.dataset.chat)); } });
    $("#chFound").addEventListener("click", async (e) => {
      const r = e.target.closest("[data-chat]"), u = e.target.closest("[data-user]");
      if (r) {
        const id = Number(r.dataset.chat);
        if (chats.some((c) => c.id === id)) return openChat(id);
        try { openPanel(chatScreen(await call("GET", `/api/chat/${id}`))); } catch (er) { fail(er); }
      } else if (u && found[u.dataset.user]) openPanel(userScreen(found[u.dataset.user]));
    });
    $("#chSearch").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(() => search($("#chSearch").value.trim()), 300); });

    // создание группы или канала
    let kind = "group", ncPhoto = "";
    $("#chNew").addEventListener("click", () => {
      $("#ncTitle").value = $("#ncAbout").value = ""; ncPhoto = "";
      $("#ncPhoto").style.backgroundImage = ""; $("#ncPhoto").classList.remove("has");
      openSheet($("#newChatSheet"));
    });
    $("#ncPhoto").addEventListener("click", async () => {
      try { const ph = await upload(640, true); if (ph) { ncPhoto = ph.url; $("#ncPhoto").style.backgroundImage = `url('${ph.url}')`; $("#ncPhoto").classList.add("has"); } } catch (e) { fail(e); }
    });
    $("#ncKind").addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      kind = b.dataset.k; hap.select();
      all("#ncKind button").forEach((x) => x.classList.toggle("on", x === b));
      $("#ncHint").textContent = kind === "group" ? "В группе пишут все участники." : "В канале пишете вы и назначенные админы, остальные читают.";
    });
    $("#ncGo").addEventListener("click", async () => {
      const title = $("#ncTitle").value.trim();
      if (!title) return toast("Введите название");
      try {
        const c = await call("POST", "/api/chats", { kind, title, about: $("#ncAbout").value.trim(), photo: ncPhoto });
        closeSheet(); hap.win(); openChat(c.id);
      } catch (e) { fail(e); }
    });

    // открытый чат
    $("#cvBack").addEventListener("click", closeChat);
    const info = () => cur && openPanel(cur.kind === "dm" ? userScreen(cur.peer) : chatScreen(cur));
    $("#cvWho").addEventListener("click", info);
    $("#cvAvaBtn").addEventListener("click", info);
    $("#cvSend").addEventListener("click", send);
    $("#cvAttach").addEventListener("click", attachMenu);
    $("#cvGift").addEventListener("click", () => cur && cur.peer && pickGift(cur.peer));
    input.addEventListener("input", () => { grow(); syncFoot(); typed(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    $("#cvReplyX").addEventListener("click", () => setReply(null));
    $("#cvDown").addEventListener("click", () => { msgsBox.scrollTo({ top: msgsBox.scrollHeight, behavior: "smooth" }); unseen = 0; });
    msgsBox.addEventListener("scroll", syncDown, { passive: true });
    $("#cvPin").addEventListener("click", (e) => {
      if (e.target.closest("#cvPinX")) return pin(0);
      if (cur && cur.pinned) gotoMsg(cur.pinned.id);
    });
    $("#cvJoinBtn").addEventListener("click", async () => {
      try {
        if (cur.role) { if (!(await confirmBox("Отписаться от канала?"))) return; await call("POST", `/api/chat/${cur.id}/leave`, {}); }
        else { await call("POST", `/api/chat/${cur.id}/join`, {}); hap.win(); }
        await refreshChat(); pullMessages(false);
      } catch (e) { fail(e); }
    });
    msgsBox.addEventListener("click", async (e) => {
      if (swiped) return;
      const ph = e.target.closest("[data-photo]");
      if (ph) { const v = $("#viewer"); $("#viewerImg").src = ph.dataset.photo; v.hidden = false; void v.offsetWidth; v.classList.add("on"); return; }
      const g = e.target.closest("[data-gift]");
      if (g) return A.openGift(byId[g.dataset.gift], null);
      const op = e.target.closest("[data-open]");
      if (op) {
        const id = Number(op.dataset.open);
        if (chats.some((c) => c.id === id)) return openChat(id);
        try { openPanel(chatScreen(await call("GET", `/api/chat/${id}`))); } catch (er) { fail(er); }
        return;
      }
      const go = e.target.closest("[data-goto]");
      if (go) return gotoMsg(Number(go.dataset.goto));
      const u = e.target.closest("[data-user]");
      if (u) { const m = msgs.find((x) => x.user.id === Number(u.dataset.user)); if (m) openPanel(userScreen(m.user)); return; }
      const b = e.target.closest("[data-mid]");
      if (b) { const m = msgs.find((x) => x.id === Number(b.dataset.mid)); if (m) msgMenu(b, m); }
    });
    $("#viewer").addEventListener("click", closeViewer);
    $("#handleBtn").addEventListener("click", () => {
      if (!canUse) return toast(API ? "Откройте приложение в Telegram" : "Скоро");
      openPanel(handleScreen());
    });

    paintHandle();
    if (!canUse) return;
    syncMe(true);
    loadChats();
    setInterval(() => { if (A.tab !== "pageChats") loadChats(); }, 20000);
    // бот открывает приложение со ссылкой ?chat=ID
    const chat = Number(new URLSearchParams(location.search).get("chat"));
    if (chat) setTimeout(async () => {
      $('[data-tab="pageChats"]').click();
      try {
        const c = await call("GET", `/api/chat/${chat}`);
        if (c.role || c.kind === "dm") openChat(chat); else openPanel(chatScreen(c));
      } catch (e) { fail(e); }
    }, 1200);
  };
})();
