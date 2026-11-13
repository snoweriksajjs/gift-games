// Режим «Контракт»: от 3 до 10 своих подарков обмениваются на один случайный.
(() => {
  "use strict";
  const A = window.App, { $, STAR, fmt, fmtS, xf } = A;
  const MIN = 3, MAX = 10, LO = 0.3, HI = 3;
  // множитель = LO + (HI - LO) * roll^K. K подобран так, чтобы среднее было равно HOUSE.
  const K = (HI - LO) / (A.HOUSE - LO) - 1;
  const multOf = (roll) => LO + (HI - LO) * Math.pow(roll, K);
  let signing = false;

  const items = () => A.state().inv.filter((it) => A.stake.uids.has(it.uid)).map((it) => A.byId[it.id]);

  function render() {
    const list = items(), sum = list.reduce((a, s) => a + s.price, 0);
    let cells = "";
    for (let i = 0; i < MAX; i++) {
      const a = (i / MAX) * Math.PI * 2 - Math.PI / 2;
      const pos = `left:${50 + Math.cos(a) * 39}%;top:${50 + Math.sin(a) * 39}%`;
      cells += list[i] ? `<span class="ct-cell" style="${pos}">${A.chip(list[i], "sm")}</span>`
        : `<span class="ct-cell" style="${pos}"><span class="chip sm empty">${i < MIN ? "+" : ""}</span></span>`;
    }
    $("#ctCells").innerHTML = cells;
    $("#ctSum").innerHTML = `${STAR} ${fmt(sum)}`;
    $("#ctRange").innerHTML = sum ? `${STAR} ${fmtS(sum * LO)} до ${STAR} ${fmtS(sum * HI)}` : "от ×0,3 до ×3";
    const n = list.length, ok = n >= MIN && n <= MAX;
    A.setCta({
      html: signing ? "Подписываем" : ok ? "Подписать контракт" : n < MIN ? `Добавьте ещё ${MIN - n}` : `Не больше ${MAX}`,
      disabled: !ok || signing, fn: act,
    });
  }

  async function act() {
    if (signing) return;
    const round = A.nextRound(), m = multOf(round.roll);
    signing = true; A.busy = true;
    const board = $("#ctBoard");
    render();
    board.classList.add("sign");               // подарки стягиваются в центр
    A.playDuck($("#ctDuck"), false);
    A.hap.stop();
    await A.wait(A.REDUCED ? 200 : 900);
    const st = A.takeStake(), bet = st.value;
    A.hap.boom(); A.hap.hit();
    await A.wait(A.REDUCED ? 100 : 600);
    board.classList.remove("sign");

    const r = A.payout(bet * m), stats = A.state().stats;
    stats.contracts++; if (m >= 1) { stats.wins++; stats.best = Math.max(stats.best, r.value); }
    signing = false; A.busy = false;
    A.log({ mode: "contract", win: m >= 1, bet, id: r.gift ? r.gift.id : null, mult: m, ...round,
      text: `Контракт на ${fmt(bet)} звёзд, множитель ${xf(m)}` });
    A.showPrize({ gift: r.gift, uid: r.uid, stars: r.stars, sub: xf(m) });
    render();
  }

  A.registerMode("contract", {
    giftsOnly: true, maxItems: MAX,
    init() { $("#ctBoard").addEventListener("click", () => { if (!signing) A.openSheet($("#stakeSheet")); }); },
    enter() { render(); },
    onStake() { if (!signing) render(); },
    multOf,
  });
})();
