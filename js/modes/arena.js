// Режим «Арена»: квадратное поле делится на территории по долям ставок.
// Мяч бьют из центра в случайную сторону, он отскакивает от бортов по всему полю
// и останавливается на чьей-то территории. Хозяин территории забирает банк.
// Сервера пока нет, поэтому соперники здесь боты. Источник игроков собран в ArenaRoom,
// чтобы потом заменить его комнатой с живыми игроками.
(() => {
  "use strict";
  const A = window.App, { $, STAR, fmt, fmtS, pct } = A;
  const S = 400, BR = 16;                                // размер поля и радиус мяча в единицах поля
  const COLORS = ["#2f8ef5", "#ff9f0a", "#34c759", "#ff375f", "#bf5af2", "#30b0c7"];
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

  // ---------- территории: квадрат режется на прямоугольники с площадью по долям ----------
  function squarify(areas, x, y, w, h) {
    const out = new Array(areas.length);
    const items = areas.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const worst = (row, side) => {
      const s = row.reduce((a, r) => a + r.v, 0), mx = Math.max(...row.map((r) => r.v)), mn = Math.min(...row.map((r) => r.v));
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    const place = (row) => {
      const s = row.reduce((a, r) => a + r.v, 0);
      if (w >= h) {                                  // столбец слева
        const cw = s / h; let yy = y;
        row.forEach((r) => { const rh = r.v / cw; out[r.i] = { x, y: yy, w: cw, h: rh }; yy += rh; });
        x += cw; w -= cw;
      } else {                                       // строка сверху
        const rh = s / w; let xx = x;
        row.forEach((r) => { const rw = r.v / rh; out[r.i] = { x: xx, y, w: rw, h: rh }; xx += rw; });
        y += rh; h -= rh;
      }
    };
    let row = [];
    while (items.length) {
      const c = items[0], side = Math.min(w, h);
      if (!row.length || worst([...row, c], side) <= worst(row, side)) { row.push(c); items.shift(); }
      else { place(row); row = []; }
    }
    if (row.length) place(row);
    return out;
  }
  function layout() {
    const total = pot();
    const rects = squarify(players.map((p) => (p.value / total) * S * S), 0, 0, S, S);
    players.forEach((p, i) => { p.share = p.value / total; p.r = rects[i]; p.color = COLORS[i % COLORS.length]; });
  }

  function render() {
    const winner = lastWinner;
    const svg = $("#arenaSectors"), list = $("#arenaList"), v = A.stakeValue();
    if (!players.length) {
      svg.innerHTML = `<rect x="0" y="0" width="${S}" height="${S}" class="a-empty"/>`;
      $("#arenaLabels").innerHTML = `<span class="a-lab idle" style="left:50%;top:50%"><b>Поле пустое</b><i>Ставка займёт территорию</i></span>`;
      list.innerHTML = `<div class="row"><span class="grow hint">Сделайте ставку. Соперники подберутся сами</span></div>`;
      $("#arenaPot").innerHTML = `${STAR} 0`;
    } else {
      layout();
      svg.innerHTML = players.map((p, i) => `<rect x="${p.r.x.toFixed(2)}" y="${p.r.y.toFixed(2)}" width="${p.r.w.toFixed(2)}" height="${p.r.h.toFixed(2)}"
        fill="${p.color}" class="a-sec ${winner != null ? (winner === i ? "win" : "dim") : ""}"/>`).join("");
      $("#arenaLabels").innerHTML = players.map((p) => {
        const big = p.r.w > 90 && p.r.h > 56, small = p.r.w < 34 || p.r.h < 30;
        if (small) return "";
        const cx = ((p.r.x + p.r.w / 2) / S) * 100, cy = ((p.r.y + p.r.h / 2) / S) * 100;
        return `<span class="a-lab" style="left:${cx}%;top:${cy}%"><b>${p.me ? "Вы" : big ? p.name : p.name.charAt(0)}</b><i>${pct(p.share)}</i></span>`;
      }).join("");
      list.innerHTML = players.map((p, i) => `<div class="row ${winner === i ? "a-won" : ""}">
        <i class="a-dot" style="background:${p.color}"></i><span class="grow">${p.me ? "Вы" : p.name}${p.bot ? ` <em class="tag">бот</em>` : ""}</span>
        <span class="hint">${pct(p.share)}</span><b>${STAR} ${fmtS(p.value)}</b></div>`).join("");
      $("#arenaPot").innerHTML = `${STAR} ${fmtS(pot())}`;
    }
    if (!running) A.setCta({ html: v ? `Выйти на арену за ${STAR}${fmt(v)}` : "Выберите ставку", disabled: !v, fn: act });
  }

  // ---------- траектория ----------
  // Мяч летит по прямой и отражается от бортов квадрата. Перебираем случайные направления
  // и силу удара, пока мяч не остановится на территории победителя. Победитель выбран заранее
  // честным числом раунда, анимация только показывает результат.
  function trace(x, y, th, len) {
    let dx = Math.cos(th), dy = Math.sin(th), left = len;
    const pts = [[x, y]], lo = BR, hi = S - BR;
    while (left > 1e-6) {
      const tx = dx > 0 ? (hi - x) / dx : dx < 0 ? (lo - x) / dx : Infinity;
      const ty = dy > 0 ? (hi - y) / dy : dy < 0 ? (lo - y) / dy : Infinity;
      const t = Math.min(tx, ty);
      if (t >= left) { x += dx * left; y += dy * left; left = 0; }
      else {
        x += dx * t; y += dy * t; left -= t;
        if (tx <= ty) dx = -dx;
        if (ty <= tx) dy = -dy;
      }
      pts.push([x, y]);
    }
    return pts;
  }
  function findPath(w) {
    const r = w.r, m = Math.min(BR * 0.8, r.w * 0.25, r.h * 0.25);
    for (let tries = 0; tries < 30000; tries++) {
      const th = Math.random() * Math.PI * 2, len = S * (2.6 + Math.random() * 2.6);
      const pts = trace(S / 2, S / 2, th, len), [ex, ey] = pts[pts.length - 1];
      if (pts.length >= 5 && ex > r.x + m && ex < r.x + r.w - m && ey > r.y + m && ey < r.y + r.h - m) return pts;
    }
    return [[S / 2, S / 2], [r.x + r.w / 2, r.y + r.h / 2]];   // запасной вариант: прямой удар
  }

  function territoryAt(x, y) {
    for (let i = 0; i < players.length; i++) { const r = players[i].r; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i; }
    return -1;
  }
  function setHot(i) {
    document.querySelectorAll("#arenaSectors .a-sec").forEach((el, k) => el.classList.toggle("hot", k === i));
    document.querySelectorAll("#arenaList .row").forEach((el, k) => el.classList.toggle("a-hot", k === i));
  }

  // ---------- полёт ----------
  function fly(pts) {
    const segs = [], ball = $("#arenaBall"), skin = $(".a-ball-in", ball), trail = $("#arenaTrail");
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
    const dur = A.REDUCED ? 700 : A.state().fast ? 4000 : 7500 + Math.random() * 1500;
    const k = ball.parentNode.clientWidth / S, size = BR * 2 * k;
    ball.style.width = ball.style.height = size + "px";
    const tail = [];                                  // короткий след за мячом, а не путь наперёд
    trail.innerHTML = Array.from({ length: 9 }, () => `<circle r="0" />`).join("");
    const dots = [...trail.children];
    return new Promise((resolve) => {
      const start = performance.now(); let seg = 0, hot = -2, hitT = -1e9, hitAxis = 0;
      (function frame(now) {
        const u = Math.min(1, (now - start) / dur);
        const done = total * (1 - Math.pow(1 - u, 2.6));       // трение: быстро в начале, долгий докат в конце
        let s = done, i = 0;
        while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; }
        if (i !== seg) {
          seg = i; hitT = now; A.hap.bounce();
          const [bx, by] = pts[i]; hitAxis = (bx <= BR + 0.5 || bx >= S - BR - 0.5) ? 0 : 1;
        }
        const f = Math.min(1, s / segs[i]);
        const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
        const sq = Math.max(0, 1 - (now - hitT) / 170) * 0.26;   // сплющивается о борт
        const sx = hitAxis === 0 ? 1 - sq : 1 + sq, sy = hitAxis === 0 ? 1 + sq : 1 - sq;
        ball.style.transform = `translate(${(x * k - size / 2).toFixed(1)}px, ${(y * k - size / 2).toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        skin.style.transform = `rotate(${((done / (Math.PI * BR * 2)) * 360).toFixed(1)}deg)`;
        tail.unshift([x, y]); if (tail.length > 18) tail.pop();
        const speed = 1 - u;
        dots.forEach((d, j) => {
          const p = tail[j * 2]; if (!p) return;
          d.setAttribute("cx", p[0].toFixed(1)); d.setAttribute("cy", p[1].toFixed(1));
          d.setAttribute("r", (BR * (1 - j / 10) * 0.75).toFixed(1));
          d.setAttribute("opacity", (0.28 * (1 - j / 9) * Math.min(1, speed * 2.5)).toFixed(3));
        });
        const h = territoryAt(x, y);
        if (h !== hot) { hot = h; setHot(h); if (u > 0.05) A.hap.tick(110); }
        if (u < 1) requestAnimationFrame(frame);
        else { dots.forEach((d) => d.setAttribute("opacity", 0)); A.hap.stop(); resolve([x, y]); }
      })(start);
    });
  }

  async function act() {
    if (running || !A.stakeValue()) return;
    running = true; A.busy = true;
    A.setCta({ html: "Ждём соперников", disabled: true });
    const st = A.takeStake(), bet = st.value, field = $("#arenaField"), center = $("#arenaCenter"), ball = $("#arenaBall");
    $("#arenaTrail").innerHTML = ""; ball.hidden = true; $("#arenaHit").classList.remove("on");
    lastWinner = null;
    players = [{ name: "Вы", me: true, value: bet }];
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    for (const bot of ArenaRoom.opponents(bet)) { await A.wait(A.REDUCED ? 50 : 520); players.push(bot); A.hap.soft(); render(); }
    center.hidden = false;
    for (let n = 3; n >= 1; n--) { center.textContent = n; A.hap.hit(); await A.wait(A.REDUCED ? 80 : 650); }
    center.hidden = true;

    // победитель определяется числом раунда по долям ставок
    const round = A.nextRound();
    let acc = 0, wi = players.length - 1;
    for (let i = 0; i < players.length; i++) { acc += players[i].share; if (round.roll < acc) { wi = i; break; } }
    const w = players[wi], pts = findPath(w), total = pot();
    const k = field.clientWidth / S;
    ball.hidden = false;
    ball.style.transform = `translate(${(S / 2) * k - BR * k}px, ${(S / 2) * k - BR * k}px) scale(.2)`;
    A.setCta({ html: "Мяч в игре", disabled: true });
    await A.wait(60);
    ball.classList.add("drop");                      // мяч падает в центр, потом удар
    await A.wait(A.REDUCED ? 50 : 520);
    ball.classList.remove("drop");
    A.hap.hit();
    const [ex, ey] = await fly(pts);

    const hit = $("#arenaHit");                      // круг расходится там, где мяч остановился
    hit.style.left = (ex / S) * 100 + "%"; hit.style.top = (ey / S) * 100 + "%";
    hit.classList.remove("on"); void hit.offsetWidth; hit.classList.add("on");
    running = false; A.busy = false;
    lastWinner = wi;
    render(); setHot(-1);
    const stats = A.state().stats, me = players[0];
    A.log({ mode: "arena", win: !!w.me, bet, id: null, mult: w.me ? (total * A.rtp("arena")) / bet : 0, ...round,
      text: `Арена, игроков ${players.length}, банк ${fmt(total)}. Ваша доля ${pct(me.share)}, победил ${w.me ? "вы" : w.name}` });
    await A.wait(A.REDUCED ? 50 : 650);
    if (w.me) {
      const r = A.payout(total * A.rtp("arena"));
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
    onStake() {
      if (running) return;
      if (A.stakeValue() && players.length) { players = []; lastWinner = null; $("#arenaTrail").innerHTML = ""; $("#arenaBall").hidden = true; $("#arenaHit").classList.remove("on"); }
      render();
    },
    lockStake() { return running; },
    findPath, layout, trace, _set(p) { players = p; lastWinner = null; }, _get: () => players,
  });
})();
