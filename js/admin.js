// Админка DuckChance: отдельное полноэкранное окно для админов.
// Обзор, игроки (баланс, подарки, бан, сообщение), промокоды, задания, рассылка, настройки шансов и функций.
// Все действия проверяет сервер (server/admin.py): кнопка видна только админам, но доступ даёт только их ID.
(() => {
  "use strict";
  const A = window.App, { $, all, STAR, fmt, byId, toast, hap } = A;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = (m, p, b) => A.api(m, p, b);
  const fail = (e) => toast(e && e.status === 403 ? "Нет прав администратора" : e && e.status === 409 ? "Такой уже есть" : e && e.status === 400 ? "Проверьте поля" : "Ошибка сервера");
  const MODES = { classic: "Апгрейд", streak: "Серия", contract: "Контракт", arena: "Арена", crash: "Краш", egg: "Яйцо" };
  const DUCKS = { logo: "🦆", logo_hop: "🐤", logo_shine: "✨", hi: "👋", money: "🤑", fire: "🔥", party: "🥳", cool: "😎", strong: "💪", love: "🫶", think: "🤔", wow: "🍾", ok: "👌", point: "🫵", heart: "❤️" };
  const DUCK_IDS = { logo: "5463279992005766057", logo_hop: "5460872310649039083", logo_shine: "5460810802422393483", hi: "5258029913021119781", money: "5260436911478043287", fire: "5258044395650841388", party: "5260515582394005038", cool: "5260256767664747296", strong: "5260237109599431823", love: "5258183535411360332", think: "5260486002954237511", wow: "5260414358604771183", ok: "5260429575673902036", point: "5260324447759402046", heart: "5260634973894900408" };
  const factRtp = (u) => (u.wagered ? Math.round((u.won / u.wagered) * 1000) / 10 + "%" : "—");
  const ago = (ts) => { const s = Date.now() / 1000 - (ts || 0); return s < 120 ? "в сети" : s < 3600 ? `${Math.round(s / 60)} мин назад` : s < 86400 ? `${Math.round(s / 3600)} ч назад` : `${Math.round(s / 86400)} дн назад`; };
  // каталог большой: в выпадающем списке до 150 подарков, остальные находятся поиском по названию, модели, фону, символу
  const giftOptions = (q = "") => {
    q = q.trim().toLowerCase();
    const list = A.Cat.search({ q, dir: -1, limit: 150 }).items;
    return list.map((g) => `<option value="${g.id}">${esc(g.gift)} · ${esc(g.model)} · ${esc(g.backdrop)} · ${fmt(g.price)} ⭐</option>`).join("") || `<option value="">Ничего не нашлось</option>`;
  };
  const giftPicker = (id) => `<input class="adm-gq" data-for="${id}" placeholder="Поиск подарка: Pepe, Black, Durov…"><select id="${id}">${giftOptions()}</select>`;

  let view = null, tab = "home", stackEl = null;

  function build() {
    view = document.createElement("section");
    view.className = "adm-view";
    view.hidden = true;
    view.innerHTML = `<header class="adm-head"><button class="adm-x" data-a="close"><svg viewBox="0 0 12 20"><path d="M10 2 2 10l8 8"/></svg>Назад</button><b>Админка</b><button class="adm-x" data-a="refresh">Обновить</button></header>
      <nav class="adm-tabs">${[["home", "Обзор"], ["users", "Игроки"], ["promos", "Промокоды"], ["tasks", "Задания"], ["bc", "Рассылка"], ["settings", "Настройки"]].map(([k, v]) => `<button data-tab="${k}">${v}</button>`).join("")}</nav>
      <div class="adm-body" id="admBody"></div>`;
    document.body.appendChild(view);
    view.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) { tab = t.dataset.tab; hap.select(); return render(); }
      const a = e.target.closest("[data-a]");
      if (a && a.dataset.a === "close") return close();
      if (a && a.dataset.a === "refresh") { hap.soft(); return render(); }
    });
  }
  function open() {
    if (!A.apiReady || !A.apiReady()) return toast("Админка работает внутри Telegram");
    if (!view) build();
    view.hidden = false; void view.offsetWidth; view.classList.add("on");
    document.body.style.overflow = "hidden";
    A.keepBack = true;
    try { A.tg && A.tg.BackButton.show(); } catch {}
    render();
  }
  function close() {
    view.classList.remove("on");
    setTimeout(() => (view.hidden = true), 300);
    document.body.style.overflow = "";
    A.keepBack = false;
    try { A.tg && A.tg.BackButton.hide(); } catch {}
  }
  const body = () => $("#admBody");
  function loading() { body().innerHTML = `<div class="adm-load"><span class="spin"></span></div>`; }
  function render() {
    all(".adm-tabs [data-tab]", view).forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    ({ home, users, promos, tasks, bc, settings })[tab]();
  }

  // ---------- обзор ----------
  async function home() {
    loading();
    let d;
    try { d = await api("GET", "/api/admin/stats"); } catch (e) { return fail(e); }
    const k = (v, l, accent) => `<div class="adm-kpi ${accent || ""}"><b>${v}</b><span>${l}</span></div>`;
    body().innerHTML = `<h4 class="adm-h">Игроки</h4><div class="adm-grid">
        ${k(fmt(d.users), "всего")}${k(fmt(d.online), "онлайн", "ok")}${k(fmt(d.active_day), "за сутки")}${k(fmt(d.active_week), "за неделю")}
        ${k(fmt(d.new_day), "новых за сутки", "ok")}${k(fmt(d.new_week), "новых за неделю")}${k(fmt(d.bot_users), "в боте")}${k(fmt(d.banned), "в бане", "bad")}</div>
      <h4 class="adm-h">Деньги</h4><div class="adm-grid">
        ${k(`${STAR}${fmt(d.paid_stars)}`, "пополнено всего", "gold")}${k(`${STAR}${fmt(d.paid_day)}`, "за сутки", "gold")}${k(fmt(d.payments), "оплат")}${k(`${STAR}${fmt(d.balances)}`, "на балансах")}</div>
      <h4 class="adm-h">Активность</h4><div class="adm-grid">
        ${k(fmt(d.messages), "сообщений")}${k(fmt(d.chats), "групп")}${k(fmt(d.channels), "каналов")}${k(fmt(d.transfers), "передач подарков")}
        ${k(fmt(d.promo_uses), "промокодов")}${k(fmt(d.tasks_done), "заданий")}</div>
      <h4 class="adm-h">Топ по балансу</h4><section class="list">${d.top.map((u, i) => `<button class="row adm-user" data-uid="${u.id}"><i class="adm-n">${i + 1}</i><span class="grow"><b>${esc(u.name)}</b><span>${u.handle ? "@" + esc(u.handle) : "ID " + u.id}</span></span><b class="adm-bal">${STAR}${fmt(u.balance)}</b></button>`).join("") || `<div class="row">Пока пусто</div>`}</section>`;
    body().onclick = (e) => { const r = e.target.closest("[data-uid]"); if (r) userCard(Number(r.dataset.uid)); };
  }

  // ---------- игроки ----------
  let uq = "", usort = "seen";
  async function users() {
    body().innerHTML = `<div class="adm-tools"><input id="admQ" type="search" placeholder="Имя, @ник или ID" value="${esc(uq)}">
        <select id="admSort"><option value="seen">Недавние</option><option value="balance">По балансу</option><option value="new">Новые</option><option value="rtp">Свои шансы</option></select></div>
      <div id="admUsers"><div class="adm-load"><span class="spin"></span></div></div>`;
    $("#admSort").value = usort;
    let t = null;
    $("#admQ").oninput = () => { clearTimeout(t); t = setTimeout(() => { uq = $("#admQ").value.trim(); list(); }, 300); };
    $("#admSort").onchange = () => { usort = $("#admSort").value; list(); };
    body().onclick = (e) => { const r = e.target.closest("[data-uid]"); if (r) userCard(Number(r.dataset.uid)); };
    list();
    async function list() {
      let d;
      const rtpOnly = usort === "rtp";
      try { d = await api("GET", `/api/admin/users?q=${encodeURIComponent(uq)}&sort=${rtpOnly ? "seen" : usort}${rtpOnly ? "&filter=rtp" : ""}`); } catch (e) { return fail(e); }
      $("#admUsers").innerHTML = `<p class="adm-note">Всего игроков: ${fmt(d.total)}</p><section class="list">${d.users.map((u) =>
        `<button class="row adm-user" data-uid="${u.id}"><span class="ava sm2 tint" style="--h:${(u.id * 47) % 360};${u.photo ? `background-image:url('${esc(u.photo)}')` : ""}">${u.photo ? "" : esc(u.name.charAt(0))}</span>
          <span class="grow"><b>${esc(u.name)}${u.banned ? ` <i class="adm-tag bad">бан</i>` : ""}${u.own_rtp ? ` <i class="adm-tag rtp">свои шансы</i>` : ""}</b><span>${u.handle ? "@" + esc(u.handle) : u.tg_username ? "tg @" + esc(u.tg_username) : "ID " + u.id} · ${ago(u.seen)}${u.wagered ? ` · RTP ${factRtp(u)}` : ""}</span></span>
          <b class="adm-bal">${STAR}${fmt(u.balance)}</b></button>`).join("") || `<div class="row">Никого не нашли</div>`}</section>`;
    }
  }
  async function userCard(id) {
    tab = "users";
    all(".adm-tabs [data-tab]", view).forEach((b) => b.classList.toggle("on", b.dataset.tab === "users"));
    loading();
    let u;
    try { u = await api("GET", `/api/admin/user/${id}`); } catch (e) { return fail(e); }
    const gifts = (u.gifts || []).filter((g) => byId[g]);
    body().innerHTML = `<button class="adm-back" data-act="back">‹ Все игроки</button>
      <div class="adm-card"><span class="ava lg tint" style="--h:${(u.id * 47) % 360};${u.photo ? `background-image:url('${esc(u.photo)}')` : ""}">${u.photo ? "" : esc(u.name.charAt(0))}</span>
        <b>${esc(u.name)}${u.banned ? ` <i class="adm-tag bad">бан</i>` : ""}</b><span>${u.handle ? "@" + esc(u.handle) + " · " : ""}${u.tg_username ? "tg @" + esc(u.tg_username) + " · " : ""}ID <span class="adm-copy" data-copy="${u.id}">${u.id}</span></span><span>${ago(u.seen)}</span></div>
      <div class="adm-grid">${[[`${STAR}${fmt(u.balance)}`, "баланс"], [gifts.length, "подарков"], [u.staked, "в стейкинге"], [u.messages, "сообщений"]].map(([v, l]) => `<div class="adm-kpi"><b>${v}</b><span>${l}</span></div>`).join("")}
        <div class="adm-kpi ${u.rtp ? "gold" : ""}"><b>${Math.round(u.rtp_base * 100)}%</b><span>RTP по настройке${u.rtp ? " (свой)" : ""}</span></div>
        <div class="adm-kpi ${u.wagered && u.won / u.wagered > u.rtp_base ? "bad" : "ok"}"><b>${u.wagered ? factRtp(u) : "—"}</b><span>фактический RTP</span></div></div>
      <p class="adm-note">Фактический RTP: выиграно ${STAR}${fmt(u.won)} из поставленных ${STAR}${fmt(u.wagered)}. На коротком отрезке он сильно скачет, к настройке приближается после сотен игр.</p>
      <h4 class="adm-h">Шансы игрока ${u.rtp ? `<i class="adm-tag rtp">свои</i>` : `<i class="adm-tag">как у всех</i>`}</h4>
      <section class="list adm-form">
        <div class="adm-mode"><span class="grow"><b>Общий RTP игрока</b></span><input id="auRtpAll" type="number" inputmode="numeric" min="0" max="100" placeholder="${Math.round(u.rtp_base * 100)}" value="${u.rtp && u.rtp.all != null ? Math.round(u.rtp.all * 100) : ""}"><i>%</i></div>
        ${Object.keys(MODES).map((m) => `<div class="adm-mode"><span class="grow">${MODES[m]}</span><input type="number" inputmode="numeric" min="0" max="100" data-urtp="${m}" placeholder="${Math.round(u.rtp_effective[m] * 100)}" value="${u.rtp && u.rtp.modes && u.rtp.modes[m] != null ? Math.round(u.rtp.modes[m] * 100) : ""}"><i>%</i></div>`).join("")}
        <p class="adm-note">Серым показано, что действует сейчас. Пустое поле: режим берёт общий RTP игрока, а если его нет, общие настройки. У игрока меняется в течение минуты.</p>
        <div class="adm-btns"><button data-act="rtp" class="main">Сохранить шансы</button>${u.rtp ? `<button data-act="rtpreset">Как у всех</button>` : ""}</div>
      </section>
      <h4 class="adm-h">Баланс</h4>
      <section class="list adm-form"><div class="adm-row2"><input id="auAmount" type="number" inputmode="numeric" placeholder="Сумма"><input id="auWager" type="number" inputmode="decimal" placeholder="Отыгрыш ×"></div>
        <input id="auNote" placeholder="Подпись для игрока, например «Бонус от админа»">
        <div class="adm-btns"><button data-act="add">Начислить</button><button data-act="sub">Списать</button><button data-act="set">Установить</button></div></section>
      <h4 class="adm-h">Выдать подарок</h4>
      <section class="list adm-form">${giftPicker("auGift")}<div class="adm-btns"><button data-act="gift">Выдать подарок</button></div></section>
      <p class="adm-note">Изменения дойдут до игрока при следующем заходе в приложение, каждое ровно один раз.</p>
      <h4 class="adm-h">Сообщение от бота</h4>
      <section class="list adm-form"><textarea id="auMsg" rows="3" placeholder="Текст, можно с HTML-разметкой"></textarea><div class="adm-btns"><button data-act="msg">Отправить</button></div></section>
      ${gifts.length ? `<h4 class="adm-h">Подарки</h4><div class="adm-gifts">${gifts.map((g) => `<span class="adm-gift" style="${A.bg(byId[g])}"><i class="pat"></i>${A.pic(byId[g])}</span>`).join("")}</div>` : ""}
      ${u.grants.length ? `<h4 class="adm-h">Выдачи</h4><section class="list">${u.grants.map((g) => `<div class="row adm-line"><span class="grow">${g.kind === "gift" && byId[g.gift] ? esc(byId[g.gift].gift) : g.kind === "set" ? "Баланс = " + fmt(g.amount) : (g.amount > 0 ? "+" : "") + fmt(g.amount)}${g.wager ? ` · ×${g.wager}` : ""}</span><span class="hint">${g.claimed ? "получено" : "ждёт"}</span></div>`).join("")}</section>` : ""}
      <section class="list"><button class="row pn-row ${u.banned ? "" : "danger"}" data-act="ban">${u.banned ? "Разблокировать" : "Заблокировать игрока"}</button></section>`;
    body().onclick = async (e) => {
      const c = e.target.closest("[data-copy]"); if (c) { navigator.clipboard && navigator.clipboard.writeText(c.dataset.copy); return toast("ID скопирован"); }
      const b = e.target.closest("[data-act]"); if (!b) return;
      const a = b.dataset.act;
      if (a === "back") { tab = "users"; return users(); }
      const n = Math.floor(Number($("#auAmount") && $("#auAmount").value) || 0);
      const wager = Number($("#auWager") && $("#auWager").value) || 0, note = $("#auNote") ? $("#auNote").value.trim() : "";
      try {
        if (a === "add" || a === "sub") { if (!n) return toast("Введите сумму"); await api("POST", `/api/admin/user/${id}/grant`, { kind: "add", amount: a === "sub" ? -Math.abs(n) : Math.abs(n), wager, note }); toast(a === "sub" ? "Списание поставлено" : "Начисление поставлено"); }
        if (a === "set") { if (n < 0) return; await api("POST", `/api/admin/user/${id}/grant`, { kind: "set", amount: n, note }); toast("Баланс будет установлен"); }
        if (a === "gift") { await api("POST", `/api/admin/user/${id}/grant`, { kind: "gift", gift: $("#auGift").value, wager, note }); toast("Подарок поставлен в выдачу"); }
        if (a === "msg") { const t = $("#auMsg").value.trim(); if (!t) return; await api("POST", `/api/admin/user/${id}/message`, { text: t }); toast("Отправлено"); }
        if (a === "rtp") {
          const raw = $("#auRtpAll").value.trim(), allv = raw === "" ? null : Number(raw), modes = {};
          let bad = allv != null && !(allv >= 0 && allv <= 100);
          all("[data-urtp]", body()).forEach((i) => { if (i.value.trim() === "") return; const v = Number(i.value); if (v >= 0 && v <= 100) modes[i.dataset.urtp] = v / 100; else bad = true; });
          if (bad) return toast("RTP от 0 до 100%");
          await api("POST", `/api/admin/user/${id}/rtp`, { all: allv == null ? null : allv / 100, modes });
          toast(allv != null || Object.keys(modes).length ? "Шансы игрока сохранены" : "Шансы как у всех");
        }
        if (a === "rtpreset") { await api("POST", `/api/admin/user/${id}/rtp`, { reset: true }); toast("Шансы как у всех"); }
        if (a === "ban") { if (!u.banned && !confirm(`Заблокировать ${u.name}?`)) return; await api("POST", `/api/admin/user/${id}/ban`, { on: !u.banned }); toast(u.banned ? "Разблокирован" : "Заблокирован"); }
        hap.win(); userCard(id);
      } catch (er) { fail(er); }
    };
  }

  // ---------- промокоды ----------
  async function promos() {
    loading();
    let d;
    try { d = await api("GET", "/api/admin/promos"); } catch (e) { return fail(e); }
    body().innerHTML = `<h4 class="adm-h">Новый промокод</h4>
      <section class="list adm-form">
        <input id="apCode" placeholder="Код любого вида: DUCK2026, ПОДАРОК, x5-boost. Пусто = сгенерировать" maxlength="40">
        <div class="seg flush adm-seg" id="apKind"><button data-k="stars" class="on">Звёзды</button><button data-k="gift">Подарок</button></div>
        <input id="apAmount" type="number" inputmode="numeric" placeholder="Сколько звёзд">
        <div id="apGiftBox" hidden>${giftPicker("apGift")}</div>
        <div class="adm-row2"><input id="apUses" type="number" inputmode="numeric" placeholder="Активаций (0 = без лимита)"><input id="apDays" type="number" inputmode="numeric" placeholder="Дней (0 = навсегда)"></div>
        <label class="adm-lab">Отыгрыш: чтобы вывести подарки, нужно прокрутить награду <b id="apWv">×0</b></label>
        <input id="apWager" type="range" min="0" max="20" step="1" value="0">
        <input id="apNote" placeholder="Заметка для себя (необязательно)">
        <div class="adm-btns"><button data-act="create" class="main">Создать</button></div>
      </section>
      <h4 class="adm-h">Промокоды · ${d.promos.length}</h4>
      <section class="list">${d.promos.map((p) => `<div class="row adm-promo ${p.active ? "" : "off"}"><span class="grow"><b class="adm-copy" data-copy="${esc(p.code)}">${esc(p.code)}</b>
          <span>${p.kind === "gift" && byId[p.gift] ? "🎁 " + esc(byId[p.gift].gift) : `${STAR}${fmt(p.amount)}`}${p.wager ? ` · отыгрыш ×${p.wager}` : ""} · ${p.uses}${p.uses_max ? "/" + p.uses_max : ""} активаций${p.expires ? ` · до ${new Date(p.expires * 1000).toLocaleDateString("ru-RU")}` : ""}${p.note ? " · " + esc(p.note) : ""}</span></span>
          <button class="mini-btn ${p.active ? "off" : ""}" data-toggle="${esc(p.code)}">${p.active ? "Выкл" : "Вкл"}</button><button class="mini-btn off" data-del="${esc(p.code)}">✕</button></div>`).join("") || `<div class="row">Промокодов пока нет</div>`}</section>`;
    let kind = "stars";
    $("#apWager").oninput = () => ($("#apWv").textContent = "×" + $("#apWager").value);
    body().onclick = async (e) => {
      const k = e.target.closest("[data-k]");
      if (k) { kind = k.dataset.k; all("#apKind button").forEach((x) => x.classList.toggle("on", x === k)); $("#apAmount").hidden = kind !== "stars"; $("#apGiftBox").hidden = kind !== "gift"; return; }
      const c = e.target.closest("[data-copy]"); if (c) { navigator.clipboard && navigator.clipboard.writeText(c.dataset.copy); return toast("Код скопирован"); }
      try {
        const tg2 = e.target.closest("[data-toggle]"); if (tg2) { await api("POST", `/api/admin/promos/${encodeURIComponent(tg2.dataset.toggle)}/toggle`, {}); return promos(); }
        const dl = e.target.closest("[data-del]"); if (dl) { if (!confirm("Удалить промокод?")) return; await api("POST", `/api/admin/promos/${encodeURIComponent(dl.dataset.del)}/delete`, {}); return promos(); }
        if (e.target.closest('[data-act="create"]')) {
          const r = await api("POST", "/api/admin/promos", { code: $("#apCode").value.trim(), kind, amount: Number($("#apAmount").value) || 0, gift: $("#apGift").value,
            uses_max: Number($("#apUses").value) || 0, days: Number($("#apDays").value) || 0, wager: Number($("#apWager").value) || 0, note: $("#apNote").value.trim() });
          navigator.clipboard && navigator.clipboard.writeText(r.code).catch(() => {});
          hap.win(); toast(`Промокод ${r.code} создан и скопирован`); promos();
        }
      } catch (er) { fail(er); }
    };
  }

  // ---------- задания ----------
  async function tasks() {
    loading();
    let d;
    try { d = await api("GET", "/api/admin/tasks"); } catch (e) { return fail(e); }
    body().innerHTML = `<h4 class="adm-h">Новое задание</h4>
      <section class="list adm-form">
        <div class="seg flush adm-seg" id="atKind"><button data-k="sub" class="on">Подписка на канал или чат</button><button data-k="link">Переход по ссылке</button></div>
        <input id="atTitle" placeholder="Название, например «Подпишись на канал DuckChance»" maxlength="80">
        <input id="atTarget" placeholder="@канал или ссылка t.me/...">
        <input id="atReward" type="number" inputmode="numeric" placeholder="Награда в звёздах">
        <div class="adm-btns"><button data-act="create" class="main">Добавить</button></div>
      </section>
      <p class="adm-note">Подписку проверяет бот. Добавьте @${esc(A.BOT_USERNAME)} администратором в канал или чат, иначе Telegram не покажет ему участников.</p>
      <h4 class="adm-h">Задания · ${d.tasks.length}</h4>
      <section class="list">${d.tasks.map((t) => `<div class="row adm-promo ${t.active ? "" : "off"}"><span class="grow"><b>${esc(t.title)}</b><span>${t.kind === "sub" ? "Подписка " : "Ссылка "}${esc(t.target)} · ${STAR}${fmt(t.reward)} · выполнили ${fmt(t.done)}</span></span>
          <button class="mini-btn ${t.active ? "off" : ""}" data-toggle="${t.id}">${t.active ? "Выкл" : "Вкл"}</button><button class="mini-btn off" data-del="${t.id}">✕</button></div>`).join("") || `<div class="row">Своих заданий пока нет</div>`}</section>`;
    let kind = "sub";
    body().onclick = async (e) => {
      const k = e.target.closest("[data-k]");
      if (k) { kind = k.dataset.k; all("#atKind button").forEach((x) => x.classList.toggle("on", x === k)); $("#atTarget").placeholder = kind === "sub" ? "@канал или ссылка t.me/..." : "https://..."; return; }
      try {
        const tg2 = e.target.closest("[data-toggle]"); if (tg2) { await api("POST", `/api/admin/tasks/${tg2.dataset.toggle}/toggle`, {}); return tasks(); }
        const dl = e.target.closest("[data-del]"); if (dl) { if (!confirm("Удалить задание?")) return; await api("POST", `/api/admin/tasks/${dl.dataset.del}/delete`, {}); return tasks(); }
        if (e.target.closest('[data-act="create"]')) {
          await api("POST", "/api/admin/tasks", { kind, title: $("#atTitle").value.trim(), target: $("#atTarget").value.trim(), reward: Number($("#atReward").value) || 0 });
          hap.win(); toast("Задание добавлено"); tasks();
        }
      } catch (er) { fail(er); }
    };
  }

  // ---------- рассылка ----------
  let draft = "", photo = "", btnMode = "play";
  function bc() {
    body().innerHTML = `<p class="adm-note">Для видео, файлов, GIF и любых премиум-эмодзи удобнее рассылка в боте: команда /admin → «Рассылка», бот разошлёт копию вашего сообщения как есть.</p>
      <h4 class="adm-h">Текст</h4>
      <div class="adm-fmt">${[["b", "Ж"], ["i", "К"], ["u", "П"], ["s", "З"], ["code", "{ }"], ["tg-spoiler", "▒"], ["blockquote", "❝"], ["a", "🔗"]].map(([t, l]) => `<button data-wrap="${t}">${l}</button>`).join("")}</div>
      <div class="adm-ducks">${Object.keys(DUCKS).map((k) => `<button data-duck="${k}">${DUCKS[k]}</button>`).join("")}</div>
      <textarea id="abText" rows="9" placeholder="Текст рассылки. Выделите слово и нажмите кнопку форматирования.">${esc(draft)}</textarea>
      <div class="adm-photo">${photo ? `<img src="${esc(photo)}" alt=""><button data-act="nophoto">Убрать фото</button>` : `<button data-act="photo">Добавить фото</button>`}</div>
      <h4 class="adm-h">Кнопка под сообщением</h4>
      <div class="seg flush adm-seg" id="abBtn"><button data-b="play" class="${btnMode === "play" ? "on" : ""}">«Играть»</button><button data-b="url" class="${btnMode === "url" ? "on" : ""}">Своя ссылка</button><button data-b="none" class="${btnMode === "none" ? "on" : ""}">Без кнопки</button></div>
      <div class="adm-row2" id="abUrl" ${btnMode === "url" ? "" : "hidden"}><input id="abBtnText" placeholder="Текст кнопки"><input id="abBtnUrl" placeholder="https://"></div>
      <h4 class="adm-h">Предпросмотр</h4><div class="adm-prev" id="abPrev"></div>
      <div class="adm-btns"><button data-act="test">Отправить себе</button><button data-act="all" class="main">Разослать всем</button></div>`;
    const ta = $("#abText");
    const prev = () => {
      draft = ta.value;
      const html = draft.replace(/<tg-emoji emoji-id="\d+">(.*?)<\/tg-emoji>/g, "$1").replace(/<(?!\/?(b|i|u|s|code|pre|blockquote|tg-spoiler|a)( href="[^"]*")?>)[^>]*>/g, "").replace(/\n/g, "<br>");
      $("#abPrev").innerHTML = (photo ? `<img src="${esc(photo)}" alt="">` : "") + `<div>${html || '<span class="hint">Пусто</span>'}</div>` + (btnMode !== "none" ? `<span class="adm-prev-btn">${btnMode === "play" ? "🔥 Играть" : esc(($("#abBtnText") || {}).value || "Кнопка")}</span>` : "");
    };
    ta.oninput = prev; prev();
    body().oninput = (e) => { if (e.target.id === "abBtnText") prev(); };
    body().onclick = async (e) => {
      const w = e.target.closest("[data-wrap]");
      if (w) {
        const t = w.dataset.wrap, s0 = ta.selectionStart, s1 = ta.selectionEnd, sel = ta.value.slice(s0, s1) || "текст";
        const open = t === "a" ? `<a href="${prompt("Ссылка", "https://") || "https://"}">` : `<${t}>`;
        ta.setRangeText(`${open}${sel}</${t}>`, s0, s1, "end"); ta.focus(); return prev();
      }
      const dk = e.target.closest("[data-duck]");
      if (dk) { const k = dk.dataset.duck; ta.setRangeText(`<tg-emoji emoji-id="${DUCK_IDS[k]}">${DUCKS[k]}</tg-emoji>`, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); return prev(); }
      const bb = e.target.closest("[data-b]");
      if (bb) { btnMode = bb.dataset.b; all("#abBtn button").forEach((x) => x.classList.toggle("on", x === bb)); $("#abUrl").hidden = btnMode !== "url"; return prev(); }
      const a = e.target.closest("[data-act]"); if (!a) return;
      if (a.dataset.act === "photo") return pickPhoto();
      if (a.dataset.act === "nophoto") { photo = ""; return bc(); }
      const button = btnMode === "play" ? "play" : btnMode === "url" ? { text: $("#abBtnText").value.trim(), url: $("#abBtnUrl").value.trim() } : null;
      const test = a.dataset.act === "test";
      if (!draft.trim() && !photo) return toast("Пустое сообщение");
      if (!test && !confirm("Разослать всем пользователям бота?")) return;
      try { const r = await api("POST", "/api/admin/broadcast", { text: draft, photo, button, test }); hap.win(); toast(test ? "Отправлено вам в бота" : `Рассылка запущена: ${r.targets} получателей`); } catch (er) { fail(er); }
    };
  }
  function pickPhoto() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const url = URL.createObjectURL(f), img = new Image();
      img.onload = async () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        try { photo = (await api("POST", "/api/upload", { data: cv.toDataURL("image/jpeg", 0.88) })).url; bc(); } catch (e) { fail(e); }
      };
      img.src = url;
    };
    inp.click();
  }

  // ---------- настройки ----------
  async function settings() {
    loading();
    let s;
    try { s = await api("GET", "/api/admin/settings"); } catch (e) { return fail(e); }
    const pct = (v) => Math.round(v * 100);
    body().innerHTML = `<h4 class="adm-h">Шансы</h4>
      <section class="list adm-form">
        <label class="adm-lab">Отдача игрокам (RTP): <b id="asRv">${pct(s.rtp)}%</b>. Чем выше, тем чаще выигрывают. Преимущество казино: <b id="asEdge">${100 - pct(s.rtp)}%</b></label>
        <div class="adm-mode"><input id="asRtp" type="range" min="0" max="100" step="1" value="${pct(s.rtp)}" class="grow"><input id="asRtpN" type="number" inputmode="numeric" min="0" max="100" value="${pct(s.rtp)}"><i>%</i></div>
        ${Object.keys(MODES).map((m) => `<div class="adm-mode"><span class="grow">${MODES[m]}</span><input type="number" inputmode="numeric" min="0" max="100" data-mode="${m}" placeholder="${pct(s.rtp)}" value="${s.modes[m] != null ? pct(s.modes[m]) : ""}"><i>%</i></div>`).join("")}
        <p class="adm-note">Пустое поле: режим берёт общий RTP. Новые шансы включаются у игрока со следующего запуска приложения.</p>
      </section>
      <h4 class="adm-h">Цены подарков</h4>
      <section class="list">
        <label class="row pn-row"><span class="grow">Рыночные цены (Fragment)</span><input type="checkbox" class="sw" data-k="market_prices" ${s.market_prices !== false ? "checked" : ""}></label>
      </section>
      <section class="list adm-form">
        <label class="adm-lab">Курс звезды для пересчёта, $ за 1 ⭐</label><input id="asStar" type="number" inputmode="decimal" step="0.001" value="${s.star_usd || 0.015}">
        <p class="adm-note">${s.prices_date ? `Цены за ${esc(s.prices_date)}, загружено ${new Date((s.prices_at || 0) * 1000).toLocaleString("ru-RU")}. ` : "Цены ещё не загружались. "}Сервер обновляет их каждые 3 часа из открытых данных Fragment (минимальная цена коллекции).</p>
        <div class="adm-btns"><button data-act="prices">Обновить цены сейчас</button></div>
      </section>
      <h4 class="adm-h">Функции</h4>
      <section class="list">
        <label class="row pn-row"><span class="grow">Пополнение звёздами</span><input type="checkbox" class="sw" data-k="deposits" ${s.deposits ? "checked" : ""}></label>
        <label class="row pn-row"><span class="grow">Бесплатное яйцо раз в день</span><input type="checkbox" class="sw" data-k="free_egg" ${s.free_egg ? "checked" : ""}></label>
        <label class="row pn-row"><span class="grow">Технические работы</span><input type="checkbox" class="sw" data-k="maintenance" ${s.maintenance ? "checked" : ""}></label>
      </section>
      <section class="list adm-form">
        <label class="adm-lab">Текст на экране техработ</label><input id="asMaint" value="${esc(s.maint_text)}" maxlength="200">
        <label class="adm-lab">Надпись на кнопке вывода</label><input id="asWd" value="${esc(s.withdraw_note)}" maxlength="200">
        <label class="adm-lab">Бонус за приглашённого друга, звёзд</label><input id="asRef" type="number" inputmode="numeric" value="${s.ref_bonus}">
      </section>
      <div class="adm-btns"><button data-act="save" class="main">Сохранить</button></div>`;
    const syncR = (v) => { v = Math.max(0, Math.min(100, Math.round(Number(v) || 0))); $("#asRtp").value = v; $("#asRtpN").value = v; $("#asRv").textContent = v + "%"; $("#asEdge").textContent = 100 - v + "%"; };
    $("#asRtp").oninput = () => syncR($("#asRtp").value);
    $("#asRtpN").oninput = () => { if ($("#asRtpN").value !== "") syncR($("#asRtpN").value); };
    body().onclick = async (e) => {
      if (e.target.closest('[data-act="prices"]')) {
        try { const r = await api("POST", "/api/admin/prices/refresh", {}); hap.win(); toast(`Цены обновлены: ${r.count} подарков, данные за ${r.date}`); settings(); } catch (er) { toast("Источник цен недоступен, попробуйте позже"); }
        return;
      }
      if (!e.target.closest('[data-act="save"]')) return;
      const modes = {};
      all("[data-mode]", body()).forEach((i) => { if (i.value.trim() === "") return; const v = Number(i.value); if (v >= 0 && v <= 100) modes[i.dataset.mode] = v / 100; });
      const flags = {};
      all("[data-k]", body()).forEach((i) => (flags[i.dataset.k] = i.checked));
      try {
        await api("POST", "/api/admin/settings", { rtp: Number($("#asRtp").value) / 100, modes, ...flags, star_usd: Number($("#asStar").value) || 0.015, maint_text: $("#asMaint").value, withdraw_note: $("#asWd").value, ref_bonus: Number($("#asRef").value) || 0 });
        hap.win(); toast("Настройки сохранены");
      } catch (er) { fail(er); }
    };
  }

  // поиск в выборе подарка
  document.addEventListener("input", (e) => {
    const i = e.target.closest && e.target.closest(".adm-gq"); if (!i) return;
    const sel = document.getElementById(i.dataset.for); if (sel) sel.innerHTML = giftOptions(i.value);
  });
  A.openAdmin = open;
  const prevBack = A.onBack;
  A.onBack = () => { if (view && view.classList.contains("on")) return close(); if (prevBack) prevBack(); };
  // ссылка из бота ?admin=1 сразу открывает админку
  if (new URLSearchParams(location.search).get("admin") === "1") setTimeout(() => { if (A.isAdmin) open(); else setTimeout(() => A.isAdmin && open(), 2500); }, 1500);
})();
