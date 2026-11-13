// Режим «Арена»: у каждого игрока сектор поля размером с долю его ставки.
// Мяч летит по полю и останавливается в секторе победителя, победитель забирает банк.
// Сервера пока нет, поэтому соперники здесь боты. Источник игроков собран в ArenaRoom,
// чтобы потом заменить его комнатой с живыми игроками.
(() => {
  "use strict";
  const A = window.App, { $, STAR, fmt, fmtS, pct } = A;
  const C = 200, RF = 168, RB = 180;                    // центр, радиус для мяча, радиус поля
  const COLORS = ["#2f8ef5", "#ff9f0a", "#34c759", "#ff375f", "#bf5af2", "#64d2ff"];
  const NAMES = ["Артём", "Лиза", "Макс", "Даша", "Тимур", "Ника", "Егор", "Соня", "Марк", "Алина"];
  let players = [], running = false, lastWinner = null;

  const ArenaRoom = {
    // подбирает соперников под ставку игрока
    opponents(myValue) {
      const n = 1 + Math.floor(Math.random() * 4), pool = [...NAMES].sort(() => Math.random() - 0.5);
      return Array.from({ length: n }, (_, i) => ({ name: pool[i], bot: true, value: Math.max(10, Math.round((myValue * (0.4 + Math.random() * 1.8)) / 5) * 5) }));
    },
  };

  const pot = () => players.reduce((a, p) => a + p.value, 0);
  const pt = (deg, r) => { const a = (deg * Math.PI) / 180; return [C + Math.sin(a) * r, C - Math.cos(a) * r]; };
  function layout() {                                   // углы секторов по часовой стрелке от верха
    const total = pot(); let a = 0;
    players.forEach((p, i) => { p.share = p.value / total; p.a0 = a; a += p.share * 360; p.a1 = a; p.color = COLORS[i % COLORS.length]; });
  }
  function sectorPath(p) {
    if (p.share >= 0.9999) return `M${C} ${C - RB} A${RB} ${RB} 0 1 1 ${C - 0.01} ${C - RB} Z`;
    const [x0, y0] = pt(p.a0, RB), [x1, y1] = pt(p.a1, RB);
    return `M${C} ${C} L${x0.toFixed(2)} ${y0.toFixed(2)} A${RB} ${RB} 0 ${p.a1 - p.a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
  }

  function render() {
    const winner = lastWinner;
    const svg = $("#arenaSectors"), list = $("#arenaList"), v = A.stakeValue();
    if (!players.length) {
      svg.innerHTML = `<circle cx="${C}" cy="${C}" r="${RB}" class="a-empty"/>`;
      $("#arenaLabels").innerHTML = "";
      list.innerHTML = `<div class="row"><span class="grow hint">Сделайте ставку. Соперники подберутся сами</span></div>`;
      $("#arenaPot").innerHTML = `${STAR} 0`;
    } else {
      layout();
      svg.innerHTML = players.map((p, i) => `<path d="${sectorPath(p)}" fill="${p.color}" class="a-sec ${winner != null ? (winner === i ? "win" : "dim") : ""}"/>`).join("");
      $("#arenaLabels").innerHTML = players.map((p) => {
        const [x, y] = pt((p.a0 + p.a1) / 2, p.share > 0.999 ? 0 : RB * 0.6);
        return p.share < 0.06 ? "" : `<span class="a-lab" style="left:${x / 4}%;top:${y / 4}%"><b>${p.me ? "Вы" : p.name.charAt(0)}</b><i>${pct(p.share)}</i></span>`;
      }).join("");
      list.innerHTML = players.map((p, i) => `<div class="row ${winner === i ? "a-won" : ""}">
        <i class="a-dot" style="background:${p.color}"></i><span class="grow">${p.me ? "Вы" : p.name}${p.bot ? ` <em class="tag">бот</em>` : ""}</span>
        <span class="hint">${pct(p.share)}</span><b>${STAR} ${fmtS(p.value)}</b></div>`).join("");
      $("#arenaPot").innerHTML = `${STAR} ${fmtS(pot())}`;
    }
    if (!running) A.setCta({ html: v ? `Выйти на арену за ${STAR}${fmt(v)}` : "Выберите ставку", disabled: !v, fn: act });
  }

  // Траектория с честными отскоками от борта. Перебираем направление и длину пути,
  // пока мяч не остановится внутри сектора победителя.
  function findPath(w) {
    const span = w.a1 - w.a0, margin = Math.min(7, span * 0.2);
    for (let tries = 0; tries < 20000; tries++) {
      let x = 0, y = 0, th = Math.random() * Math.PI * 2, dx = Math.cos(th), dy = Math.sin(th);
      let left = RF * (5 + Math.random() * 4);
      const pts = [[C, C]];
      while (left > 0) {
        const b = x * dx + y * dy, c = x * x + y * y - RF * RF, hit = -b + Math.sqrt(b * b - c);
        if (hit >= left) { x += dx * left; y += dy * left; left = 0; }
        else {
          x += dx * hit; y += dy * hit; left -= hit;
          const nx = x / RF, ny = y / RF, d = dx * nx + dy * ny;
          dx -= 2 * d * nx; dy -= 2 * d * ny;
        }
        pts.push([C + x, C + y]);
      }
      const r = Math.hypot(x, y), ang = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
      if (pts.length >= 6 && r > RF * 0.25 && r < RF * 0.88 && ang > w.a0 + margin && ang < w.a1 - margin) return pts;
    }
    const [fx, fy] = pt((w.a0 + w.a1) / 2, RF * 0.6);   // запасной вариант: прямой удар в сектор
    return [[C, C], [fx, fy]];
  }

  // сектор, над которым сейчас мяч
  function sectorAt(x, y) {
    const ang = ((Math.atan2(x - C, -(y - C)) * 180) / Math.PI + 360) % 360;
    for (let i = 0; i < players.length; i++) if (ang >= players[i].a0 && ang < players[i].a1) return i;
    return players.length - 1;
  }
  function setHot(i) {
    document.querySelectorAll("#arenaSectors .a-sec").forEach((el, k) => el.classList.toggle("hot", k === i));
    document.querySelectorAll("#arenaList .row").forEach((el, k) => el.classList.toggle("a-hot", k === i));
  }

  function fly(pts) {
    const segs = [], ball = $("#arenaBall"), skin = $(".a-ball-in", ball), trail = $("#arenaTrail");
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
    const dur = A.REDUCED ? 600 : A.state().fast ? 3500 : 7000 + Math.random() * 2000;
    const k = ball.parentNode.clientWidth / 400;
    trail.classList.add("fade");
    return new Promise((resolve) => {
      const start = performance.now(); let seg = 0, hot = -1, squashT = 0;
      (function frame(now) {
        const u = Math.min(1, (now - start) / dur);
        const done = total * (1 - Math.pow(1 - u, 4));     // долгий медленный докат в конце
        let s = done, i = 0;
        while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; }
        if (i !== seg) { seg = i; squashT = now; A.hap.bounce(); }
        const f = Math.min(1, s / segs[i]);
        const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
        const sq = Math.max(0, 1 - (now - squashT) / 160) * 0.22;
        ball.style.transform = `translate(${x * k - 15}px, ${y * k - 15}px) scale(${(1 + sq).toFixed(3)}, ${(1 - sq).toFixed(3)})`;
        skin.style.transform = `rotate(${(done * 2.2).toFixed(1)}deg)`;
        const h = sectorAt(x, y);
        if (h !== hot) { hot = h; setHot(h); A.hap.tick(120); }
        if (u < 1) requestAnimationFrame(frame); else { A.hap.stop(); resolve(); }
      })(start);
    });
  }

  async function act() {
    if (running || !A.stakeValue()) return;
    running = true; A.busy = true;
    A.setCta({ html: "Ждём соперников", disabled: true });
    const st = A.takeStake(), bet = st.value, field = $("#arenaField"), center = $("#arenaCenter"), ball = $("#arenaBall");
    const trail = $("#arenaTrail");
    trail.classList.remove("on", "fade"); ball.hidden = true;
    lastWinner = null;
    players = [{ name: "Вы", me: true, value: bet }];
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    for (const bot of ArenaRoom.opponents(bet)) { await A.wait(A.REDUCED ? 50 : 520); players.push(bot); render(); }
    center.hidden = false;
    for (let n = 3; n >= 1; n--) { center.textContent = n; A.hap.hit(); await A.wait(A.REDUCED ? 80 : 650); }
    center.hidden = true;

    // победитель определяется числом раунда по долям ставок
    const round = A.nextRound();
    let acc = 0, wi = players.length - 1;
    for (let i = 0; i < players.length; i++) { acc += players[i].share; if (round.roll < acc) { wi = i; break; } }
    const w = players[wi], pts = findPath(w), total = pot();
    const k = field.clientWidth / 400;
    ball.hidden = false;
    ball.style.transform = `translate(${C * k - 15}px, ${C * k - 15}px)`;
    trail.setAttribute("points", pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "));
    trail.classList.add("on");                       // траектория видна до удара
    A.setCta({ html: "Мяч в игре", disabled: true });
    A.hap.hit();
    await A.wait(A.REDUCED ? 50 : 1200);
    await fly(pts);

    running = false; A.busy = false;
    lastWinner = wi;
    render();
    const stats = A.state().stats, me = players[0];
    A.log({ mode: "arena", win: !!w.me, bet, id: null, mult: w.me ? (total * A.HOUSE) / bet : 0, ...round,
      text: `Арена, игроков ${players.length}, банк ${fmt(total)}. Ваша доля ${pct(me.share)}, победил ${w.me ? "вы" : w.name}` });
    if (w.me) {
      const r = A.payout(total * A.HOUSE);
      stats.wins++; stats.arenaWins++; stats.best = Math.max(stats.best, r.value); A.save();
      A.showPrize({ gift: r.gift, uid: r.uid, stars: r.stars, sub: `банк ${fmtS(total)}` });
    } else {
      A.save();
      A.showMiss(`Победил ${w.name}`, `−${fmt(bet)} ${STAR}`);
    }
    A.renderStake();
  }

  A.registerMode("arena", {
    init() {},
    enter() { if (!running) render(); },
    onStake() { if (!running) { if (A.stakeValue() && players.length) { players = []; lastWinner = null; $("#arenaTrail").classList.remove("on", "fade"); $("#arenaBall").hidden = true; } render(); } },
    lockStake() { return running; },
    findPath, layout, _set(p) { players = p; lastWinner = null; }, _get: () => players,
  });
})();
