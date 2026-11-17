// Режим «Серия»: одна ставка, круг крутится сам до первого промаха.
// Каждая победа удваивает приз. Ноль побед: ставка сгорает.
(() => {
  "use strict";
  const A = window.App, { $, STAR, fmt, fmtS, pct, xf } = A;
  // Шанс раунда подбираем так, чтобы средний возврат с учётом потолка в MAX_WINS побед был ровно HOUSE
  const chanceOf = (H) => {
    const ev = (P) => { let e = 0; for (let k = 1; k < 10; k++) e += Math.pow(P, k) * (1 - P) * Math.pow(2, k); return e + Math.pow(P, 10) * 1024; };
    let lo = 0, hi = 0.5;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (ev(mid) < H) lo = mid; else hi = mid; }
    return lo;
  };
  let P = chanceOf(A.rtp("streak"));      // пересчитывается перед каждой серией, если админ поменял шансы
  const MAX_WINS = 10;
  let dial, running = false, wins = 0, bet = 0;

  function ladder(base, cur) {
    const from = Math.max(1, cur - 1);
    let html = "";
    for (let k = from; k < from + 5; k++) {
      const val = base * Math.pow(2, k), g = base ? A.bestGift(val) : null;
      html += `<div class="rung ${k === cur ? "cur" : ""} ${k < cur ? "past" : ""}">
        <b>×${Math.pow(2, k)}</b>${g ? A.chip(g, "sm") : `<span class="chip sm empty"></span>`}
        <span>${base ? fmtS(val) : "0"}</span></div>`;
    }
    $("#ladder").innerHTML = html;
  }
  function prizeSlot(value) {
    const g = value ? A.bestGift(value) : null;
    $("#bankBody").innerHTML = g ? `<span class="pile">${A.chip(g)}</span>` : value ? `<span class="pile">${A.starChip}</span>` : `<span class="slot-add idle">×2</span>`;
    $("#bankSum").textContent = fmtS(value);
  }

  function render() {
    if (running) return;
    P = chanceOf(A.rtp("streak"));
    const v = A.stakeValue();
    wins = 0;
    $("#streakCount").textContent = 0;
    ladder(v, 0); prizeSlot(0);
    dial.setZone(P); dial.mark(null);
    dial.setGift(v ? A.bestGift(v * 2) : null);
    dial.setText(pct(P), "шанс раунда");
    A.setCta({ html: v ? `Играть за ${STAR}${fmt(v)}` : "Выберите ставку", disabled: !v, fn: play });
  }

  async function play() {
    if (running || !A.stakeValue()) return;
    running = true; A.busy = true;
    const st = A.state(), body = A.stakeBody();
    // вся серия разыгрывается на сервере сразу, приз зачислен до анимации
    let srv;
    try { srv = await A.money("/api/w/play/streak", body); }
    catch (e) { running = false; A.busy = false; A.toast(A.moneyErr(e)); if (A.syncWallet) A.syncWallet(); return render(); }
    A.spendLocal(body);
    bet = srv.bet; wins = 0; P = srv.chance;
    let round = null;
    A.setCta({ html: "Идёт серия", disabled: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    const dur = st.fast === 2 ? 120 : st.fast ? 900 : 1900, turns = st.fast === 2 ? 0 : st.fast ? 1 : 2;

    // вся серия разыгрывается сразу, приз зачисляется до анимации: если закрыть приложение посреди серии, выигрыш не пропадёт
    const rounds = srv.rounds, total = srv.wins, last = rounds[rounds.length - 1];
    let entry;
    const res = srv.prize ? { ...srv.prize, gift: srv.prize.gift ? A.byId[srv.prize.gift] : null } : null;
    if (total > 0) {
      entry = { mode: "streak", win: true, bet, id: res.gift ? res.gift.id : null, mult: Math.pow(2, total), ...last,
        text: `Серия из ${total} побед, шанс раунда ${pct(P)}. Показан последний раунд` };
    } else {
      entry = { mode: "streak", win: false, bet, id: null, mult: 0, ...last,
        text: `Серия без побед, шанс раунда ${pct(P)}. Для победы нужно число меньше ${(P * 100).toFixed(3).replace(".", ",")}` };
    }
    A.log(entry, true);

    for (const r of rounds) {
      round = r;
      const win = round.roll < P;
      dial.setText(null, `раунд ${wins + 1}`);
      await dial.spin(round.roll, P, { dur, turns });
      if (!win) { dial.mark("lose"); break; }
      wins++;
      dial.mark("win");
      const prize = bet * Math.pow(2, wins);
      dial.setGift(A.bestGift(prize)); dial.setText(null, `серия ${wins}`);
      $("#streakCount").textContent = wins;
      ladder(bet, wins); prizeSlot(prize);
      A.hap.coin(); A.playDuck($("#streakDuck"), false);
      await A.wait(A.REDUCED || st.fast === 2 ? 80 : st.fast ? 350 : 700);
    }

    const mult = Math.pow(2, wins);
    A.applyServer(srv.state);
    A.logShow(entry);
    if (res) {
      dial.mark("win"); dial.setText(null, `серия ${wins}`);
      await A.wait(A.REDUCED ? 50 : 450);
      A.showPrize({ gift: res.gift, uid: res.uid, stars: res.stars, sub: `серия ${wins} · ${xf(mult)}` });
    } else {
      dial.setText(null, "мимо");
      A.showMiss("Мимо с первого раза", `−${fmt(bet)} ${STAR}`);
    }
    running = false; A.busy = false;
    A.setCta({ html: "Выберите ставку", disabled: true, fn: play });
    A.renderStake();
  }

  A.registerMode("streak", {
    init() { dial = new A.Dial($("#dialStreak")); },
    enter() { render(); },
    onStake() { if (!running && (A.stakeValue() || !wins)) render(); else if (!running) A.setCta({ html: "Выберите ставку", disabled: true, fn: play }); },
    lockStake() { return running; },
    get P() { return P; },
    chanceNow: () => chanceOf(A.rtp("streak")),
  });
})();
