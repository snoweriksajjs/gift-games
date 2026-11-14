// Режим «Яйцо»: покупаешь яйцо, разбиваешь его тремя тапами, внутри подарок.
// Одно маленькое яйцо в день бесплатно.
(() => {
  "use strict";
  const A = window.App, { $, all, STAR, fmt, fmtS, xf } = A;
  const TIERS = [
    // tint: базовый цвет, в который перекрашивается скорлупа
    { id: "common", name: "Обычное", price: 250, c1: "#fff6e3", c2: "#f0d9a8", tint: "#e8c98f" },
    { id: "rare", name: "Редкое", price: 1000, c1: "#e2f0ff", c2: "#7db8f7", tint: "#4f9cf0" },
    { id: "epic", name: "Эпическое", price: 5000, c1: "#f0e4ff", c2: "#ad7df2", tint: "#9a5cf0" },
    { id: "legend", name: "Легендарное", short: "Легенда", price: 25000, c1: "#fff4c7", c2: "#f6b733", tint: "#f2b21c", ld: 0.78 },
  ];
  const FREE = { id: "free", name: "Бесплатное", price: 0, c1: "#ffffff", c2: "#d6dbe6", tint: null };
  const LO = 0.3, HI = 3, TAPS = 3;
  // множитель содержимого: LO + (HI - LO) * roll^K, среднее равно HOUSE
  const K = (HI - LO) / (A.rtp("egg") - LO) - 1;
  const multOf = (roll) => LO + (HI - LO) * Math.pow(roll, K);
  const freeValue = (roll) => Math.round(30 + 270 * Math.pow(roll, 3));   // бесплатное яйцо: от 30 до 300 звёзд
  const today = () => new Date().toISOString().slice(0, 10);
  // Перекраска стикера в цвет уровня: меняются только серые и белые цвета скорлупы,
  // утёнок (жёлтый, оранжевый) и тёмные контуры глаз остаются как есть.
  const hsl = (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  };
  const rgb = (h, s, l) => {
    if (!s) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  };
  const hex2 = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  function recolor(data, tint, ld = 0.9) {
    if (!tint) return data;
    const [th, ts] = hsl(...hex2(tint));
    const fix = (c) => {
      if (!Array.isArray(c) || c.length < 3 || typeof c[0] !== "number") return;
      const [, s0, l0] = hsl(c[0], c[1], c[2]);
      if (s0 > 0.28 || l0 < 0.22) return;                    // насыщенное или очень тёмное не трогаем
      const l = 0.22 + (l0 - 0.22) * ld, s = ts * (0.55 + 0.45 * (1 - Math.abs(l - 0.6)));
      const [r, g, b] = rgb(th, Math.min(1, s), l);
      c[0] = r; c[1] = g; c[2] = b;
    };
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      if ((o.ty === "fl" || o.ty === "st") && o.c) {
        if (Array.isArray(o.c.k) && typeof o.c.k[0] === "number") fix(o.c.k);
        else if (Array.isArray(o.c.k)) o.c.k.forEach((kf) => { fix(kf.s); fix(kf.e); });
      }
      for (const k in o) walk(o[k]);
    })(data);
    return data;
  }
  const tinted = {};
  const eggData = (t) => (tinted[t.id] = tinted[t.id] || A.duckData("hatch").then((d) => recolor(JSON.parse(JSON.stringify(d)), t.tint, t.ld)));

  const FRAMES = [0, 15, 40, 100];              // кадры стикера: целое, трещина, большие трещины, утёнок
  let tier = TIERS[0], hatching = false, anim = null;

  const egg = () => A.state().egg || null;
  const tierOf = (id) => (id === "free" ? FREE : TIERS.find((t) => t.id === id) || TIERS[0]);
  const freeReady = () => A.state().freeEgg !== today() && !(A.live && A.live.free_egg === false);

  function paint(t, taps) {
    const e = $("#eggArt");
    e.style.setProperty("--e2", t.c2);
    e.dataset.taps = taps;
    mountEgg(t, taps);
  }
  // главное яйцо: стикер в цвете уровня
  let shownTier = null, mountToken = 0;
  function mountEgg(t, taps) {
    if (!window.lottie) return;
    if (shownTier === t.id && anim) { if (!hatching) anim.goToAndStop(FRAMES[Math.min(taps, 2)], true); return; }
    const token = ++mountToken;
    eggData(t).then((data) => {
      if (token !== mountToken) return;
      if (anim) { try { anim.destroy(); } catch {} }
      shownTier = t.id;
      anim = window.lottie.loadAnimation({ container: $("#eggAnim"), renderer: "svg", loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(data)) });
      anim.addEventListener("DOMLoaded", () => { $("#eggArt").classList.add("live"); anim.goToAndStop(FRAMES[Math.min(taps, 2)], true); });
    }).catch(() => {});
  }
  // превью на карточках уровней: первый кадр стикера в цвете уровня
  const minis = {};
  function mountMinis() {
    if (!window.lottie) return;
    all(".egg-tier [data-mini]").forEach((box) => {
      const t = tierOf(box.dataset.mini);
      if (minis[t.id] && minis[t.id].wrapper === box) return;
      eggData(t).then((data) => {
        if (!box.isConnected) return;
        box.innerHTML = "";
        const a = window.lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(data)) });
        a.addEventListener("DOMLoaded", () => a.goToAndStop(0, true));
        minis[t.id] = a;
      });
    });
  }

  // проигрывает отрезок стикера: яйцо трескается или вылупляется
  function playTo(from, to) { if (anim) { A.REDUCED ? anim.goToAndStop(to, true) : anim.playSegments([from, to], true); } }

  function render() {
    const st = A.state(), cur = egg(), t = cur ? tierOf(cur.tier) : tier;
    paint(t, cur ? cur.taps : 0);
    $("#eggBox").classList.toggle("armed", !!cur);
    $("#eggTiers").innerHTML = TIERS.map((x) => `<button class="egg-tier ${!cur && x.id === tier.id ? "on" : ""}" data-tier="${x.id}" ${cur ? "disabled" : ""}
      style="--t1:${x.c1};--t2:${x.c2}"><span class="mini" data-mini="${x.id}"></span><span>${x.short || x.name}</span><b>${STAR}${fmtS(x.price)}</b></button>`).join("");
    // что может выпасть: подарки на разных точках диапазона
    const seen = new Set(), drops = [];
    for (const k of [0.3, 0.7, 1, 1.8, 3]) {
      const g = A.bestGift(t.price * k);
      if (g && !seen.has(g.id)) { seen.add(g.id); drops.push(g); }
    }
    $("#eggDrops").innerHTML = t.price ? drops.map((g) => `<span class="drop">${A.chip(g, "sm")}<i>${fmtS(g.price)}</i></span>`).join("")
      : `<span class="hint">Звёзды от 30 до 300</span>`;
    mountMinis();
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
