// Режим «Серия» (как Streak на SkinBro): цепочка апгрейдов подряд.
// Игрок выбирает множитель. Каждый раунд текущий приз апгрейдится в m раз с шансом rtp / m.
// Победа: приз переходит в «Сейчас», справа новая цель, круг крутится сам дальше.
// Промах: всё сгорает. Забрать текущий приз можно в любой момент кнопкой «Забрать».
(() => {
  "use strict";
  const A = window.App, { $, all, STAR, fmt, fmtS, pct } = A;
  const MAX_WINS = 10, MAX_CHANCE = 0.95;
  let dial, spinning = false, running = false, wins = 0, bet = 0, m = 2, stop = false, skip = false;

  const chanceOf = (mult) => Math.min(MAX_CHANCE, A.rtp("streak") / mult);
  let P = chanceOf(m);
  const valueAt = (k) => Math.floor(bet * Math.pow(m, k));
  // множитель коротко: ×1,5 · ×2 · ×1 024 · ×3,2 млн
  const mx = (v) => "×" + (v >= 1000 ? fmtS(Math.round(v)) : String(+v.toFixed(2)).replace(".", ","));
  function running_(on) { $("#streakStake").hidden = on; $("#bankSlot").hidden = !on; }

  function ladder(base, cur) {
    const from = Math.max(1, cur);
    let html = "";
    for (let k = from; k < from + 5; k++) {
      const val = base * Math.pow(m, k), g = base ? A.bestGift(val) : null;
      html += `<div class="rung ${k === cur ? "cur" : ""} ${k < cur ? "past" : ""}">
        <b>${mx(Math.pow(m, k))}</b>${g ? A.chip(g, "sm") : `<span class="chip sm empty"></span>`}
        <span>${base ? fmtS(val) : "0"}</span></div>`;
    }
    $("#ladder").innerHTML = html;
  }
  function slot(body, sum, value, empty) {
    const g = value ? A.bestGift(value) : null;
    $(body).innerHTML = g ? `<span class="pile">${A.chip(g)}</span>` : value ? `<span class="pile">${A.starChip}</span>` : `<span class="slot-add idle">${empty}</span>`;
    $(sum).textContent = fmtS(value);
  }
  function markMults() { all("#streakMults button").forEach((b) => b.classList.toggle("on", +b.dataset.m === m)); }

  function render() {
    if (running) return;
    P = chanceOf(m);
    const v = A.stakeValue();
    wins = 0; bet = v;
    $("#streakCount").textContent = "0×";
    $("#streakPer").textContent = pct(P);
    ladder(v, 0);
    slot("#targetBody", "#targetSum", v ? Math.floor(v * m) : 0, mx(m));
    dial.setZone(P); dial.mark(null);
    dial.setGift(v ? A.bestGift(v * m) : null);
    dial.setText(pct(P), "шанс раунда");
    markMults();
    A.setCta({ html: v ? `Играть за ${STAR}${fmt(v)}` : "Выберите ставку", disabled: !v, fn: play });
  }

  // кнопки во время серии: «Забрать» текущий приз и «Пропустить» анимацию
  function ctaRunning() {
    const cur = wins ? valueAt(wins) : 0;
    A.setCta(
      stop ? { html: spinning ? "Заберём после этого раунда" : "Забираем…", disabled: true }
        : { html: wins ? `Забрать ${STAR}${fmt(cur)}` : "Идёт серия", disabled: !wins, fn: () => { stop = true; A.hap.soft(); ctaRunning(); } },
      skip ? null : { html: "» Пропустить", fn: () => { skip = true; A.hap.soft(); ctaRunning(); } });
  }

  async function play() {
    if (running || !A.stakeValue()) return;
    running = true; A.busy = true; stop = false; skip = false;
    P = chanceOf(m);
    const taken = A.takeStake(), st = A.state();
    bet = taken.value; wins = 0;
    let round = null, lost = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    running_(true);
    slot("#bankBody", "#bankSum", bet, "");
    ctaRunning();

    while (wins < MAX_WINS && !stop) {
      round = A.nextRound();
      const win = round.roll < P;
      dial.setGift(A.bestGift(valueAt(wins + 1)));
      dial.setText(null, `${mx(m)} · раунд ${wins + 1}`);
      const fast = skip || st.fast;
      spinning = true;
      await dial.spin(round.roll, P, fast ? { dur: 700, turns: 1 } : { dur: 2600, turns: 3 });
      spinning = false;
      if (!win) { lost = true; dial.mark("lose"); break; }
      wins++;
      dial.mark("win");
      $("#streakCount").textContent = `${wins}×`;
      ladder(bet, wins);
      slot("#bankBody", "#bankSum", valueAt(wins), "");
      slot("#targetBody", "#targetSum", valueAt(wins + 1), mx(m));
      $("#bankSlot").classList.remove("pop"); void $("#bankSlot").offsetWidth; $("#bankSlot").classList.add("pop");
      A.hap.coin(); A.playDuck($("#streakDuck"), false);
      dial.setText(null, `серия ${wins}×`);
      if (!stop) ctaRunning();
      await A.wait(A.REDUCED ? 100 : (skip || st.fast) ? 250 : 650);
    }

    st.stats.bestStreak = Math.max(st.stats.bestStreak, wins);
    const total = Math.pow(m, wins);
    if (!lost && wins > 0) {
      const r = A.payout(valueAt(wins));
      st.stats.wins++; st.stats.best = Math.max(st.stats.best, r.value);
      dial.mark("win"); dial.setText(null, `серия ${wins}×`);
      A.log({ mode: "streak", win: true, bet, id: r.gift ? r.gift.id : null, mult: total, ...round,
        text: `Серия ${mx(m)}: ${wins} ${wins === 1 ? "победа" : wins < 5 ? "победы" : "побед"} подряд, шанс каждого раунда ${pct(P)}. Показан последний раунд` });
      await A.wait(A.REDUCED ? 50 : 450);
      A.showPrize({ gift: r.gift, uid: r.uid, stars: r.stars, sub: `серия ${wins}× · ${mx(total)}` });
    } else {
      dial.setText(null, "мимо");
      A.log({ mode: "streak", win: false, bet, id: null, mult: 0, ...round,
        text: `Серия ${mx(m)} оборвалась после ${wins} ${wins === 1 ? "победы" : "побед"}, шанс раунда ${pct(P)}. Для победы нужно число меньше ${(P * 100).toFixed(3).replace(".", ",")}` });
      A.showMiss(wins ? `Серия оборвалась на ${wins + 1}-м раунде` : "Мимо с первого раза",
        wins ? `сгорело ${fmt(valueAt(wins))} ${STAR}` : `−${fmt(bet)} ${STAR}`);
    }
    A.save();
    running = false; A.busy = false;
    running_(false);
    A.setCta({ html: "Выберите ставку", disabled: true, fn: play });
    A.renderStake();
  }

  A.registerMode("streak", {
    init() {
      dial = new A.Dial($("#dialStreak"));
      $("#streakMults").addEventListener("click", (e) => {
        const b = e.target.closest("[data-m]"); if (!b || running) return;
        m = +b.dataset.m; A.hap.soft(); render();
      });
    },
    enter() { render(); },
    onStake() { if (!running) render(); },
    lockStake() { return running; },
    get P() { return P; },
    chanceNow: () => chanceOf(m),
    chanceOf,
  });
})();
