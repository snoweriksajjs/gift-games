// Режим «Краш». Раунды идут сами: приём ставок, полёт, краш, пауза.
// Множитель растёт, пока ракета летит. Нужно забрать раньше, чем она взорвётся.
// В Telegram раунд общий для всех: его разыгрывает сервер (server/games.py), в списке живые игроки.
// Без сервера (локальная проверка) раунды считаются на устройстве, а соперники боты.
(() => {
  "use strict";
  const A = window.App, { $, STAR, fmt, fmtS, xf, esc, safeUrl } = A;
  const SPEED = 0.09;                       // множитель = e^(SPEED * секунды)
  const BET_MS = 6000, END_MS = 3000;
  const NAMES = ["Артём", "Лиза", "Макс", "Даша", "Тимур", "Ника", "Егор", "Соня", "Марк", "Алина", "Рома", "Вика"];
  const crashPoint = (roll) => Math.min(1000, Math.max(1, Math.floor((A.rtp("crash") / (1 - roll)) * 100) / 100));

  let cv, ctx, W = 0, H = 0, raf = 0, active = false;
  let phase = "bet", phaseT = 0, round = null, cp = 1, m = 1, frameN = 0, lastNowId = null;
  let my = null;                            // { bet, cashed }
  let bots = [], stars = [], sparks = [], smoke = [], hist = [];
  let rx = 0, ry = 0;                       // где сейчас ракета
  let rider = null;                         // анимация утки на ракете
  const RS = 110, AX = 0.25, AY = 0.76;      // размер ракеты и точка у сопла, к которой крепится линия

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
    const x0 = 22, y0 = H - 22, x1 = W * 0.7, y1 = H * 0.5;
    if (phase === "bet") { placeRocket(x0 + 6, y0 - 4, 18); return; }
    // кривая полёта: ракета доходит до правого верхнего угла и дальше остаётся там, кривая сжимается
    const t = Math.log(m) / SPEED, tMax = Math.max(8, t), mMax = Math.max(2, m);
    const px = (tt) => x0 + (tt / tMax) * (x1 - x0), py = (mm) => y0 - ((mm - 1) / (mMax - 1)) * (y0 - y1);
    const pts = [];
    const N = 48;
    for (let i = 0; i <= N; i++) { const tt = (t * i) / N; pts.push([px(tt), py(Math.exp(SPEED * tt))]); }
    rx = pts[N][0]; ry = pts[N][1];
    const [r1, g1, b1] = crashed ? [255, 91, 107] : [93, 242, 166];
    const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i <= N; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
    // заливка под линией
    path(); ctx.lineTo(rx, y0); ctx.lineTo(x0, y0); ctx.closePath();
    const fg = ctx.createLinearGradient(0, ry, 0, y0);
    fg.addColorStop(0, `rgba(${r1},${g1},${b1},.16)`); fg.addColorStop(1, `rgba(${r1},${g1},${b1},0)`);
    ctx.fillStyle = fg; ctx.fill();
    // линия: от прозрачного хвоста к яркому носу, мягкое свечение под ней
    const lg = ctx.createLinearGradient(x0, y0, rx, ry);
    lg.addColorStop(0, `rgba(${r1},${g1},${b1},.08)`); lg.addColorStop(0.55, `rgba(${r1},${g1},${b1},.75)`); lg.addColorStop(1, `rgb(${Math.min(255, r1 + 90)},${Math.min(255, g1 + 13)},${Math.min(255, b1 + 60)})`);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    path(); ctx.lineWidth = 12; ctx.strokeStyle = `rgba(${r1},${g1},${b1},.14)`; ctx.stroke();
    path(); ctx.lineWidth = 4.5; ctx.strokeStyle = lg; ctx.stroke();
    // метки игроков, которые уже забрали
    for (const b of bots) {
      if (!b.cashed || b.cashed > m) continue;
      const bx = px(Math.log(b.cashed) / SPEED), by = py(b.cashed);
      ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, 7); ctx.fill();
    }
    if (!crashed) {
      // свечение у сопла
      const hg = ctx.createRadialGradient(rx, ry, 0, rx, ry, 26);
      hg.addColorStop(0, "rgba(255,214,120,.55)"); hg.addColorStop(1, "rgba(255,214,120,0)");
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(rx, ry, 26, 0, 7); ctx.fill();
      const back = pts[Math.max(0, N - 12)], ang = Math.atan2(back[1] - ry, rx - back[0]);
      placeRocket(rx, ry, Math.max(4, Math.min(30, (ang * 180) / Math.PI * 0.7)));
      // выхлоп: искры летят назад от сопла
      if (flying && smoke.length < 70) for (let k = 0; k < 2; k++) {
        // направление полёта на экране (cos, -sin), выхлоп летит в обратную сторону с разбросом
        const a = ang + (Math.random() - 0.5) * 0.7, sp = 0.6 + Math.random() * 1.6;
        smoke.push({ x: rx, y: ry, vx: -Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 1.2 + Math.random() * 2.2, life: 1,
          c: ["#ffe27a", "#ffb347", "#ff8a3d", "#ffffff"][(Math.random() * 4) | 0] });
      }
    }
    for (const p of smoke) {
      p.x += p.vx; p.y += p.vy; p.life -= 0.035; p.s *= 0.985;
      if (p.life <= 0) continue;
      ctx.globalAlpha = p.life * 0.9; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1; smoke = smoke.filter((p) => p.life > 0);
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

  // ракета крепится соплом к концу линии и смотрит по направлению полёта
  function placeRocket(x, y, deg) {
    $("#crRocket").style.transform = `translate(${(x - RS * AX).toFixed(1)}px, ${(y - RS * AY).toFixed(1)}px) rotate(${(-deg + 6).toFixed(1)}deg)`;
  }

  // ---------- списки ----------
  function renderHist() {
    $("#crHist").innerHTML = hist.length ? hist.map((x) => `<span class="${x >= 2 ? "hi" : ""}">${xf(x)}</span>`).join("")
      : `<span class="hint-pill">Прошлые раунды появятся здесь</span>`;
  }
  function renderPlayers() {
    const row = (name, bet, state, cls, tag, photo) => (name = String(name || "Игрок"), photo = safeUrl(photo), `<div class="row ${cls}"><span class="ava sm ${photo ? "" : "tint"}" style="--h:${(name.length * 47) % 360};${photo ? `background-image:url('${photo}')` : ""}">${photo ? "" : esc(name.charAt(0))}</span>
      <span class="grow">${esc(name)}${tag ? ` <em class="tag">бот</em>` : ""}</span><span class="hint">${STAR} ${fmtS(bet)}</span><b>${state}</b></div>`);
    const st = (p) => p.cashed ? `${xf(p.cashed)}` : phase === "end" ? "сгорело" : phase === "fly" ? "в игре" : "готов";
    const cls = (p) => p.cashed ? "cr-ok" : phase === "end" ? "cr-bad" : "";
    let html = my ? row("Вы", my.bet, st(my), cls(my) + " me", false) : "";
    html += bots.filter((b) => b.joined).map((b) => row(b.name, b.bet, st(b), cls(b), !online, b.photo)).join("");
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
    if (my && phase === "fly" && !my.cashed) return A.setCta({ html: `Забрать ${STAR}${fmtS(my.bet * m)}`, fn: () => (online ? cashOnline() : cash(m)) });
    if (online && phase === "bet" && !my) return A.setCta({ html: v ? `Поставить ${STAR}${fmt(v)}` : "Выберите ставку", disabled: !v, fn: betOnline });
    if (my && !my.cashed && phase === "bet") return A.setCta({ html: "Ставка принята", disabled: true });
    if (phase === "bet") return A.setCta({ html: v ? `Поставить ${STAR}${fmt(v)}` : "Выберите ставку", disabled: !v, fn: bet });
    A.setCta({ html: "Ждём следующий раунд", disabled: true });
  }

  // ---------- фазы ----------
  function newRound(now) {
    phase = "bet"; phaseT = now; m = 1; my = null; lastNowId = null; sparks = []; smoke = [];
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

  // ---------- онлайн: общий раунд с сервера ----------
  let online = false, srv = null, off = 0, pollTimer = 0, sending = false, claimedRound = null, pollGen = 0;
  const srvNow = () => Date.now() + off;
  // один опрос за раз: при повторном входе в режим старая цепочка опросов останавливается
  async function poll(gen = ++pollGen) {
    clearTimeout(pollTimer);
    if (!active || !online || gen !== pollGen) return;
    try { const s = await A.api("GET", "/api/crash"); if (gen !== pollGen) return; off = s.now - Date.now(); onState(s); } catch {}
    if (gen === pollGen) pollTimer = setTimeout(() => poll(gen), phase === "fly" ? 400 : 900);
  }
  function onState(s) {
    const fresh = !srv || srv.id !== s.id;
    srv = s;
    hist = s.history || [];
    if (fresh) {                                           // новый раунд
      phase = "bet"; m = 1; lastNowId = null; sparks = []; smoke = []; cp = 1;
      my = s.my ? { bet: s.my.bet, cashed: s.my.cashed || 0 } : null;
      const box = $("#crashBox"); box.classList.remove("boom", "won", "fly");
      $("#crRocket").classList.remove("gone"); $("#crashMult").textContent = "×1,00";
      renderHist(); renderNow(true);
      if (s.phase === "end") {                             // зашли, когда ракета уже взорвалась: без повторного взрыва
        phase = "end"; cp = m = s.cp;
        box.classList.add("boom"); $("#crRocket").classList.add("gone");
        $("#crashMult").textContent = xf(cp); $("#crashNote").textContent = "Взорвалась";
      } else if (s.phase === "fly") { phase = "fly"; box.classList.add("fly"); $("#crashNote").textContent = "Летит"; }
    }
    if (s.my) {
      if (!my) my = { bet: s.my.bet, cashed: 0 };
      if (s.my.cashed && !my.cashed) { my.cashed = s.my.cashed; onCashed(s.my.cashed, s.my.grant, s.my.held); }   // сработал автовывод
    }
    bots = s.bets.filter((b) => b.id !== A.myId).map((b) => ({ name: b.name, photo: b.photo, bet: b.bet, cashed: b.cashed || 0, joined: true }));
    if (s.phase === "fly" && phase === "bet") { phase = "fly"; $("#crashBox").classList.add("fly"); $("#crashNote").textContent = "Летит"; }
    if (s.phase === "end" && phase !== "end") { cp = s.cp; boomOnline(); }
    renderPlayers(); setCta();
  }
  async function betOnline() {
    const v = A.stakeValue();
    if (phase !== "bet" || my || !v || sending) return;
    const mb = (A.live && A.live.max_bet) || 100000;
    if (v > mb) return A.toast(`Максимальная ставка ${fmt(mb)} звёзд`);
    sending = true;
    const gifts = A.state().inv.filter((it) => A.stake.uids.has(it.uid)).map((it) => it.id);
    try {
      await A.api("POST", "/api/crash/bet", { bet: v, auto: Number($("#crashAuto").value) || 0, gifts });
      A.takeStake();
      my = { bet: v, cashed: 0 };
      A.busy = true; A.hap.hit();
      renderPlayers(); renderNow(true); setCta();
    } catch (e) { A.toast(e.status === 409 ? "Приём ставок закрыт, ждите следующий раунд" : e.status === 400 ? "Проверьте ставку и автовывод: автовывод от ×1,01 до ×999" : "Нет связи с сервером"); }
    finally { sending = false; }
  }
  async function cashOnline() {
    if (!my || my.cashed || phase !== "fly" || sending) return;
    sending = true;
    try {
      const r = await A.api("POST", "/api/crash/cashout", {});
      my.cashed = r.cashed;
      onCashed(r.cashed, r.grant, r.held);
    } catch (e) { A.toast(e.status === 409 ? "Не успели: ракета взорвалась" : "Не получилось забрать, нажмите ещё раз"); }
    finally { sending = false; }
  }
  function onCashed(at, grant, held) {
    if (claimedRound === srv.id) return;
    claimedRound = srv.id;
    A.busy = false;
    const stats = A.state().stats; stats.bestCrash = Math.max(stats.bestCrash, at); A.save();
    $("#crashBox").classList.add("won");
    A.log({ mode: "crash", win: true, bet: my.bet, id: null, mult: at, text: `Краш онлайн, забрано на ${xf(at)}. Хеш раунда ${srv.hash.slice(0, 16)}…` });
    if (held) A.toast("Крупный выигрыш: придёт после проверки администратором");
    else A.claimGrant(grant);                                // выигрыш выдаёт сервер
    renderPlayers(); renderNow(true); setCta();
  }
  function boomOnline() {
    phase = "end"; m = cp;
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
      A.log({ mode: "crash", win: false, bet: my.bet, id: null, mult: 0, text: `Краш онлайн, точка ${xf(cp)}. Ставка не забрана. Число раунда ${srv.seed}` });
      A.showMiss("Ракета взорвалась", `на ${xf(cp)} · −${fmt(my.bet)} ${STAR}`);
    }
    renderHist(); renderPlayers(); renderNow(true); setCta();
  }
  function frameOnline(now) {
    if (!active) return;
    raf = requestAnimationFrame(frameOnline);
    frameN++;
    if (!srv) return draw(now, false, false);
    if (phase === "bet") {
      if (frameN % 6 === 0) $("#crashNote").textContent = `Старт через ${Math.max(0, Math.ceil((srv.bet_end - srvNow()) / 1000))}`;
      return draw(now, false, false);
    }
    if (phase === "fly") {
      m = Math.exp((srv.speed * Math.max(0, srvNow() - srv.t0)) / 1000);
      draw(now, true, false);
      if (frameN % 3 === 0) { $("#crashMult").textContent = xf(m); if (my && !my.cashed) setCta(); }
      if (frameN % 8 === 0) renderNow(false);
      if (my && !my.cashed) A.hap.rise(m);
      return;
    }
    draw(now, false, true);
  }

  A.registerMode("crash", {
    init() {
      cv = $("#crashCv"); ctx = cv.getContext("2d");
      if (window.lottie) fetch("ducks/rider.json?v=7").then((r) => r.json()).then((data) => {
        rider = window.lottie.loadAnimation({ container: $("#crRocket"), renderer: "svg", loop: true, autoplay: !A.REDUCED, animationData: data });
        if (!active) rider.pause();
      }).catch(() => {});
      hist = (A.state().crashHist || []).slice(0, 12);
      addEventListener("resize", () => { if (active) size(); });
    },
    enter() {
      active = true; size(); renderHist();
      online = !!(A.apiReady && A.apiReady());
      cancelAnimationFrame(raf);
      if (online) {                                        // общий раунд с сервера
        $("#crPlayersHead") && ($("#crPlayersHead").textContent = "Игроки онлайн");
        poll(); raf = requestAnimationFrame(frameOnline);
        if (rider && !A.REDUCED) rider.play();
        return;
      }
      if (!round || phase === "end" || (phase === "fly" && !my)) newRound(performance.now()); else { phaseT = performance.now() - (phase === "bet" ? 0 : (Math.log(m) / SPEED) * 1000); setCta(); }
      raf = requestAnimationFrame(frame);
      if (rider && !A.REDUCED) rider.play();
    },
    leave() { active = false; pollGen++; cancelAnimationFrame(raf); clearTimeout(pollTimer); if (rider) rider.pause(); },
    onStake() { if (active) setCta(); },
    lockStake() { return !!(my && !my.cashed && phase !== "end"); },
    crashPoint,
    _dbg: () => ({ phase, cp, m, my, bots }),
  });
})();
