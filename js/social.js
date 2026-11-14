// Чаты, группы и каналы между игроками, передача подарков, стейкинг и особые стили редких коллекций.
// Чаты и передача работают через сервер (server/app.py). Стейкинг хранится на устройстве, как баланс.
(() => {
  "use strict";
  const A = window.App, { $, all, STAR, fmt, fmtS, byId, CATALOG, toast, hap, openSheet, closeSheet, tg, inTg, user } = A;
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

  async function call(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (inTg) headers.Authorization = "tma " + tg.initData;
    else headers["X-Dev-User"] = `${devId}:${encodeURIComponent("Тест " + (devId - 1000))}`;
    const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "error"), { status: r.status });
    return j;
  }
  const fail = (e) => toast(e && e.status === 429 ? "Слишком часто, подождите немного" : "Нет связи с сервером");

  // ---------- особый стиль редких коллекций ----------
  const top = {};
  for (const g of CATALOG) top[g.gift] = Math.max(top[g.gift] || 0, g.price);
  const SPECIAL = new Set(Object.keys(top).filter((k) => top[k] >= 5000));
  const styleOf = (look) => {
    const g = look && look.gift && byId[look.gift];
    return g && SPECIAL.has(g.gift) ? g : null;
  };
  const vars = (g) => `--c1:${g.c1};--c2:${g.c2};--cp:${g.cp};--sym:url('${g.sym}')`;

  const hue = (n) => (Number(n) * 47) % 360;
  function ava(u, cls = "") {
    const g = styleOf(u.look), photo = /^https:\/\/[^"'()\s]+$/.test(u.photo || "") ? u.photo : "";
    const style = `--h:${hue(u.id)};${g ? vars(g) + ";" : ""}${photo ? `background-image:url('${photo}');` : ""}`;
    return `<span class="ava ${cls} ${g ? "aring" : ""} ${photo ? "" : "tint"}" style="${style}">${photo ? "" : esc((u.name || "?").trim().charAt(0).toUpperCase())}</span>`;
  }
  const chatAva = (c, cls = "") => c.kind === "dm" ? ava(c.peer, cls)
    : `<span class="ava ${cls} tint" style="--h:${hue(c.id + 7)}">${esc(c.title.trim().charAt(0).toUpperCase())}</span>`;
  const giftMark = (look) => { const g = look && look.gift && byId[look.gift]; return g ? `<img class="nm-gift" src="${g.img}" alt="">` : ""; };
  const chatName = (c) => c.kind === "dm" ? esc(c.peer.name) + giftMark(c.peer.look) : esc(c.title);

  const pad = (n) => String(n).padStart(2, "0");
  function when(ts) {
    const d = new Date(ts * 1000), now = new Date();
    return d.toDateString() === now.toDateString() ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  }
  const hhmm = (ts) => { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
  const members = (c) => c.kind === "dm" ? "" : `${c.members} ${c.kind === "channel" ? plural(c.members, "подписчик", "подписчика", "подписчиков") : plural(c.members, "участник", "участника", "участников")}`;

  function confirmBox(text) {
    return new Promise((res) => {
      if (inTg && tg.showConfirm) try { return tg.showConfirm(text, (ok) => res(!!ok)); } catch {}
      res(window.confirm(text));
    });
  }

  // ---------- список чатов ----------
  let chats = [], listT = null, bgT = null;
  async function loadChats() {
    if (!canUse) return;
    try { chats = (await call("GET", "/api/chats")).chats; } catch { return; }
    if (A.tab === "pageChats") renderChats();
    $("#chatDot").hidden = !chats.some((c) => c.unread > 0);
    if (chats.some((c) => c.unread && c.kind === "dm" && c.last && c.last.gift)) claimIncoming();
  }
  function preview(c) {
    const m = c.last;
    if (!m) return c.kind === "dm" ? "" : esc(c.about || members(c));
    const who = m.user.id === myId ? "Вы: " : c.kind === "group" ? esc(m.user.name) + ": " : "";
    return who + (m.gift && byId[m.gift] ? `Подарок: ${esc(byId[m.gift].gift)}` : esc(m.text));
  }
  function chatRow(c) {
    const kind = c.kind === "channel" ? `<i class="ch-kind">канал</i>` : c.kind === "group" ? `<i class="ch-kind">группа</i>` : "";
    return `<button class="row ch-row" data-chat="${c.id}">${chatAva(c)}
      <span class="grow ch-txt"><b>${chatName(c)}${kind}</b><span>${preview(c)}</span></span>
      <span class="ch-meta">${c.last ? `<time>${when(c.last.created)}</time>` : ""}${c.unread ? `<i class="ch-badge">${c.unread > 99 ? "99+" : c.unread}</i>` : ""}</span></button>`;
  }
  function renderChats() {
    $("#chOff").hidden = true;
    $("#chList").hidden = false;
    $("#chList").innerHTML = chats.length ? chats.map(chatRow).join("")
      : `<div class="ch-empty">Найдите игрока через поиск и напишите ему или создайте свою группу или канал.</div>`;
  }
  function showOff() {
    $("#chList").hidden = true; $("#chOff").hidden = false;
    $("#chOffTitle").textContent = API ? "Откройте в Telegram" : "Чаты скоро заработают";
    $("#chOffText").textContent = API ? "Чаты работают внутри приложения в Telegram." : "Подключаем сервер для чатов, групп и каналов. Стейкинг подарков уже работает в профиле.";
    $("#chNew").disabled = $("#chSearch").disabled = true;
    A.initDucks($("#chOff")); A.syncDucks();
  }

  // поиск людей, групп и каналов
  let searchT = null, searchSeq = 0;
  async function search(qs) {
    const box = $("#chFound"), seq = ++searchSeq;
    if (qs.length < 2) { box.hidden = true; $("#chList").hidden = false; return; }
    let r;
    try { r = await call("GET", "/api/search?q=" + encodeURIComponent(qs)); } catch (e) { return fail(e); }
    if (seq !== searchSeq) return;
    const users = r.users.map((u) => `<button class="row ch-row" data-user="${u.id}">${ava(u)}<span class="grow ch-txt"><b>${esc(u.name)}${giftMark(u.look)}</b><span>${u.username ? "@" + esc(u.username) : ""}</span></span></button>`).join("");
    const groups = r.chats.map(chatRow).join("");
    found = Object.fromEntries(r.users.map((u) => [u.id, u]));
    box.innerHTML = (users ? `<h4 class="sec-title">Игроки</h4><section class="list">${users}</section>` : "") +
      (groups ? `<h4 class="sec-title">Группы и каналы</h4><section class="list">${groups}</section>` : "") +
      (!users && !groups ? `<div class="ch-empty">Никого не нашли</div>` : "");
    box.hidden = false; $("#chList").hidden = true;
  }
  let found = {};

  // ---------- открытый чат ----------
  const view = $("#chatView"), msgsBox = $("#cvMsgs"), input = $("#cvInput");
  let cur = null, msgs = [], msgT = null, replyTo = null;
  const canPost = () => cur && cur.role && (cur.kind !== "channel" || cur.role === "owner" || cur.role === "admin");

  async function openChat(id) {
    let c;
    try { c = await call("GET", `/api/chat/${id}`); } catch (e) { return fail(e); }
    cur = c; msgs = []; replyTo = null;
    msgsBox.innerHTML = `<div class="cv-hint">Загружаем…</div>`;
    view.hidden = false; void view.offsetWidth; view.classList.add("on");
    document.body.style.overflow = "hidden";
    A.keepBack = true;
    if (inTg) try { tg.BackButton.show(); } catch {}
    paintHead(); paintFoot(); setReply(null);
    A.initDucks(view);
    await pullMessages(true);
    clearInterval(msgT); msgT = setInterval(() => pullMessages(false), 1500);
  }
  function closeChat() {
    if (!cur) return;
    cur = null; clearInterval(msgT);
    view.classList.remove("on");
    setTimeout(() => { if (!cur) view.hidden = true; }, 260);
    document.body.style.overflow = "";
    A.keepBack = false;
    if (inTg) try { tg.BackButton.hide(); } catch {}
    loadChats();
  }
  function paintHead() {
    $("#cvAva").outerHTML = chatAva(cur).replace('class="ava', 'id="cvAva" class="ava');
    $("#cvTitle").innerHTML = chatName(cur);
    let sub = members(cur);
    if (cur.kind === "dm") {
      const p = cur.peer, ago = Date.now() / 1000 - (p.seen || 0);
      sub = ago < 120 ? "в сети" : p.username ? "@" + esc(p.username) : "был недавно";
    }
    $("#cvSub").innerHTML = sub;
  }
  function paintFoot() {
    const post = canPost();
    $("#cvFoot").hidden = !post;
    $("#cvJoin").hidden = post;
    $("#cvGift").hidden = cur.kind !== "dm";
    if (!post) {
      $("#cvJoinBtn").textContent = !cur.role ? (cur.kind === "channel" ? "Подписаться" : "Вступить в группу") : "Покинуть канал";
      $("#cvJoinBtn").classList.toggle("second", !!cur.role);
    }
  }

  function bubble(m, prev, next) {
    const mine = m.user.id === myId, g = styleOf(m.user.look);
    const first = !prev || prev.user.id !== m.user.id || m.created - prev.created > 300;
    const last = !next || next.user.id !== m.user.id || next.created - m.created > 300;
    const showName = first && !mine && cur.kind === "group";
    const showAva = !mine && cur.kind === "group";
    const q = m.reply && msgs.find((x) => x.id === m.reply);
    const qg = q && styleOf(q.user.look);
    const quote = q ? `<span class="m-quote ${qg ? "styled" : ""}" style="${qg ? vars(qg) : ""}"><b>${esc(q.user.name)}</b><span>${q.gift ? "Подарок" : esc(q.text.slice(0, 80))}</span></span>` : "";
    let body;
    if (m.gift && byId[m.gift]) {
      const s = byId[m.gift];
      body = `<button class="m-gift" data-gift="${s.id}" style="${A.bg(s)}"><i class="pat"></i>${A.pic(s, true)}</button>
        <span class="m-gift-t"><b>${esc(s.gift)}</b> <span>#${s.num}</span><br>${mine ? "Вы подарили" : "Подарок для вас"} · ${STAR}${fmtS(s.price)}</span>
        ${m.text ? `<span class="m-text">${esc(m.text)}</span>` : ""}`;
    } else body = `<span class="m-text">${esc(m.text)}</span>`;
    return `<div class="m-row ${mine ? "me" : ""} ${first ? "first" : ""} ${last ? "last" : ""}">
      ${showAva ? (last ? `<button class="m-ava" data-user="${m.user.id}">${ava(m.user, "sm")}</button>` : `<span class="m-ava"></span>`) : ""}
      <div class="msg ${g ? "styled" : ""} ${m.gift ? "gift" : ""}" data-mid="${m.id}" style="${g ? vars(g) : ""}">
        ${g ? `<i class="m-pat"></i>` : ""}
        ${showName ? `<button class="m-name" data-user="${m.user.id}">${esc(m.user.name)}${giftMark(m.user.look)}</button>` : ""}
        ${quote}${body}<time>${hhmm(m.created)}</time></div></div>`;
  }
  function renderMsgs(stick) {
    const near = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight < 120;
    msgsBox.innerHTML = msgs.length ? msgs.map((m, i) => bubble(m, msgs[i - 1], msgs[i + 1])).join("")
      : `<div class="cv-hint">${cur.kind === "dm" ? "Напишите первым или отправьте подарок" : cur.kind === "channel" ? "Постов пока нет" : "Сообщений пока нет"}</div>`;
    if (stick || near) msgsBox.scrollTop = msgsBox.scrollHeight;
  }
  let pulling = false;
  async function pullMessages(first) {
    if (!cur || pulling) return;
    pulling = true;
    const id = cur.id, after = msgs.length ? msgs[msgs.length - 1].id : 0;
    try {
      const r = await call("GET", `/api/chat/${id}/messages` + (after ? `?after=${after}` : ""));
      if (!cur || cur.id !== id) return;
      if (r.messages.length || first) {
        const fresh = r.messages.filter((m) => !msgs.some((x) => x.id === m.id));
        msgs = msgs.concat(fresh);
        renderMsgs(first);
        if (!first && fresh.some((m) => m.user.id !== myId)) hap.tick();
        if (fresh.some((m) => m.gift && m.user.id !== myId)) claimIncoming();
      }
    } catch {} finally { pulling = false; }
  }
  async function send() {
    const text = input.value.trim();
    if (!text || !canPost()) return;
    input.value = ""; grow();
    const reply = replyTo; setReply(null);
    try {
      const m = await call("POST", `/api/chat/${cur.id}/messages`, { text, reply });
      if (!msgs.some((x) => x.id === m.id)) msgs.push(m);
      renderMsgs(true); hap.soft();
    } catch (e) { input.value = text; grow(); fail(e); }
  }
  function grow() { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; }
  function setReply(m) {
    replyTo = m ? m.id : null;
    $("#cvReply").hidden = !m;
    if (m) { $("#cvReplyName").textContent = m.user.name; $("#cvReplyText").textContent = m.gift ? "Подарок" : m.text.slice(0, 80); input.focus(); }
  }

  // информация о группе или канале
  async function openChatInfo() {
    if (!cur) return;
    if (cur.kind === "dm") return openUser(cur.peer);
    const c = cur;
    let list = [];
    try { list = (await call("GET", `/api/chat/${c.id}/members`)).members; } catch {}
    const link = A.BOT_USERNAME ? `https://t.me/${A.BOT_USERNAME}?start=chat_${c.id}` : "";
    const role = { owner: "владелец", admin: "админ" };
    $("#usHead").textContent = c.kind === "channel" ? "Канал" : "Группа";
    $("#usBody").innerHTML = `<div class="us-card">${chatAva(c, "xl")}<h2>${esc(c.title)}</h2><p>${esc(c.about || "")}</p><span class="hint">${members(c)}</span></div>
      <button class="cta inline" data-act="invite">Пригласить</button>
      ${c.role && c.role !== "owner" ? `<button class="danger-btn" data-act="leave">${c.kind === "channel" ? "Отписаться" : "Выйти из группы"}</button>` : ""}
      <h4 class="sec-title">${c.kind === "channel" ? "Подписчики" : "Участники"}</h4>
      <section class="list">${list.map((u) => `<div class="row ch-row" data-user="${u.id}">${ava(u)}<span class="grow ch-txt"><b>${esc(u.name)}${giftMark(u.look)}</b><span>${role[u.role] || (u.username ? "@" + esc(u.username) : "")}</span></span>
        ${c.role === "owner" && u.role !== "owner" ? `<button class="mini-btn ${u.role === "admin" ? "off" : ""}" data-admin="${u.id}" data-on="${u.role === "admin" ? 0 : 1}">${u.role === "admin" ? "Снять" : "Админ"}</button>` : ""}</div>`).join("")}</section>`;
    found = Object.fromEntries(list.map((u) => [u.id, u]));
    $("#usBody").onclick = async (e) => {
      const act = e.target.closest("[data-act]"), adm = e.target.closest("[data-admin]");
      if (adm) {
        try { await call("POST", `/api/chat/${c.id}/admin`, { user: Number(adm.dataset.admin), on: adm.dataset.on === "1" }); } catch (er) { return fail(er); }
        hap.soft(); return openChatInfo();
      }
      if (act && act.dataset.act === "invite") return shareLink(link, `${c.kind === "channel" ? "Канал" : "Группа"} «${c.title}» в DuckChance`);
      if (act && act.dataset.act === "leave") {
        if (!(await confirmBox(c.kind === "channel" ? "Отписаться от канала?" : "Выйти из группы?"))) return;
        try { await call("POST", `/api/chat/${c.id}/leave`, {}); } catch (er) { return fail(er); }
        closeSheet(); closeChat(); return;
      }
      const u = e.target.closest("[data-user]");
      if (u && found[u.dataset.user] && Number(u.dataset.user) !== myId) openUser(found[u.dataset.user]);
    };
    openSheet($("#userSheet"));
  }
  function shareLink(link, text) {
    if (!link) return toast("Ссылка появится в Telegram");
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    if (inTg) try { return tg.openTelegramLink(url); } catch {}
    window.open(url, "_blank");
  }

  // ---------- профиль другого игрока ----------
  async function openUser(u) {
    try { u = await call("GET", `/api/user/${u.id}`); } catch {}
    const g = styleOf(u.look), look = u.look || {};
    // оформление пришло от другого игрока: пропускаем только цвета и картинки каталога
    const hexOk = (x) => /^#[0-9a-f]{3,8}$/i.test(x || ""), symOk = /^https:\/\/cdn\.changes\.tg\/[^"'()\s]+$/.test(look.sym || "");
    const bannerStyle = hexOk(look.c1) && hexOk(look.c2) && hexOk(look.cp) ? `--c1:${look.c1};--c2:${look.c2};--cp:${look.cp}` + (symOk ? `;--sym:url('${look.sym}')` : "") : "";
    $("#usHead").textContent = "Профиль";
    $("#usBody").innerHTML = `<section class="pf-banner mini ${bannerStyle.includes("--sym") ? "has" : ""}" style="${bannerStyle}"><i class="pat"></i>
        ${ava(u, "xl")}<h1>${esc(u.name)}${giftMark(u.look)}</h1><p>${u.username ? "@" + esc(u.username) : ""}</p></section>
      ${g ? `<p class="bn-note">Особый стиль коллекции ${esc(g.gift)}</p>` : ""}
      ${u.id !== myId ? `<div class="gc-acts"><button class="cta inline" data-act="dm">Написать</button><button class="cta inline second" data-act="gift">Подарить</button></div>` : ""}`;
    $("#usBody").onclick = async (e) => {
      const act = e.target.closest("[data-act]"); if (!act) return;
      if (act.dataset.act === "dm") {
        try { const c = await call("POST", "/api/dm", { user: u.id }); closeSheet(); openChat(c.id); } catch (er) { fail(er); }
      } else pickGift(u);
    };
    openSheet($("#userSheet"));
  }

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
    $("#pkBody").innerHTML = users.length
      ? `<h4 class="sec-title">${title}</h4><section class="list">${users.map((u) => `<button class="row ch-row" data-user="${u.id}">${ava(u)}<span class="grow ch-txt"><b>${esc(u.name)}${giftMark(u.look)}</b><span>${u.username ? "@" + esc(u.username) : ""}</span></span></button>`).join("")}</section>`
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
    if (pickMode === "gift") {
      const t = e.target.closest("[data-uid]"); if (t) sendGift(Number(t.dataset.uid), pickPeer);
    } else {
      const u = e.target.closest("[data-user]"); if (u && found[u.dataset.user]) sendGift(pickUid, found[u.dataset.user]);
    }
  });
  async function sendGift(uid, peer) {
    const it = st().inv.find((x) => x.uid === uid);
    if (!it) return;
    if (it.stake) return toast("Подарок в стейкинге");
    const s = byId[it.id];
    if (!(await confirmBox(`Передать ${s.gift} #${s.num} игроку ${peer.name}? Вернуть подарок будет нельзя.`))) return;
    let r;
    try { r = await call("POST", "/api/gift/send", { to: peer.id, gift: it.id }); } catch (e) { return fail(e); }
    // подарок уходит из инвентаря только после ответа сервера
    st().inv = st().inv.filter((x) => x.uid !== uid);
    A.stake.uids.delete(uid);
    A.save(); A.renderStake(); A.renderProfile(); A.renderTasks();
    closeSheet(); hap.win(); toast(`${s.gift} отправлен`);
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
      if (gifts.length) { A.renderStake(); A.renderProfile(); A.renderTasks(); }
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
    const row = e.target.closest("[data-uid]");
    if (row) { const it = st().inv.find((x) => x.uid === Number(row.dataset.uid)); if (it) A.openGift(byId[it.id], it.uid); }
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
  let lookT = null, sentLook = "";
  A.onLook = (b) => {
    if (!canUse) return;
    clearTimeout(lookT);
    lookT = setTimeout(() => {
      const j = JSON.stringify(b);
      if (j === sentLook) return;
      call("POST", "/api/me", { look: b }).then(() => (sentLook = j)).catch(() => {});
    }, 1200);
  };
  A.onBack = closeChat;
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
    $("#chFound").addEventListener("click", (e) => {
      const r = e.target.closest("[data-chat]"), u = e.target.closest("[data-user]");
      if (r) openChat(Number(r.dataset.chat));
      else if (u && found[u.dataset.user]) openUser(found[u.dataset.user]);
    });
    $("#chSearch").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(() => search($("#chSearch").value.trim()), 300); });

    // создание группы или канала
    let kind = "group";
    $("#chNew").addEventListener("click", () => { $("#ncTitle").value = $("#ncAbout").value = ""; openSheet($("#newChatSheet")); });
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
        const c = await call("POST", "/api/chats", { kind, title, about: $("#ncAbout").value.trim() });
        closeSheet(); hap.win(); openChat(c.id);
      } catch (e) { fail(e); }
    });

    // открытый чат
    $("#cvBack").addEventListener("click", closeChat);
    $("#cvWho").addEventListener("click", openChatInfo);
    $("#cvSend").addEventListener("click", send);
    input.addEventListener("input", grow);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    $("#cvReplyX").addEventListener("click", () => setReply(null));
    $("#cvGift").addEventListener("click", () => cur && cur.peer && pickGift(cur.peer));
    $("#cvJoinBtn").addEventListener("click", async () => {
      try {
        if (cur.role) { if (!(await confirmBox("Отписаться от канала?"))) return; await call("POST", `/api/chat/${cur.id}/leave`, {}); cur.role = null; }
        else { cur = Object.assign(cur, await call("POST", `/api/chat/${cur.id}/join`, {})); hap.win(); }
        paintHead(); paintFoot();
      } catch (e) { fail(e); }
    });
    msgsBox.addEventListener("click", (e) => {
      const g = e.target.closest("[data-gift]");
      if (g) return A.openGift(byId[g.dataset.gift], null);
      const u = e.target.closest("[data-user]");
      if (u) { const m = msgs.find((x) => x.user.id === Number(u.dataset.user)); if (m) openUser(m.user); return; }
      const b = e.target.closest("[data-mid]");
      if (b && canPost()) { const m = msgs.find((x) => x.id === Number(b.dataset.mid)); if (m) { hap.select(); setReply(m); } }
    });

    if (!canUse) return;
    call("POST", "/api/me", { look: A.bannerLook() }).then((r) => { sentLook = JSON.stringify(A.bannerLook()); if (r.pending) claimIncoming(); }).catch(() => {});
    loadChats();
    bgT = setInterval(() => { if (A.tab !== "pageChats") loadChats(); }, 20000);
    // бот открывает приложение со ссылкой ?chat=ID
    const chat = Number(new URLSearchParams(location.search).get("chat"));
    if (chat) setTimeout(() => { $('[data-tab="pageChats"]').click(); openChat(chat); }, 1200);
  };
})();
