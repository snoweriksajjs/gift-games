// Режим «Апгрейд»: ставка против одной цели, шанс равен доле ставки в цене цели.
(() => {
  "use strict";
  const A = window.App, { $, all, STAR, fmt, fmtS, pct, xf } = A;
  const MAX_CHANCE = 0.8, MIN_CHANCE = 0.01;
  const targetSheet = $("#targetSheet"), shopGrid = $("#shopGrid"), shopSearch = $("#shopSearch"), shopSort = $("#shopSort"), priceSeg = $("#priceSeg");
  let dial, target = null, gotId = null, activeMult = null, priceRange = "all", spinning = false;

  const chanceFor = (v, price) => Math.min(MAX_CHANCE, (v / price) * A.rtp("classic"));
  const chance = () => {
    const v = A.stakeValue();
    if (!target || v <= 0) return 0;
    return chanceFor(v, A.byId[target].price);
  };

  function renderShop() {
    if (A.sheet !== targetSheet) return;         // каталог рисуется, только когда открыт
    const q = shopSearch.value.trim().toLowerCase(), dir = shopSort.value === "asc" ? 1 : -1, v = A.stakeValue();
    const [lo, hi] = priceRange === "all" ? [0, Infinity] : priceRange.split("-").map((x) => (x === "" ? Infinity : Number(x)));
    const list = A.CATALOG
      .filter((s) => s.price >= lo && s.price < hi && (!q || (s.gift + " " + s.model).toLowerCase().includes(q)))
      .sort((a, b) => (a.price - b.price) * dir);
    shopGrid.innerHTML = list.length
      ? list.map((s) => A.tile(s, [target === s.id ? "sel" : "", v > 0 && s.price <= v ? "off" : ""].join(" "), `data-id="${s.id}"`)).join("")
      : `<div class="empty">Ничего не нашлось</div>`;
  }

  function render(keepResult) {
    const ch = chance(), v = A.stakeValue(), t = target && A.byId[target];
    const out = target || gotId;
    $("#outBody").innerHTML = out ? `<span class="pile">${A.chip(A.byId[out])}</span>` : `<span class="slot-add">+</span>`;
    $("#outSlot").classList.toggle("got", !target && !!gotId);
    $("#outLabel").textContent = !target && gotId ? "Получен" : "Цель";
    $("#outSum").textContent = fmtS(out ? A.byId[out].price : 0);
    all("#mults button").forEach((b) => b.classList.toggle("on", b.dataset.m === activeMult));
    $("#multVal").textContent = t && v ? xf(t.price / v) : "×0";
    $("#winVal").innerHTML = t && v && t.price > v ? `+${fmtS(t.price - v)} ${STAR}` : `0 ${STAR}`;
    if (!keepResult) {
      dial.setZone(ch); dial.setChance(ch); dial.setGift(t || null); dial.mark(null);
      dial.setText(null, t ? "шанс" : "Выберите цель");
    }
    const ok = t && v > 0 && t.price > v && ch >= MIN_CHANCE;
    A.setCta({
      html: spinning ? "Крутится" : ok ? `Апгрейд за ${STAR}${fmt(v)}` : !v ? "Выберите ставку" : !t ? "Выберите цель" : t.price <= v ? "Цель дешевле ставки" : "Шанс меньше 1%",
      disabled: !ok || spinning, fn: act,
    });
  }

  async function act() {
    if (spinning) return;
    const ch = chance(), tgt = A.byId[target];
    const round = A.nextRound(), win = round.roll < ch;
    spinning = true; A.busy = true;
    $("#mode-classic .stake-slot").classList.add("loading");
    const st = A.takeStake(), bet = st.value;
    dial.setText(null, "крутится");
    render(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    await dial.spin(round.roll, ch);

    dial.mark(win ? "win" : "lose");
    dial.setText(null, win ? "ваш" : "мимо");
    const stats = A.state().stats;
    spinning = false; A.busy = false;
    $("#mode-classic .stake-slot").classList.remove("loading");
    A.log({ mode: "classic", win, bet, id: tgt.id, mult: tgt.price / bet, ...round,
      text: `Апгрейд, шанс ${pct(ch)}. Для выигрыша нужно число меньше ${(ch * 100).toFixed(3).replace(".", ",")}` });
    if (win) {
      stats.wins++; stats.best = Math.max(stats.best, tgt.price); if (ch < 0.25) stats.lowWins++;
      stats.won = (stats.won || 0) + tgt.price;
      const uid = A.grant(tgt);
      target = null; gotId = tgt.id; activeMult = null;
      A.showPrize({ gift: tgt, uid, sub: xf(tgt.price / bet) });
    } else {
      A.save();
      A.showMiss("Не выпало", `−${fmt(bet)} ${STAR}`);
    }
    A.renderStake(); render(true);
  }

  A.registerMode("classic", {
    chanceFor, MAX_CHANCE,           // для проверки шансов
    init() {
      dial = new A.Dial($("#dialClassic"));
      $("#outSlot").addEventListener("click", () => A.openSheet(targetSheet));
      targetSheet.addEventListener("sheet:open", () => { targetSheet.hidden = false; setTimeout(renderShop, 0); });
      shopGrid.addEventListener("click", (e) => {
        const c = e.target.closest("[data-id]"); if (spinning || !c || A.pressed) return;
        target = c.dataset.id; gotId = null; activeMult = null;
        A.hap.select(); A.closeSheet(); render();
      });
      shopSearch.addEventListener("input", renderShop);
      shopSort.addEventListener("change", renderShop);
      priceSeg.addEventListener("click", (e) => {
        const b = e.target.closest("[data-r]"); if (!b) return;
        priceRange = b.dataset.r;
        all("button", priceSeg).forEach((x) => x.classList.toggle("on", x === b));
        renderShop();
      });
      $("#mults").addEventListener("click", (e) => {
        const b = e.target.closest("[data-m]"); if (!b || spinning) return;
        const v = A.stakeValue(); if (!v) return A.toast("Сначала выберите ставку");
        const want = v * Number(b.dataset.m);
        let best = null;
        for (const s of A.CATALOG) if (s.price > v && (!best || Math.abs(s.price - want) < Math.abs(best.price - want))) best = s;
        if (!best) return A.toast("Нет подарка дороже ставки");
        target = best.id; gotId = null; activeMult = b.dataset.m;
        A.hap.select(); render();
      });
      // «Быстро» общий переключатель для круга во всех режимах
      const sync = () => {
        all("[data-fast]").forEach((i) => (i.checked = !!A.state().fast));
        all("[data-fast-label]").forEach((l) => (l.textContent = A.state().fast ? "Вкл" : "Выкл"));
      };
      all("[data-fast]").forEach((i) => i.addEventListener("change", () => {
        A.state().fast = i.checked; A.save(); sync(); A.hap.select();
        A.playDuck($(".duck", i.closest(".stat")), false);
      }));
      sync();
    },
    enter() { render(); },
    onStake() {
      if (spinning) return;
      if (target && A.byId[target].price <= A.stakeValue()) target = null;
      if (A.stakeValue() > 0) gotId = null;
      activeMult = null;
      render(); renderShop();
    },
  });
})();
