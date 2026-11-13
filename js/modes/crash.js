// Режим «Краш». Раунды идут сами: приём ставок, полёт, краш, пауза.
// Множитель растёт, пока ракета летит. Нужно забрать раньше, чем она взорвётся.
// Сервера пока нет, поэтому остальные игроки в списке боты.
(() => {
  "use strict";
  const A = window.App, { $, STAR, fmt, fmtS, xf } = A;
  const SPEED = 0.09;                       // множитель = e^(SPEED * секунды)
  const BET_MS = 6000, END_MS = 3000;
  const NAMES = ["Артём", "Лиза", "Макс", "Даша", "Тимур", "Ника", "Егор", "Соня", "Марк", "Алина", "Рома", "Вика"];
  const crashPoint = (roll) => Math.min(1000, Math.max(1, Math.floor((A.HOUSE / (1 - roll)) * 100) / 100));

  let cv, ctx, W = 0, H = 0, raf = 0, active = false;
  let phase = "bet", phaseT = 0, round = null, cp = 1, m = 1, frameN = 0, lastNowId = null;
  let my = null;                            // { bet, cashed }
  let bots = [], stars = [], sparks = [], hist = [];
  let rx = 0, ry = 0;                       // где сейчас ракета

  function size() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!stars.length) stars = Array.from({ length: 70 }, (_, i) => ({ x: Math.random(), y: Math.random(), z: 1 + (i % 3), tw: Math.random() * 6 }));
  }

  // ---------- рисование ----------
  function draw(now, flying, crashed) {
    ctx.clearRect(0, 0, W, H);
    // звёзды в три слоя: дальние медленнее, скорость растёт с множителем
    const v = (flying ? 0.0009 + Math.min(m, 30) * 0.0005 : 0.00018);
    for (const s of stars) {
      s.x -= v * s.z; s.y += v * s.z * 0.55;
      if (s.x < 0) { s.x = 1; s.y = Math.random(); }
      if (s.y > 1) { s.y = 0; s.x = Math.random(); }
      const a = 0.25 + 0.2 * s.z + 0.15 * Math.sin(now / 400 + s.tw);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      const len = flying ? Math.min(14, s.z * (1 + m * 0.5)) : 0;
      if (len > 2) { ctx.fillRect(s.x * W, s.y * H, len, s.z * 0.6); } else { ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.z * 0.55, 0, 7); ctx.fill(); }
    }
    if (phase === "bet") return;
    // кривая полёта: ракета доходит до правого верхнего угла и дальше остаётся там, кривая сжимается
    const t = Math.log(m) / SPEED, tMax = Math.max(8, t), mMax = Math.max(2, m);
    const x0 = 18, y0 = H - 18, x1 = W * 0.8, y1 = H * 0.3;
    const px = (tt) => x0 + (tt / tMax) * (x1 - x0), py = (mm) => y0 - ((mm - 1) / (mMax - 1)) * (y0 - y1);
    const color = crashed ? "#ff5b6b" : "#5df2a6";
    ctx.beginPath(); ctx.moveTo(px(0), py(1));
    const N = 40;
    for (let i = 1; i <= N; i++) { const tt = (t * i) / N; ctx.lineTo(px(tt), py(Math.exp(SPEED * tt))); }
    ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.lineTo(px(t), y0); ctx.lineTo(x0, y0); ctx.closePath();
    const g = ctx.createLinearGradient(0, y1, 0, y0);
    g.addColorStop(0, crashed ? "rgba(255,91,107,.28)" : "rgba(93,242,166,.3)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fill();
    // метки ботов, которые уже забрали
    for (const b of bots) {
      if (!b.cashed) continue;
      const bx = px(Math.log(b.cashed) / SPEED), by = py(b.cashed);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, 7); ctx.fill();
    }
    rx = px(t); ry = py(m);
    const t2 = Math.max(0, t - 0.25), ang = Math.atan2(py(Math.exp(SPEED * t2)) - ry, rx - px(t2));
    if (!crashed) $("#crRocket").style.transform = `translate(${rx - 23}px, ${ry - 23}px) rotate(${(45 - (ang * 180) / Math.PI).toFixed(1)}deg)`;
    // осколки после взрыва
    if (sparks.length) {
      for (const p of sparks) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.018;
        if (p.life <= 0) continue;
        ctx.globalAlpha = p.life; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1; sparks = sparks.filter((p) => p.life > 0);
    }
  }

  // ---------- списки ----------
  function renderHist() {
    $("#crHist").innerHTML = hist.length ? hist.map((x) => `<span class="${x >= 2 ? "hi" : ""}">${xf(x)}</span>`).join("")
      : `<span class="hint-pill">Прошлые раунды появятся здесь</span>`;
  }
  function renderPlayers() {
    const row = (name, bet, state, cls, tag) => `<div class="row ${cls}"><span class="ava sm">${name.charAt(0)}</span>
      <span class="grow">${name}${tag ? ` <em class="tag">бот</em>` : ""}</span><span class="hint">${STAR} ${fmtS(bet)}</span><b>${state}</b></div>`;
    const st = (p) => p.cashed ? `${xf(p.cashed)}` : phase === "end" ? "сгорело" : phase === "fly" ? "в игре" : "готов";
    const cls = (p) => p.cashed ? "cr-ok" : phase === "end" ? "cr-bad" : "";
    let html = my ? row("Вы", my.bet, st(my), cls(my) + " me", false) : "";
    html += bots.filter((b) => b.joined).map((b) => row(b.name, b.bet, st(b), cls(b), true)).join("");
    $("#crPlayers").innerHTML = html || `<div class="row"><span class="grow hint">Ставок пока нет</span></div>`;
  }
  function renderNow(force) {
    const box = $("#crNow");
    if (!my) { if (force) { box.classList.remove("has"); $("#crNowBody").innerHTML = ""; $("#crNowText").textContent = "Поставьте, пока идёт приём ставок"; } lastNowId = null; return; }
    const value = Math.floor(my.bet * (my.cashed || m)), g = A.bestGift(value), id = g ? g.id : "stars";
    box.classList.add("has");
    $("#crNowText").innerHTML = `${my.cashed ? "Забрали" : phase === "end" ? "Сгорело" : "Заберёте сейчас"} <b>${STAR} ${fmt(value)}</b>`;
    if (id !== lastNowId) {
      lastNowId = id;
      $("#crNowBody").innerHTML = g ? A.chip(g, "sm") : `<span class="chip sm stars">${STAR}</span>`;
      if (phase === "fly") { box.classList.remove("pulse"); void box.offsetWidth; box.classList.add("pulse"); A.hap.soft(); }
    }
  }
  function setCta() {
    const v = A.stakeValue();
    if (my && phase === "fly" && !my.cashed) return A.setCta({ html: `Забрать ${STAR}${fmtS(my.bet * m)}`, fn: () => cash(m) });
    if (my && !my.cashed && phase === "bet") return A.setCta({ html: "Ставка принята", disabled: true });
    if (phase === "bet") return A.setCta({ html: v ? `Поставить ${STAR}${fmt(v)}` : "Выберите ставку", disabled: !v, fn: bet });
    A.setCta({ html: "Ждём следующий раунд", disabled: true });
  }

  // ---------- фазы ----------
  function newRound(now) {
    phase = "bet"; phaseT = now; m = 1; my = null; lastNowId = null; sparks = [];
    round = A.nextRound(); cp = crashPoint(round.roll);
    const n = 3 + Math.floor(Math.random() * 4), pool = [...NAMES].sort(() => Math.random() - 0.5);
    bots = Array.from({ length: n }, (_, i) => ({
      name: pool[i], bet: [50, 100, 150, 250, 400, 600, 1000, 2500][Math.floor(Math.random() * 8)],
      aim: 1.05 + Math.pow(Math.random(), 2.2) * 6, joinAt: 400 + Math.random() * (BET_MS - 1200), joined: false, cashed: 0,
    }));
    const box = $("#crashBox"); box.classList.remove("boom", "won", "fly");
    $("#crRocket").classList.remove("gone");
    $("#crashMult").textContent = "×1,00";
    renderPlayers(); renderNow(true); setCta();
  }
  function bet() {
    if (phase !== "bet" || my || !A.stakeValue()) return;
    const st = A.takeStake();
    my = { bet: st.value, cashed: 0 };
    A.busy = true; A.hap.hit();
    renderPlayers(); renderNow(true); setCta();
  }
  function cash(at) {
    if (!my || my.cashed || phase !== "fly") return;
    my.cashed = at; A.busy = false;
    const r = A.payout(my.bet * at), stats = A.state().stats;
    stats.wins++; stats.best = Math.max(stats.best, r.value); stats.bestCrash = Math.max(stats.bestCrash, at);
    $("#crashBox").classList.add("won");
    A.log({ mode: "crash", win: true, bet: my.bet, id: r.gift ? r.gift.id : null, mult: at, ...round, text: `Краш, точка ${xf(cp)}. Забрано на ${xf(at)}` });
    A.showPrize({ gift: r.gift, uid: r.uid, stars: r.stars, sub: xf(at) });
    renderPlayers(); renderNow(true); setCta();
  }
  function boom(now) {
    phase = "end"; phaseT = now; m = cp;
    hist.unshift(cp); hist = hist.slice(0, 12); A.state().crashHist = hist;
    const box = $("#crashBox"); box.classList.remove("fly"); box.classList.add("boom");
    $("#crRocket").classList.add("gone");
    $("#crashMult").textContent = xf(cp); $("#crashNote").textContent = "Взорвалась";
    sparks = Array.from({ length: 46 }, () => {
      const a = Math.random() * 7, sp = 1 + Math.random() * 5;
      return { x: rx, y: ry, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, s: 1.5 + Math.random() * 2.5, life: 1, c: ["#ffd84d", "#ff8a3d", "#ff5b6b", "#fff"][(Math.random() * 4) | 0] };
    });
    A.hap.boom();
    if (my && !my.cashed) {
      A.busy = false;
      A.log({ mode: "crash", win: false, bet: my.bet, id: null, mult: 0, ...round, text: `Краш, точка ${xf(cp)}. Ставка не забрана` });
      A.showMiss("Ракета взорвалась", `на ${xf(cp)} · −${fmt(my.bet)} ${STAR}`);
    }
    A.save();
    renderHist(); renderPlayers(); renderNow(true); setCta();
  }

  function frame(now) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    frameN++;
    if (phase === "bet") {
      const left = BET_MS - (now - phaseT);
      for (const b of bots) if (!b.joined && now - phaseT > b.joinAt) { b.joined = true; renderPlayers(); }
      if (frameN % 6 === 0) $("#crashNote").textContent = `Старт через ${Math.max(0, Math.ceil(left / 1000))}`;
      draw(now, false, false);
      if (left <= 0) {
        phase = "fly"; phaseT = now; bots.forEach((b) => (b.joined = true));
        $("#crashBox").classList.add("fly"); $("#crashNote").textContent = "Летит";
        renderPlayers(); setCta();
      }
      return;
    }
    if (phase === "fly") {
      m = Math.exp((SPEED * (now - phaseT)) / 1000);
      if (m >= cp) return boom(now);
      const auto = Number($("#crashAuto").value);
      if (my && !my.cashed && auto >= 1.01 && m >= auto) cash(auto);
      let changed = false;
      for (const b of bots) if (!b.cashed && m >= b.aim) { b.cashed = b.aim; changed = true; }
      if (changed) renderPlayers();
      draw(now, true, false);
      if (frameN % 3 === 0) { $("#crashMult").textContent = xf(m); if (my && !my.cashed) setCta(); }
      if (frameN % 8 === 0) renderNow(false);
      if (my && !my.cashed) A.hap.rise(m);
      return;
    }
    draw(now, false, true);                 // пауза после взрыва
    if (now - phaseT > END_MS) newRound(now);
  }

  A.registerMode("crash", {
    init() {
      cv = $("#crashCv"); ctx = cv.getContext("2d");
      hist = (A.state().crashHist || []).slice(0, 12);
      addEventListener("resize", () => { if (active) size(); });
    },
    enter() {
      active = true; size(); renderHist();
      if (!round || phase === "end" || (phase === "fly" && !my)) newRound(performance.now()); else { phaseT = performance.now() - (phase === "bet" ? 0 : (Math.log(m) / SPEED) * 1000); setCta(); }
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    leave() { active = false; cancelAnimationFrame(raf); },
    onStake() { if (active) setCta(); },
    lockStake() { return !!(my && !my.cashed && phase !== "end"); },
    crashPoint,
    _dbg: () => ({ phase, cp, m, my, bots }),
  });
})();
