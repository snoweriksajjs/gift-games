// Режим «Яйцо»: покупаешь яйцо, разбиваешь его тремя тапами, внутри подарок.
// Одно маленькое яйцо в день бесплатно.
(() => {
  "use strict";
  const A = window.App, { $, all, STAR, fmt, fmtS, xf } = A;
  const TIERS = [
    { id: "common", name: "Обычное", price: 250, c1: "#fff3d6", c2: "#e9c98a", spot: "#cfa55a" },
    { id: "rare", name: "Редкое", price: 1000, c1: "#d9ecff", c2: "#6fb1f5", spot: "#3d86d6" },
    { id: "epic", name: "Эпическое", price: 5000, c1: "#ecdcff", c2: "#a878f0", spot: "#7a45cf" },
    { id: "legend", name: "Легендарное", price: 25000, c1: "#fff2b8", c2: "#f5b52e", spot: "#d98a0c" },
  ];
  const FREE = { id: "free", name: "Бесплатное", price: 0, c1: "#ffffff", c2: "#d6dbe6", spot: "#aab2c2" };
  const LO = 0.3, HI = 3, TAPS = 3;
  // множитель содержимого: LO + (HI - LO) * roll^K, среднее равно HOUSE
  const K = (HI - LO) / (A.HOUSE - LO) - 1;
  const multOf = (roll) => LO + (HI - LO) * Math.pow(roll, K);
  const freeValue = (roll) => Math.round(30 + 270 * Math.pow(roll, 3));   // бесплатное яйцо: от 30 до 300 звёзд
  const today = () => new Date().toISOString().slice(0, 10);
  const FRAMES = [0, 15, 40, 100];              // кадры стикера: целое, трещина, большие трещины, утёнок
  let tier = TIERS[0], hatching = false, anim = null;

  const egg = () => A.state().egg || null;
  const tierOf = (id) => (id === "free" ? FREE : TIERS.find((t) => t.id === id) || TIERS[0]);
  const freeReady = () => A.state().freeEgg !== today();

  function paint(t, taps) {
    const e = $("#eggArt");
    e.style.setProperty("--e2", t.c2);
    e.dataset.taps = taps;
    if (anim && !hatching) anim.goToAndStop(FRAMES[Math.min(taps, 2)], true);
  }
  // проигрывает отрезок стикера: яйцо трескается или вылупляется
  function playTo(from, to) { if (anim) { A.REDUCED ? anim.goToAndStop(to, true) : anim.playSegments([from, to], true); } }

  function render() {
    const st = A.state(), cur = egg(), t = cur ? tierOf(cur.tier) : tier;
    paint(t, cur ? cur.taps : 0);
    $("#eggBox").classList.toggle("armed", !!cur);
    $("#eggTiers").innerHTML = TIERS.map((x) => `<button class="egg-tier ${!cur && x.id === tier.id ? "on" : ""}" data-tier="${x.id}" ${cur ? "disabled" : ""}>
      <i style="background:linear-gradient(${x.c1},${x.c2})"></i><span>${x.name}</span><b>${STAR}${fmtS(x.price)}</b></button>`).join("");
    $("#eggName").textContent = t.name + " яйцо";
    $("#eggHint").innerHTML = cur
      ? (cur.taps ? `Ещё ${TAPS - cur.taps}` : "Тапните по яйцу")
      : `Внутри от ${STAR} ${fmtS(t.price * LO)} до ${STAR} ${fmtS(t.price * HI)}`;
    const fb = $("#eggFree");
    fb.disabled = !!cur || !freeReady();
    fb.textContent = freeReady() ? "Забрать" : "Завтра";
    if (cur) return A.setCta({ html: "Разбейте яйцо", disabled: true });
    const can = st.balance >= tier.price;
    A.setCta({ html: can ? `Купить за ${STAR}${fmt(tier.price)}` : "Пополнить баланс", fn: can ? buy : () => $("[data-deposit]").click() });
  }

  function buy() {
    const st = A.state();
    if (egg() || st.balance < tier.price) return;
    st.balance -= tier.price; st.stats.wagered += tier.price; st.stats.spins++;
    st.egg = { tier: tier.id, taps: 0, round: A.nextRound() };
    A.save(); A.renderBalance(); A.hap.hit();
    render(); pop();
  }
  function takeFree() {
    const st = A.state();
    if (egg() || !freeReady()) return;
    st.freeEgg = today();
    st.egg = { tier: "free", taps: 0, round: A.nextRound() };
    A.save(); A.hap.hit();
    render(); pop();
  }
  function pop() { const e = $("#eggArt"); e.classList.remove("pop"); void e.offsetWidth; e.classList.add("pop"); }

  async function tap() {
    const st = A.state(), cur = egg();
    if (!cur || hatching) return;
    cur.taps++; A.save();
    const e = $("#eggArt");
    e.classList.remove("wob"); void e.offsetWidth; e.classList.add("wob");
    e.dataset.taps = cur.taps;
    if (cur.taps < TAPS) playTo(FRAMES[cur.taps - 1], FRAMES[cur.taps]);
    A.hap.crack(cur.taps);
    $("#eggHint").textContent = cur.taps < TAPS ? `Ещё ${TAPS - cur.taps}` : "";
    if (cur.taps < TAPS) return;

    // вылупление
    hatching = true; A.busy = true;
    const t = tierOf(cur.tier), free = cur.tier === "free", round = cur.round;
    const box = $("#eggBox");
    box.classList.add("hatch");
    playTo(FRAMES[2], FRAMES[3]);                // скорлупа лопается, появляется утёнок
    await A.wait(A.REDUCED ? 100 : 1150);
    const value = free ? freeValue(round.roll) : t.price * multOf(round.roll);
    const r = A.payout(value), m = free ? 1 : value / t.price;
    st.stats.eggs = (st.stats.eggs || 0) + 1;
    if (free || m >= 1) { st.stats.wins++; st.stats.best = Math.max(st.stats.best, r.value); }
    st.egg = null; A.save();
    A.log({ mode: "egg", win: free || m >= 1, bet: t.price, id: r.gift ? r.gift.id : null, mult: m, ...round,
      text: free ? `Бесплатное яйцо, внутри ${fmt(r.value)} звёзд` : `${t.name} яйцо за ${fmt(t.price)} звёзд, множитель ${xf(m)}` });
    hatching = false; A.busy = false;
    A.showPrize({ gift: r.gift, uid: r.uid, stars: r.stars, sub: free ? "бесплатное яйцо" : xf(m) });
    box.classList.remove("hatch");
    render();
  }

  A.registerMode("egg", {
    init() {
      if (window.lottie) A.duckData("hatch").then((data) => {
        anim = window.lottie.loadAnimation({ container: $("#eggAnim"), renderer: "svg", loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(data)) });
        anim.addEventListener("DOMLoaded", () => { $("#eggArt").classList.add("live"); const c = egg(); anim.goToAndStop(FRAMES[c ? Math.min(c.taps, 2) : 0], true); });
      }).catch(() => {});
      $("#eggArt").addEventListener("click", tap);
      $("#eggTiers").addEventListener("click", (e) => {
        const b = e.target.closest("[data-tier]"); if (!b || egg()) return;
        tier = tierOf(b.dataset.tier); A.hap.soft(); render(); pop();
      });
      $("#eggFree").addEventListener("click", takeFree);
    },
    enter() { render(); },
    onStake() { if (A.modeName === "egg" && !hatching) render(); },
    multOf, freeValue,
  });
})();
