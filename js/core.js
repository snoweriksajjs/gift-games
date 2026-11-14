// Ядро приложения: состояние, честная игра, звук, утки, ставка, общие окна, вкладки.
// Режимы игры лежат в js/modes и подключаются через App.registerMode.
(() => {
  "use strict";

  const BOT_USERNAME = "DuckChanceApp";   // имя бота без @, нужно для реферальной ссылки
  const REF_BONUS = 100;               // звёзд за друга, который сделал первую игру
  const SITE = "https://snoweriksajjs.github.io/gift-games";   // публичный адрес, нужен для карточек в сторис
  const ADMIN_ID = 8083284748;         // кому показывается админ-панель
  const CODE_KEY = "duckchance-codes-v1";   // ключ подписи промокодов. Он виден в коде сайта: с сервером подпись переедет туда
  // Настройки из админки. Сервер присылает их при каждом запуске, а применяются они со следующего запуска:
  // шансы режимов считаются один раз при загрузке.
  const CFG = (() => { try { return JSON.parse(localStorage.getItem("dc_cfg")) || {}; } catch { return {}; } })();
  const clampRtp = (v) => (typeof v === "number" && v >= 0.5 && v <= 0.99 ? v : 0.95);
  const HOUSE = clampRtp(CFG.rtp);     // доля, которая в среднем возвращается игрокам
  // свежие настройки с сервера (App.live) важнее сохранённых с прошлого запуска
  const rtp = (mode) => { const L = App.live || CFG; return clampRtp((L.modes || {})[mode] || L.rtp || HOUSE); };

  const CATALOG = window.GIFTS || [];
  const byId = Object.fromEntries(CATALOG.map((s) => [s.id, s]));
  const byPrice = [...CATALOG].sort((a, b) => a.price - b.price);

  // ---------- Telegram ----------
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTg = !!(tg && tg.initData);
  if (inTg) {
    try {
      tg.ready(); tg.expand(); tg.setHeaderColor("secondary_bg_color");
      tg.disableVerticalSwipes && tg.disableVerticalSwipes();
      if (tg.requestFullscreen && /ios|android/.test(tg.platform)) tg.requestFullscreen();
    } catch {}
  }
  const user = (inTg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;

  // ---------- SHA-256 / HMAC (без зависимостей, работает и с file://) ----------
  const sha256 = (() => {
    const K = [], H0 = [];
    const isPrime = (x) => { for (let d = 2; d * d <= x; d++) if (x % d === 0) return false; return true; };
    const frac = (x) => ((x - Math.floor(x)) * 4294967296) >>> 0;
    for (let n = 2, c = 0; c < 64; n++) {
      if (!isPrime(n)) continue;
      if (c < 8) H0[c] = frac(Math.sqrt(n));
      K[c++] = frac(Math.cbrt(n));
    }
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    return (msg) => {
      const len = msg.length;
      const buf = new Uint8Array(((len + 9 + 63) >> 6) << 6);
      buf.set(msg); buf[len] = 0x80;
      const dv = new DataView(buf.buffer);
      dv.setUint32(buf.length - 4, (len * 8) >>> 0);
      dv.setUint32(buf.length - 8, Math.floor((len * 8) / 4294967296));
      const H = H0.slice(), W = new Uint32Array(64);
      for (let o = 0; o < buf.length; o += 64) {
        for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
          const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
          W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
          const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
          const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
          h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        [a, b, c, d, e, f, g, h].forEach((v, i) => (H[i] = (H[i] + v) >>> 0));
      }
      const out = new Uint8Array(32);
      H.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
      return out;
    };
  })();
  const enc = (s) => new TextEncoder().encode(s);
  const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  function hmac(key, msg) {
    let k = enc(key);
    if (k.length > 64) k = sha256(k);
    const ip = new Uint8Array(64 + msg.length), op = new Uint8Array(96);
    for (let i = 0; i < 64; i++) { ip[i] = (k[i] || 0) ^ 0x36; op[i] = (k[i] || 0) ^ 0x5c; }
    ip.set(msg, 64);
    op.set(sha256(ip), 64);
    return sha256(op);
  }
  const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

  // Честная игра. В рабочем сервисе серверный сид хранится и считается на сервере,
  // здесь та же схема, только выполняется в браузере.
  const Fair = {
    newSeed() { const s = randHex(32); return { serverSeed: s, hash: hex(sha256(enc(s))) }; },
    roll(serverSeed, clientSeed, nonce) {
      const h = hex(hmac(serverSeed, enc(`${clientSeed}:${nonce}`)));
      return parseInt(h.slice(0, 8), 16) / 4294967296; // 0 ≤ roll < 1
    },
  };

  // ---------- состояние ----------
  const STORE_KEY = "giftup_v2";
  const freshState = () => ({ balance: 0, inv: [], history: [], uidSeq: 1, haptics: true, fast: false,
    fair: { ...Fair.newSeed(), clientSeed: randHex(8), nonce: 0 } });
  let state = (() => {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch {}
    return freshState();
  })();
  state.stats = Object.assign({ spins: 0, wins: 0, best: 0, wagered: 0, lowWins: 0, bestStreak: 0, bestCrash: 0, arenaWins: 0, contracts: 0 }, state.stats);
  state.claimed = state.claimed || {};
  state.inv = state.inv.filter((it) => byId[it.id]);
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} };

  // ---------- мелочи ----------
  const $ = (s, root = document) => root.querySelector(s);
  const all = (s, root = document) => root.querySelectorAll(s);
  const STAR = `<svg class="star"><use href="#star"/></svg>`;
  const fmt = (n) => Math.round(n).toLocaleString("ru-RU");
  const fmtS = (n) => n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, "").replace(".", ",") + "M" : n >= 1e5 ? Math.round(n / 1000) + "K" : fmt(n);
  const pct = (c) => (c * 100).toFixed(c > 0 && c < 0.1 ? 2 : 1).replace(".", ",") + "%";
  const xf = (m) => "×" + m.toFixed(2).replace(".", ",");
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el.getClientRects().length > 0;

  function tween(from, to, ms, draw) {
    if (REDUCED || from === to) return draw(to);
    const t0 = performance.now();
    (function f(now) {
      const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
      draw(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(f);
    })(t0);
  }

  // ---------- звук ----------
  // Тихие интерфейсные звуки из набора Google Material Design (лицензия CC BY 4.0).
  const SOUNDS = ["tick", "tap", "open", "close", "toggle", "win", "step", "lose", "coin", "bounce", "boom", "crack"];
  const bufs = {};
  let actx = null;
  function audio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      SOUNDS.forEach((n) => fetch(`sounds/${n}.wav`).then((r) => r.arrayBuffer())
        .then((b) => new Promise((ok, no) => actx.decodeAudioData(b, ok, no))).then((buf) => (bufs[n] = buf)).catch(() => {}));
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  function snd(name, vol = 0.4, rate = 1) {
    if (state.sound === false) return;
    const ctx = audio(), b = bufs[name];
    if (!ctx || !b) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.playbackRate.value = rate; g.gain.value = vol;
    src.connect(g).connect(ctx.destination); src.start();
  }
  document.addEventListener("pointerdown", audio, { once: true });

  // ---------- отклик: вибрация и звук вместе ----------
  // Вибрация идёт через Telegram, вне Telegram на Android через navigator.vibrate.
  const canBuzz = () => !!navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive);
  const hap = {
    _t: 0,
    get on() { return state.haptics !== false; },
    _i(style) {
      if (!this.on) return;
      if (inTg) { try { tg.HapticFeedback.impactOccurred(style); } catch {} }
      else if (canBuzz()) navigator.vibrate(style === "heavy" ? 30 : style === "light" || style === "soft" ? 8 : 18);
    },
    _n(type) {
      if (!this.on) return;
      if (inTg) { try { tg.HapticFeedback.notificationOccurred(type); } catch {} }
      else if (canBuzz()) navigator.vibrate(type === "success" ? [12, 60, 12] : [40, 40, 40]);
    },
    tick(gap = 90, rate = 1) { const n = performance.now(); if (n - this._t > gap) { this._t = n; this._i("light"); snd("crack", 0.16, rate); } },
    soft() { snd("tap", 0.3); if (!this.on) return; if (inTg) { try { tg.HapticFeedback.selectionChanged(); } catch {} } else if (canBuzz()) navigator.vibrate(5); },
    select() { this.soft(); },
    hit() { this._i("medium"); snd("tap", 0.45); },
    stop() { this._i("rigid"); snd("bounce", 0.35, 0.8); },
    bounce() { this._i("medium"); snd("bounce", 0.5); },
    crack(n = 1) { this._i(n >= 3 ? "heavy" : "medium"); snd("crack", 0.7, 1.15 - n * 0.12); },
    rise(m) { this.tick(Math.max(55, 260 - m * 26), 1 + Math.min(m, 12) * 0.05); },   // чем выше множитель, тем чаще и выше
    coin() { this._i("light"); setTimeout(() => this._i("medium"), 70); snd("coin", 0.4); },
    step() { this._i("light"); setTimeout(() => this._i("medium"), 70); snd("step", 0.4); },
    win() { this._n("success"); setTimeout(() => this._i("light"), 180); setTimeout(() => this._i("light"), 300); snd("win", 0.5); },
    lose() { this._n("error"); snd("lose", 0.5); },
    boom() { this._i("heavy"); setTimeout(() => this._i("heavy"), 90); snd("boom", 0.4); },
    result(ok) { ok ? this.win() : this.lose(); },
  };

  // ---------- утки: анимированные стикеры (TGS это Lottie в gzip) ----------
  const duckCache = {};
  function duckData(name) {
    if (!duckCache[name]) {
      duckCache[name] = (async () => {
        if (!("DecompressionStream" in window)) throw new Error("no gzip");
        const r = await fetch(`ducks/${name}.tgs`);
        if (!r.ok) throw new Error("no file");
        return JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text());
      })();
    }
    return duckCache[name];
  }
  function dropDuck(el) { if (el._anim) { try { el._anim.destroy(); } catch {} el._anim = null; } el.classList.remove("live"); }
  function setDuck(el, name) {
    if (el.dataset.duck !== name) { dropDuck(el); el.dataset.duck = name; }
    el.style.backgroundImage = `url("ducks/${name}.webp")`;
  }
  // loop=true: крутится, пока видна. loop=false: один проход и возврат к первому кадру.
  function playDuck(el, loop) {
    if (REDUCED || !window.lottie) return;
    const name = el.dataset.duck;
    if (el._anim) { loop ? el._anim.play() : el._anim.goToAndPlay(0, true); return; }
    if (el._loading === name) return;
    el._loading = name;
    duckData(name).then((data) => {
      el._loading = null;
      if (el.dataset.duck !== name || el._anim) return;
      el._anim = window.lottie.loadAnimation({ container: el, renderer: "svg", loop: !!loop, autoplay: true, animationData: JSON.parse(JSON.stringify(data)) });
      el.classList.add("live");
      if (!loop) el._anim.addEventListener("complete", () => el._anim && el._anim.goToAndStop(0, true));
      if (loop && !visible(el)) el._anim.pause();
    }).catch(() => { el._loading = null; });
  }
  function syncDucks() {
    all(".duck[data-loop]").forEach((el) => {
      if (visible(el)) playDuck(el, true); else if (el._anim) el._anim.pause();
    });
  }
  function initDucks(root = document) {
    all(".duck[data-duck]", root).forEach((el) => setDuck(el, el.dataset.duck));
  }

  // ---------- разметка подарков ----------
  const bg = (s) => `--c1:${s.c1};--c2:${s.c2};--ct:${s.ct};--cp:${s.cp};--sym:url('${s.sym}')`;
  const pic = (s, eager) => `<img src="${s.img}" alt="" ${eager ? "" : 'loading="lazy"'} decoding="async" draggable="false">`;
  function tile(s, cls = "", attrs = "") {
    return `<div class="gift ${cls}" style="${bg(s)}" ${attrs} tabindex="0" role="button" aria-label="${s.gift}, ${s.model}, ${fmt(s.price)} звёзд">
      <i class="pat"></i><span class="rib">#${s.num}</span>${pic(s)}
      <span class="nm">${s.gift}</span><span class="md">${s.model}</span>
      <span class="pr">${STAR}${fmtS(s.price)}</span></div>`;
  }
  const chip = (s, cls = "") => `<span class="chip ${cls}" style="${bg(s)}"><i class="pat"></i>${pic(s, true)}</span>`;
  const starChip = `<span class="chip stars">${STAR}</span>`;

  // самый дорогой подарок, на который хватает суммы
  function bestGift(value) {
    let best = null;
    for (const s of byPrice) { if (s.price <= value) best = s; else break; }
    return best;
  }
  // выдача выигрыша: подарок по сумме и остаток звёздами
  function payout(value) {
    value = Math.floor(value);
    const gift = bestGift(value), stars = value - (gift ? gift.price : 0);
    let uid = null;
    if (gift) { uid = state.uidSeq++; state.inv.push({ uid, id: gift.id }); }
    state.balance += stars; save();
    return { gift, uid, stars, value };
  }
  function grant(gift) { const uid = state.uidSeq++; state.inv.push({ uid, id: gift.id }); save(); return uid; }
  // подарок в стейкинге нельзя продать, поставить или передать
  const locked = (uid) => { const it = state.inv.find((x) => x.uid === uid); return !!(it && it.stake); };
  const invTile = (it, cls = "") => tile(byId[it.id], cls + (it.stake ? " locked" : ""), `data-uid="${it.uid}"`);
  function sellUids(uids) {
    uids = uids.filter((u) => !locked(u));
    let sum = 0;
    state.inv = state.inv.filter((it) => { if (!uids.includes(it.uid)) return true; sum += byId[it.id].price; return false; });
    uids.forEach((u) => stake.uids.delete(u));
    state.balance += sum; save();
    return sum;
  }

  // ---------- честная игра ----------
  function nextRound() {
    const f = state.fair;
    const round = { serverSeed: f.serverSeed, hash: f.hash, clientSeed: f.clientSeed, nonce: f.nonce, roll: Fair.roll(f.serverSeed, f.clientSeed, f.nonce) };
    state.fair = { ...Fair.newSeed(), clientSeed: f.clientSeed, nonce: f.nonce + 1 };
    save();
    return round;
  }

  // ---------- круг с бегунком ----------
  const CX = 200, R = 172;
  const polar = (deg, r) => { const a = (deg * Math.PI) / 180; return [CX + Math.sin(a) * r, CX - Math.cos(a) * r]; };
  const angDist = (a, b) => { const d = (((a - b) % 360) + 360) % 360; return Math.min(d, 360 - d); };
  class Dial {
    constructor(root) {
      this.root = root; this.angle = 0; this.shown = 0; this.token = 0; this.anim = null; this.giftId = null;
      root.classList.add("dial");
      root.innerHTML = `
        <svg class="ring" viewBox="0 0 400 400" aria-hidden="true"><circle cx="200" cy="200" r="172" class="track"/><path class="zone" d=""/></svg>
        <button class="face" aria-label="Проиграть анимацию подарка"><i class="pat spin"></i><span class="face-art" aria-hidden="true"></span>
          <span class="face-read"><span class="chance" aria-live="polite"></span><span class="chance-label"></span></span></button>
        <div class="orbit" aria-hidden="true"><div class="tail"></div><div class="thumb"><i></i></div></div>`;
      this.zone = $(".zone", root); this.face = $(".face", root); this.art = $(".face-art", root);
      this.chanceEl = $(".chance", root); this.labelEl = $(".chance-label", root); this.orbit = $(".orbit", root);
      this.face.addEventListener("click", () => { if (this.anim && !App.busy) this.anim.goToAndPlay(0, true); });
      this.setPointer(0);
    }
    // зелёная зона растёт симметрично от середины низа (180°)
    setZone(ch) {
      const half = ch * 180;
      let d = "";
      if (ch > 0) {
        const [sx, sy] = polar(180 - half, R), [ex, ey] = polar(180 + half, R);
        d = `M${sx.toFixed(2)} ${sy.toFixed(2)} A${R} ${R} 0 ${2 * half > 180 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
      }
      this.zone.setAttribute("d", d);
    }
    setPointer(deg) { this.orbit.style.transform = `rotate(${deg.toFixed(3)}deg)`; }
    setChance(ch) { tween(this.shown, ch, 280, (x) => (this.chanceEl.textContent = pct(x))); this.shown = ch; }
    setText(big, label) { if (big !== null) this.chanceEl.textContent = big; this.labelEl.textContent = label; }
    mark(cls) { this.root.classList.remove("win", "lose", "spinning"); if (cls) this.root.classList.add(cls); }
    setGift(s) {
      const id = s ? s.id : null;
      if (id === this.giftId) return;
      this.giftId = id;
      const token = ++this.token;
      if (this.anim) { try { this.anim.destroy(); } catch {} this.anim = null; }
      this.face.classList.toggle("has", !!s);
      this.face.style.cssText = s ? bg(s) : "";
      this.art.classList.remove("playing");
      this.art.innerHTML = s ? `<span class="anim"></span>${pic(s, true)}` : "";
      if (!s || REDUCED || !window.lottie) return;
      fetch(s.anim).then((r) => (r.ok ? r.json() : Promise.reject())).then((data) => {
        if (token !== this.token) return;
        this.anim = window.lottie.loadAnimation({ container: $(".anim", this.art), renderer: "svg", loop: false, autoplay: true, animationData: data });
        this.anim.addEventListener("DOMLoaded", () => token === this.token && this.art.classList.add("playing"));
      }).catch(() => {});
    }
    // угол остановки однозначно следует из числа roll
    static landing(roll, ch) {
      const half = ch * 180;
      if (roll < ch) return 180 - half + (roll / ch) * 2 * half;
      return (180 + half + ((roll - ch) / (1 - ch)) * (360 - 2 * half)) % 360;
    }
    // плавное торможение и короткое затухающее покачивание в конце
    spin(roll, ch, opts = {}) {
      const landDeg = Dial.landing(roll, ch), half = ch * 180;
      const margin = Math.abs(angDist(landDeg, 180) - half);
      const fast = state.fast;
      const dur = REDUCED ? 300 : opts.dur || (fast ? 1800 : 5600), turns = REDUCED ? 0 : opts.turns || (fast ? 3 : 7);
      const wobble = REDUCED ? 0 : Math.min(2, margin * 0.6);
      this.mark("spinning");
      return new Promise((resolve) => {
        const from = this.angle, cur = ((from % 360) + 360) % 360;
        const to = from + turns * 360 + ((landDeg - cur + 360) % 360);
        const SETTLE = wobble ? 520 : 0, STEP = 12;
        let prev = Math.floor(from / STEP);
        const start = performance.now();
        const frame = (now) => {
          const t = now - start;
          if (t <= dur) this.angle = from + (to - from) * (1 - Math.pow(1 - t / dur, 4));
          else { const u = Math.min(1, (t - dur) / SETTLE); this.angle = to + wobble * Math.exp(-5 * u) * Math.sin(u * Math.PI * 3); }
          this.setPointer(this.angle);
          const st = Math.floor(this.angle / STEP);
          if (st !== prev && t <= dur) { prev = st; hap.tick(); }
          if (t < dur + SETTLE) requestAnimationFrame(frame);
          else { this.angle = ((to % 360) + 360) % 360; this.setPointer(this.angle); hap.stop(); resolve(); }
        };
        requestAnimationFrame(frame);
      });
    }
  }

  // ---------- конфетти ----------
  function confetti(colors, count = 110, origin) {
    if (REDUCED) return;
    const c = $("#fx"), ctx = c.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    const W = innerWidth, H = innerHeight;
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const px = origin ? origin[0] : W / 2, py = origin ? origin[1] : H * 0.4;
    const ps = Array.from({ length: count }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5, sp = 4 + Math.random() * 10;
      return { x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4,
        c: colors[(Math.random() * colors.length) | 0], life: 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5 };
    });
    let last = performance.now();
    (function frame(now) {
      const dt = Math.min(2, (now - last) / 16.7); last = now;
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of ps) {
        if (p.life <= 0 || p.y > H + 20) continue;
        alive = true;
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.3 * dt; p.vx *= 0.985; p.life -= 0.009 * dt; p.rot += p.vr * dt;
        ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 2.5); ctx.fillStyle = p.c;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (alive) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(last);
  }
  const PARTY = ["#34c759", "#ffd84d", "#2f8ef5", "#ff5fa2", "#ffffff"];

  // ---------- уведомление ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // ---------- шторки ----------
  const scrim = $("#scrim");
  let sheetEl = null;
  function openSheet(sheet) {
    if (App.busy) return;
    closeSheet(true);
    sheetEl = sheet;
    scrim.hidden = false; sheet.hidden = false;
    sheet.dispatchEvent(new Event("sheet:open"));
    void sheet.offsetWidth;
    scrim.classList.add("on"); sheet.classList.add("on");
    document.body.style.overflow = "hidden";
    snd("open", 0.3); syncDucks();
    if (inTg) try { tg.BackButton.show(); } catch {}
  }
  function closeSheet(instant) {
    const sheet = sheetEl; if (!sheet) return;
    sheetEl = null;
    sheet.classList.remove("on"); scrim.classList.remove("on");
    if (!instant) snd("close", 0.3);
    document.body.style.overflow = "";
    if (inTg && !App.keepBack) try { tg.BackButton.hide(); } catch {}
    const hide = () => { if (sheetEl !== sheet) sheet.hidden = true; if (!sheetEl) scrim.hidden = true; syncDucks(); };
    instant ? hide() : setTimeout(hide, 320);
  }
  scrim.addEventListener("click", () => closeSheet());
  all("[data-close]").forEach((b) => b.addEventListener("click", () => closeSheet()));
  if (inTg) try { tg.BackButton.onClick(() => (sheetEl ? (App.sheetBack && App.sheetBack(sheetEl)) || closeSheet() : App.onBack && App.onBack())); } catch {}

  // ---------- баланс ----------
  let shownBalance = state.balance;
  function renderBalance(bump) {
    const nodes = all("[data-balance]");
    tween(shownBalance, state.balance, 500, (v) => nodes.forEach((n) => (n.textContent = fmt(v))));
    shownBalance = state.balance;
    if (bump) { const p = $(".stars-pill"); p.classList.remove("bump"); void p.offsetWidth; p.classList.add("bump"); }
  }

  // ---------- ставка: общая для всех режимов ----------
  const stake = { uids: new Set(), stars: 0 };
  const balInput = $("#balInput"), invGrid = $("#invGrid"), sellSel = $("#sellSelBtn"), stakeSheet = $("#stakeSheet");
  const giftsOnly = () => !!(App.mode && App.mode.giftsOnly);
  const maxItems = () => (App.mode && App.mode.maxItems) || 6;
  const stakeItems = () => state.inv.filter((it) => stake.uids.has(it.uid));
  function stakeValue() {
    let v = giftsOnly() ? 0 : Math.min(stake.stars, state.balance);
    for (const it of stakeItems()) v += byId[it.id].price;
    return v;
  }
  // списывает ставку и возвращает, что было поставлено
  function takeStake() {
    const items = stakeItems(), stars = giftsOnly() ? 0 : Math.min(stake.stars, state.balance);
    const gifts = items.map((it) => byId[it.id]);
    const value = stars + gifts.reduce((a, s) => a + s.price, 0);
    state.balance -= stars;
    state.inv = state.inv.filter((it) => !stake.uids.has(it.uid));
    stake.uids.clear(); stake.stars = 0; balInput.value = 0;
    state.stats.wagered += value; state.stats.spins++;
    if (state.wager && state.wager.need > state.wager.done) state.wager.done += value;   // отыгрыш промокодов
    save(); renderBalance(); renderStake();
    return { value, gifts, stars };
  }
  function stakeChips(gifts, stars, max = 3) {
    const shown = gifts.slice(0, stars ? max - 1 : max).map((s) => chip(s));
    if (stars) shown.push(starChip);
    const rest = gifts.length + (stars ? 1 : 0) - shown.length;
    return shown.length ? `<span class="pile">${shown.join("")}${rest > 0 ? `<span class="more">+${rest}</span>` : ""}</span>` : `<span class="slot-add">+</span>`;
  }
  function renderStake() {
    const items = stakeItems(), stars = giftsOnly() ? 0 : Math.min(stake.stars, state.balance), v = stakeValue();
    all("[data-stake-body]").forEach((n) => (n.innerHTML = stakeChips(items.map((it) => byId[it.id]), stars)));
    all("[data-stake-sum]").forEach((n) => (n.textContent = fmt(v)));
    $("#invCount").textContent = state.inv.length || "";
    sellSel.disabled = !stake.uids.size;
    sellSel.textContent = stake.uids.size ? `Продать выбранные (${stake.uids.size})` : "Продать выбранные";
    stakeSheet.classList.toggle("gifts-only", giftsOnly());
    if (!stakeSheet.hidden) {
      invGrid.innerHTML = state.inv.length
        ? [...state.inv].sort((a, b) => byId[b.id].price - byId[a.id].price)
          .map((it) => invTile(it, stake.uids.has(it.uid) ? "sel" : "")).join("")
        : `<div class="empty">Подарков пока нет. Начните со звёзд.</div>`;
    }
    if (App.mode && App.mode.onStake) App.mode.onStake();
  }
  stakeSheet.addEventListener("sheet:open", () => { stakeSheet.hidden = false; renderStake(); });
  invGrid.addEventListener("click", (e) => {
    const c = e.target.closest("[data-uid]"); if (App.busy || !c || App.pressed) return;
    const uid = Number(c.dataset.uid);
    if (locked(uid)) return toast("Подарок в стейкинге");
    if (stake.uids.has(uid)) stake.uids.delete(uid);
    else { if (stake.uids.size >= maxItems()) return toast(`В ставке не больше ${maxItems()} подарков`); stake.uids.add(uid); }
    hap.select(); renderStake();
  });
  balInput.addEventListener("input", () => {
    if (App.busy) return;
    stake.stars = Math.min(Math.max(0, Math.floor(Number(balInput.value) || 0)), state.balance);
    if (Number(balInput.value) > state.balance) balInput.value = state.balance;
    renderStake();
  });
  all("[data-bal]").forEach((b) => b.addEventListener("click", () => {
    if (App.busy) return;
    if (!state.balance && b.dataset.bal !== "zero") return toast("На балансе нет звёзд");
    balInput.value = b.dataset.bal === "max" ? state.balance : b.dataset.bal === "half" ? Math.floor(state.balance / 2) : 0;
    balInput.dispatchEvent(new Event("input"));
  }));
  sellSel.addEventListener("click", () => {
    if (App.busy || !stake.uids.size) return;
    const sum = sellUids([...stake.uids]);
    hap.coin(); renderBalance(true); renderStake(); renderTasks(); renderProfile();
    toast(`Продано за ${fmt(sum)} звёзд`);
  });
  all(".stake-slot").forEach((b) => b.addEventListener("click", () => { if (!(App.mode && App.mode.lockStake && App.mode.lockStake())) openSheet(stakeSheet); }));

  // ---------- окно выигрыша и плашка проигрыша ----------
  const result = $("#result"), resGift = $("#resGift"), resOk = $("#resOk"), resSell = $("#resSell"), miss = $("#miss");
  let prize = null;
  let prizeAnim = null;
  function showPrize({ gift, uid, stars = 0, sub = "" }) {
    prize = { gift, uid };
    if (prizeAnim) { try { prizeAnim.destroy(); } catch {} prizeAnim = null; }
    resGift.className = "res-art" + (gift ? "" : " stars");
    resGift.style.cssText = gift ? bg(gift) : "";
    resGift.innerHTML = gift ? `<i class="pat"></i><span class="anim"></span>${pic(gift, true)}` : `<b>${STAR}${fmt(stars)}</b>`;
    $("#resTitle").innerHTML = gift ? `${gift.gift} <span class="hint">#${gift.num}</span>` : "Звёзды на балансе";
    $("#resText").innerHTML = [gift ? `${STAR} ${fmt(gift.price)}` : "", sub].filter(Boolean).join(" · ");
    const extra = $("#resExtra");
    extra.hidden = !(gift && stars);
    extra.innerHTML = `Сдача ${STAR} ${fmt(stars)} уже на балансе`;
    resSell.hidden = !gift; $("#resShare").hidden = !gift;
    if (gift) resSell.innerHTML = `Продать за ${STAR}${fmtS(gift.price)}`;
    result.hidden = false; void result.offsetWidth; result.classList.add("on");
    hap.win();
    renderBalance(!!stars);
    if (gift && !REDUCED && window.lottie) {
      fetch(gift.anim).then((r) => (r.ok ? r.json() : Promise.reject())).then((data) => {
        if (!prize || prize.gift !== gift || result.hidden) return;
        prizeAnim = window.lottie.loadAnimation({ container: $(".anim", resGift), renderer: "svg", loop: false, autoplay: true, animationData: data });
        prizeAnim.addEventListener("DOMLoaded", () => resGift.classList.add("playing"));
      }).catch(() => {});
    }
  }
  function hidePrize() {
    result.classList.remove("on");
    setTimeout(() => { result.hidden = true; }, 320);
    renderStake(); renderTasks(); renderProfile();
  }
  resOk.addEventListener("click", () => { hidePrize(); });
  resSell.addEventListener("click", () => {
    if (!prize || !prize.gift) return;
    const sum = sellUids([prize.uid]);
    hap.coin(); renderBalance(true); toast(`Продано за ${fmt(sum)} звёзд`);
    hidePrize();
  });
  // выигрыш в сторис: картинка подарка лежит на сайте, ссылка ведёт в приложение
  $("#resShare").addEventListener("click", () => {
    const g = prize && prize.gift; if (!g) return;
    const link = `https://t.me/${BOT_USERNAME}` + (user ? `?start=ref_${user.id}` : "");
    const text = `Выиграл ${g.gift} #${g.num} за ${fmt(g.price)} звёзд`;
    hap.soft();
    if (inTg && tg.shareToStory) {
      try { tg.shareToStory(`${SITE}/share/${g.id}.jpg`, { text: `${text}\n${link}`, widget_link: { url: link, name: "Играть" } }); return; } catch {}
    }
    if (navigator.share) navigator.share({ text, url: link }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(`${text} ${link}`).then(() => toast("Текст и ссылка скопированы"), () => toast("Сторис доступны в Telegram"));
    else toast("Сторис доступны в Telegram");
  });

  let missT;
  function showMiss(title, text) {
    $("#missTitle").textContent = title;
    $("#missText").innerHTML = text;
    miss.classList.add("on"); hap.lose();
    const d = $(".duck", miss); playDuck(d, false);
    clearTimeout(missT); missT = setTimeout(() => miss.classList.remove("on"), 2600);
  }

  // ---------- история: кружки как сторис ----------
  const MODE_DUCK = { classic: "chart", streak: "fire", contract: "wizard", arena: "ball", crash: "rocket", egg: "hatch" };
  function log(entry) {
    state.history.unshift(entry);
    state.history = state.history.slice(0, 50);
    save(); renderFeed(true); renderTasks();
  }
  function renderFeed(fresh) {
    $("#feed").hidden = !state.history.length;
    $("#hist").innerHTML = state.history.slice(0, 30).map((h, i) => {
      const s = h.id && byId[h.id];
      const inner = s ? `<span class="in" style="${bg(s)}">${pic(s)}</span>`
        : `<span class="in plain"><img src="ducks/${MODE_DUCK[h.mode] || "star"}.webp" alt=""></span>`;
      return `<button class="story ${h.win ? "w" : ""} ${fresh && i === 0 ? "new" : ""}" data-h="${i}" aria-label="Проверить раунд">
        <span class="sring">${inner}</span><span class="x">${xf(h.mult)}</span></button>`;
    }).join("");
    if (fresh) $("#hist").scrollTo({ left: 0, behavior: "smooth" });
  }

  const fairSheet = $("#fairSheet"), verifyBox = $("#verifyBox"), clientSeed = $("#clientSeed");
  function openFair(h) {
    $("#fairHash").textContent = state.fair.hash;
    clientSeed.value = state.fair.clientSeed;
    $("#fairNonce").textContent = state.fair.nonce;
    verifyBox.hidden = !h;
    if (h) {
      const hashOk = hex(sha256(enc(h.serverSeed))) === h.hash;
      const r = Fair.roll(h.serverSeed, h.clientSeed, h.nonce);
      const ok = hashOk && Math.abs(r - h.roll) < 1e-12;
      verifyBox.classList.toggle("bad", !ok);
      verifyBox.innerHTML = `
        <b>${ok ? "Результат подтверждён" : "Проверка не прошла"}</b>
        <span>Раунд №${h.nonce}. ${h.text}</span>
        <span>Число раунда: ${(r * 100).toFixed(3).replace(".", ",")}</span>
        <span>Серверный сид: <code>${h.serverSeed}</code></span>
        <span>Хэш до раунда ${hashOk ? "совпадает" : "не совпадает"}: <code>${h.hash}</code></span>
        <span>Ваш сид: <code>${h.clientSeed}</code></span>`;
    }
    openSheet(fairSheet);
  }
  $("#fairBtn").addEventListener("click", () => openFair());
  $("#hist").addEventListener("click", (e) => { const b = e.target.closest("[data-h]"); if (b) openFair(state.history[Number(b.dataset.h)]); });
  clientSeed.addEventListener("change", () => {
    const v = clientSeed.value.trim();
    if (!v || App.busy) { clientSeed.value = state.fair.clientSeed; return; }
    state.fair.clientSeed = v; save(); toast("Сид сохранён");
  });

  // ---------- пополнение звёздами Telegram ----------
  // Счета созданы заранее через бота (createInvoiceLink, валюта XTR). Приложение открывает счёт
  // через tg.openInvoice и начисляет баланс после статуса "paid".
  // Сейчас начисление идёт в браузере. В рабочем сервисе баланс начисляет сервер по событию successful_payment.
  const INVOICES = {
    10: "https://t.me/$ThHzXod7yUsvHwAA0KMZ1YSQHbw", 50: "https://t.me/$eYtStId7yUswHwAAgCE4vk4gp8w",
    100: "https://t.me/$WONdfId7yUsxHwAAp8IUBHme8F4", 250: "https://t.me/$nuSmI4d7yUsyHwAAQ4B9Zte7PFM",
    500: "https://t.me/$7-pqaod7yUszHwAAZ4TCnz36KrQ", 1000: "https://t.me/$t10DoId7yUs0HwAAMKDceCjLeDg",
  };
  function buyStars(n) {
    if (!INVOICES[n]) return;
    if (App.live && App.live.deposits === false) return toast("Пополнение временно отключено");
    if (!inTg || !tg.openInvoice) return toast("Пополнение работает внутри Telegram");
    hap.soft();
    tg.openInvoice(INVOICES[n], (status) => {
      if (status === "paid") {
        state.balance += n; (state.deposits = state.deposits || []).push({ n, t: Date.now() }); save();
        closeSheet(); hap.coin(); renderBalance(true); renderStake();
        toast(`Баланс пополнен на ${fmt(n)} звёзд`);
      } else if (status === "failed") toast("Оплата не прошла");
    });
  }
  $("#amounts").addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) buyStars(Number(b.dataset.a)); });
  all("[data-deposit]").forEach((b) => b.addEventListener("click", () => openSheet($("#depositSheet"))));
  $("#withdrawBtn").addEventListener("click", () => {
    const w = state.wager, left = w ? Math.max(0, Math.ceil(w.need - w.done)) : 0;
    $("#wdWager").hidden = !left;
    if (left) $("#wdWager").innerHTML = `Чтобы вывести подарки, отыграйте ещё ${STAR} <b>${fmt(left)}</b>. Отыграно ${fmt(w.done)} из ${fmt(w.need)}.<i style="width:${Math.min(100, (w.done / w.need) * 100)}%"></i>`;
    $("#wdBtn").textContent = (App.live && App.live.withdraw_note) || "Вывод подарков скоро";
    openSheet($("#withdrawSheet"));
  });

  // ---------- карточка подарка ----------
  const giftSheet = $("#giftSheet");
  let cardAnim = null;
  function openGift(s, uid) {
    const art = $("#gcArt");
    art.style.cssText = bg(s);
    art.innerHTML = `<i class="pat"></i><span class="anim"></span>${pic(s, true)}`;
    $("#gcName").textContent = s.gift;
    $("#gcNum").textContent = "#" + s.num;
    const row = (k, v, r) => `<div class="row"><span>${k}</span><span class="grow gc-v">${v}</span><b>${String(r).replace(".", ",")}%</b></div>`;
    $("#gcTable").innerHTML = row("Модель", s.model, s.rare) + row("Фон", s.backdrop, s.brare) + row("Символ", s.symbol, s.srare) +
      `<div class="row"><span>Цена</span><span class="grow"></span><b class="gc-price">${STAR} ${fmt(s.price)}</b></div>`;
    const sell = $("#gcSell");
    sell.hidden = uid == null || locked(uid);
    if (App.giftActions) App.giftActions(s, uid);
    sell.innerHTML = `Продать за ${STAR}${fmtS(s.price)}`;
    sell.onclick = () => {
      const sum = sellUids([uid]); closeSheet();
      hap.coin(); renderBalance(true); renderStake(); renderProfile(); renderTasks();
      toast(`Продано за ${fmt(sum)} звёзд`);
    };
    if (cardAnim) { try { cardAnim.destroy(); } catch {} cardAnim = null; }
    openSheet(giftSheet);
    if (!REDUCED && window.lottie) {
      fetch(s.anim).then((r) => (r.ok ? r.json() : Promise.reject())).then((data) => {
        if (sheetEl !== giftSheet) return;
        cardAnim = window.lottie.loadAnimation({ container: $(".anim", art), renderer: "svg", loop: true, autoplay: true, animationData: data });
        cardAnim.addEventListener("DOMLoaded", () => art.classList.add("playing"));
      }).catch(() => {});
    }
    art.classList.remove("playing");
  }
  giftSheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]") && cardAnim) { try { cardAnim.destroy(); } catch {} cardAnim = null; } });
  // долгое нажатие на плитку открывает карточку
  let pressT = null;
  document.addEventListener("pointerdown", (e) => {
    const g = e.target.closest(".gift"); if (!g) return;
    App.pressed = false;
    pressT = setTimeout(() => {
      const it = g.dataset.uid ? state.inv.find((x) => x.uid === Number(g.dataset.uid)) : null;
      const s = it ? byId[it.id] : byId[g.dataset.id];
      if (!s) return;
      App.pressed = true; hap.hit();
      openGift(s, it ? it.uid : null);
    }, 480);
  });
  ["pointerup", "pointercancel", "pointermove", "scroll"].forEach((ev) =>
    document.addEventListener(ev, (e) => { if (ev !== "pointermove" || Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(pressT); }, true));
  document.addEventListener("click", () => setTimeout(() => (App.pressed = false), 0), true);

  // ---------- главная кнопка ----------
  const cta = $("#cta"), cta2 = $("#cta2"), ctaBar = $("#ctaBar");
  let ctaFn = null, cta2Fn = null;
  function setCta(main, second) {
    cta.innerHTML = main.html; cta.disabled = !!main.disabled; ctaFn = main.fn || null;
    cta2.hidden = !second;
    if (second) { cta2.innerHTML = second.html; cta2.disabled = !!second.disabled; cta2Fn = second.fn || null; }
  }
  cta.addEventListener("click", () => { if (!cta.disabled && ctaFn) ctaFn(); });
  cta2.addEventListener("click", () => { if (!cta2.disabled && cta2Fn) cta2Fn(); });

  // ---------- вкладки и режимы ----------
  const modes = {};
  let tab = "pageUp";
  function showTab(id) {
    tab = id;
    all(".tab").forEach((x) => { const on = x.dataset.tab === id; x.classList.toggle("on", on); if (on) playDuck($(".duck", x), false); });
    all(".page").forEach((p) => { const on = p.id === id; p.hidden = !on; p.classList.toggle("on", on); });
    ctaBar.hidden = id !== "pageUp";
    if (id === "pageTasks") renderTasks();
    if (id === "pageProfile") renderProfile();
    if (App.onTab) App.onTab(id);
    window.scrollTo(0, 0); syncDucks();
  }
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]"); if (!b || App.busy || b.dataset.tab === tab) return;
    hap.select(); showTab(b.dataset.tab);
  });
  function showMode(name) {
    if (App.mode && App.mode.leave) App.mode.leave();
    App.mode = modes[name]; App.modeName = name;
    all("#modes [data-mode]").forEach((b) => { const on = b.dataset.mode === name; b.classList.toggle("on", on); if (on) { playDuck($(".duck", b), false); b.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); } });
    all(".mode").forEach((m) => (m.hidden = m.id !== "mode-" + name));
    state.lastMode = name; save();
    renderStake();
    if (App.mode.enter) App.mode.enter();
    syncDucks();
  }
  $("#modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]"); if (!b || App.busy || b.dataset.mode === App.modeName) return;
    hap.select(); showMode(b.dataset.mode);
  });

  // ---------- задания ----------
  // Награды начисляются в браузере. В рабочем сервисе выполнение проверяет сервер.
  const today = () => new Date().toISOString().slice(0, 10);
  const TASKS = [
    { id: "daily", duck: "calendar", title: "Зайти сегодня", reward: 25, goal: 1, get: () => 1, daily: true },
    { id: "first", duck: "like", title: "Сыграть первый раз", reward: 50, goal: 1, get: () => state.stats.spins },
    { id: "spins10", duck: "game", title: "Сыграть 10 раз", reward: 150, goal: 10, get: () => state.stats.spins },
    { id: "wins3", duck: "cool", title: "Выиграть 3 раза", reward: 200, goal: 3, get: () => state.stats.wins },
    { id: "low", duck: "mind", title: "Выиграть апгрейд с шансом ниже 25%", reward: 300, goal: 1, get: () => state.stats.lowWins },
    { id: "streak3", duck: "fire", title: "Серия из 3 побед", reward: 300, goal: 3, get: () => state.stats.bestStreak },
    { id: "crash3", duck: "rocket", title: "Забрать краш на ×3", reward: 250, goal: 1, get: () => (state.stats.bestCrash >= 3 ? 1 : 0) },
    { id: "contract", duck: "wizard", title: "Подписать контракт", reward: 150, goal: 1, get: () => state.stats.contracts },
    { id: "arena", duck: "ball", title: "Победить на арене", reward: 250, goal: 1, get: () => state.stats.arenaWins },
    { id: "eggs3", duck: "hatch", title: "Разбить 3 яйца", reward: 150, goal: 3, get: () => state.stats.eggs || 0 },
    { id: "inv3", duck: "gift", title: "Собрать 3 подарка", reward: 150, goal: 3, get: () => state.inv.length },
    { id: "spins50", duck: "muscle", title: "Сыграть 50 раз", reward: 500, goal: 50, get: () => state.stats.spins },
    { id: "friend", duck: "hug", title: "Пригласить друга", reward: REF_BONUS, goal: 1, get: () => state.refs || 0 },
  ];
  const taskDone = (t) => (t.daily ? state.claimed[t.id] === today() : !!state.claimed[t.id]);
  // задания из админки: подписка на канал или чат, переход по ссылке. Выполнение проверяет сервер.
  const customTasks = () => ((App.live && App.live.tasks) || []).map((c) => ({ id: "c" + c.id, sid: c.id, custom: c.kind, target: c.target, duck: c.kind === "sub" ? "phone" : "link",
    title: c.title, reward: c.reward, goal: 1, get: () => (state.opened && state.opened["c" + c.id] ? 1 : 0), serverDone: c.done }));
  function renderTasks() {
    let ready = 0;
    const rows = [...customTasks(), ...TASKS].map((t) => {
      const done = taskDone(t), cur = Math.min(t.goal, t.get()), can = !done && cur >= t.goal;
      if (can) ready++;
      return { t, done, cur, can };
    }).sort((a, b) => (b.can - a.can) || (a.done - b.done));
    $("#taskDot").hidden = !ready;
    if (tab !== "pageTasks") return;
    $("#taskList").innerHTML = rows.map(({ t, done, cur, can }) => `
      <div class="task ${done ? "done" : ""}">
        <span class="duck lg" data-duck="${t.duck}"></span>
        <div class="t-main">
          <span class="t-title">${t.title}</span>
          <span class="t-sub">+${fmt(t.reward)} ${STAR}${t.goal > 1 && !done ? ` <span>${cur} из ${t.goal}</span>` : ""}</span>
          ${t.goal > 1 && !done ? `<span class="t-bar"><i style="width:${(cur / t.goal) * 100}%"></i></span>` : ""}
        </div>
        ${t.custom ? `<button class="mini-btn" data-task="${t.id}" ${done ? "disabled" : ""}>${done ? "Получено" : can ? "Проверить" : t.custom === "sub" ? "Подписаться" : "Открыть"}</button>`
          : `<button class="mini-btn" data-task="${t.id}" ${can ? "" : "disabled"}>${done ? (t.daily ? "Завтра" : "Получено") : can ? "Забрать" : "В процессе"}</button>`}
      </div>`).join("");
    initDucks($("#taskList"));
  }
  $("#taskList").addEventListener("click", (e) => {
    const row = e.target.closest(".task"); if (row) playDuck($(".duck", row), false);
    const b = e.target.closest("[data-task]"); if (!b || b.disabled) return;
    const ct = customTasks().find((x) => x.id === b.dataset.task);
    if (ct) {
      if (taskDone(ct)) return;
      if (!ct.get()) {          // сначала открыть канал или ссылку, потом проверить
        const url = ct.custom === "sub" ? (ct.target.startsWith("@") ? `https://t.me/${ct.target.slice(1)}` : ct.target) : ct.target;
        state.opened = state.opened || {}; state.opened[ct.id] = 1; save();
        try { if (inTg && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url); else if (inTg) tg.openLink(url); else window.open(url, "_blank"); } catch {}
        return setTimeout(renderTasks, 600);
      }
      if (!App.checkTask) return toast("Нет связи с сервером");
      b.disabled = true;
      App.checkTask(ct.sid).then((reward) => {
        state.claimed[ct.id] = true; state.balance += reward; save();
        hap.coin(); renderBalance(true); renderTasks(); renderStake(); toast(`+${fmt(reward)} звёзд`);
      }, (msg) => { b.disabled = false; toast(msg); });
      return;
    }
    const t = TASKS.find((x) => x.id === b.dataset.task);
    if (!t || taskDone(t) || t.get() < t.goal) return;
    state.claimed[t.id] = t.daily ? today() : true;
    state.balance += t.reward; save();
    hap.coin(); hap.result(true);
    renderBalance(true); renderTasks(); renderStake();
    toast(`+${fmt(t.reward)} звёзд`);
  });

  // ---------- друзья ----------
  // Ссылка ведёт в чат с ботом. Бот видит, кто кого пригласил, и присылает пригласившему кнопку с бонусом.
  function initFriends() {
    const link = BOT_USERNAME && user ? `https://t.me/${BOT_USERNAME}?start=ref_${user.id}` : "";
    $("#refTerms").textContent = `${REF_BONUS} звёзд за каждого друга, который запустит бота по вашей ссылке`;
    $("#refLink").textContent = link || "Ссылка появится после входа через Telegram";
    $("#refCopy").disabled = $("#refShare").disabled = !link;
    $("#refCopy").addEventListener("click", () => {
      navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast("Ссылка скопирована"), () => toast("Не получилось скопировать"));
    });
    $("#refShare").addEventListener("click", () => {
      if (App.shareRef && App.shareRef()) return;   // анимированный баннер через бота
      const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("DuckChance: игры на подарки за звёзды. Заходи")}`;
      if (inTg) try { return tg.openTelegramLink(url); } catch {}
      window.open(url, "_blank");
    });
    renderFriends();
  }
  function renderFriends() {
    $("#refCount").textContent = state.refs || 0;
    $("#refEarned").textContent = fmt(state.refEarned || 0);
  }

  // ---------- коды: промокоды и бонусы за друзей ----------
  // Код: ВИД-СУММА-НОМЕР-ПОДПИСЬ. Вид P это промокод, R это бонус за друга.
  // Подпись считается от ключа CODE_KEY. Код срабатывает один раз на устройстве.
  const signCode = (kind, amount, nonce) => hex(hmac(CODE_KEY, enc(`${kind}:${amount}:${nonce}`))).slice(0, 10);
  const makeCode = (kind, amount, nonce) => `${kind}-${amount}-${nonce}-${signCode(kind, amount, nonce)}`;
  function redeemCode(raw, quiet) {
    const m = /^([PR])-(\d{1,7})-([A-Za-z0-9]{1,24})-([0-9a-f]{10})$/.exec(String(raw || "").trim());
    const fail = (t) => { if (!quiet) { toast(t); hap.lose(); } return false; };
    if (!m) return fail("Такого кода нет");
    const [, kind, amountS, nonce, sig] = m, amount = Number(amountS);
    if (signCode(kind, amount, nonce) !== sig || !amount) return fail("Такого кода нет");
    state.codes = state.codes || [];
    if (state.codes.includes(m[0])) return fail("Этот код уже использован");
    state.codes.push(m[0]);
    state.balance += amount;
    if (kind === "R") { state.refs = (state.refs || 0) + 1; state.refEarned = (state.refEarned || 0) + amount; }
    save(); hap.coin(); renderBalance(true); renderStake(); renderFriends(); renderTasks();
    toast(kind === "R" ? `+${fmt(amount)} звёзд за друга` : `Промокод: +${fmt(amount)} звёзд`);
    return true;
  }
  // бот открывает приложение со ссылкой вида ?code=... или ?ref=...
  function readLaunch() {
    const q = new URLSearchParams(location.search);
    const ref = q.get("ref");
    if (ref && !state.referrer && !(user && String(user.id) === ref)) { state.referrer = ref; save(); }
    // кнопки бота открывают нужный раздел: ?open=egg или ?open=chats
    const open = q.get("open");
    if (open === "egg" && modes.egg) setTimeout(() => showMode("egg"), 300);
    if (open === "chats") setTimeout(() => showTab("pageChats"), 300);
    if (open === "profile") setTimeout(() => showTab("pageProfile"), 300);
    const code = q.get("code");
    if (code) setTimeout(() => redeemCode(code, (state.codes || []).includes(code)), 1400);
  }

  // ---------- награды с сервера: промокоды и выдачи админа ----------
  // wager: во сколько раз нужно прокрутить сумму награды, прежде чем выводить подарки
  function applyReward(r, from) {
    let value = 0, text = "";
    if (r.kind === "stars" || r.kind === "add") { state.balance = Math.max(0, state.balance + r.amount); value = Math.abs(r.amount); text = `${r.amount >= 0 ? "+" : ""}${fmt(r.amount)} звёзд`; }
    else if (r.kind === "set") { value = Math.max(0, r.amount - state.balance); state.balance = Math.max(0, r.amount); text = `Баланс: ${fmt(r.amount)} звёзд`; }
    else if ((r.kind === "gift") && byId[r.gift]) { grant(byId[r.gift]); value = byId[r.gift].price; text = `${byId[r.gift].gift} #${byId[r.gift].num}`; }
    else return;
    if (r.wager > 0 && value > 0) {
      state.wager = state.wager || { need: 0, done: 0 };
      state.wager.need += value * r.wager;
    }
    save(); hap.coin(); renderBalance(true); renderStake(); renderProfile(); renderTasks();
    toast(`${from}: ${text}${r.wager > 0 ? `, отыгрыш ×${r.wager}` : ""}`);
  }

  // ---------- профиль ----------
  function initProfile() {
    const name = user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "Гость";
    all("[data-name]").forEach((n) => (n.textContent = name));
    $("#barMe").addEventListener("click", () => { if (!App.busy) { hap.select(); showTab("pageProfile"); } });
    all("[data-ava]").forEach((a) => {
      a.textContent = name.trim().charAt(0).toUpperCase();
      if (user && user.photo_url) { a.style.backgroundImage = `url("${user.photo_url}")`; a.textContent = ""; }
    });
    $("#meHandle").textContent = user ? (user.username ? "@" + user.username : "ID " + user.id) : "Войдите через Telegram";
    const hapSw = $("#hapSw"), soundSw = $("#soundSw");
    soundSw.checked = state.sound !== false;
    soundSw.addEventListener("change", () => { state.sound = soundSw.checked; save(); snd("toggle", 0.4); });
    hapSw.checked = state.haptics !== false;
    hapSw.addEventListener("change", () => { state.haptics = hapSw.checked; save(); hap.hit(); });
    $("#profGrid").addEventListener("click", (e) => {
      const c = e.target.closest("[data-uid]"); if (!c || App.pressed) return;
      const it = state.inv.find((x) => x.uid === Number(c.dataset.uid));
      if (it) openGift(byId[it.id], it.uid);
    });
  }
  function renderProfile() {
    if (tab !== "pageProfile") return;
    const gifts = [...state.inv].sort((a, b) => byId[b.id].price - byId[a.id].price);
    const total = gifts.reduce((a, it) => a + byId[it.id].price, 0);
    paintBanner();
    if (App.onProfile) App.onProfile();
    $("#profCount").innerHTML = gifts.length ? `${gifts.length} · ${STAR} ${fmtS(total)}` : "";
    $("#profGrid").innerHTML = gifts.length
      ? gifts.map((it) => invTile(it)).join("")
      : `<div class="empty">Здесь будут выигранные подарки</div>`;
  }

  // ---------- баннер профиля: свой цвет и узор ----------
  const BANNER_COLORS = [], BANNER_SYMS = [];
  (function () {
    const seenC = new Set(), seenS = new Set();
    for (const g of CATALOG) {
      if (!seenC.has(g.backdrop) && BANNER_COLORS.length < 28) { seenC.add(g.backdrop); BANNER_COLORS.push({ name: g.backdrop, c1: g.c1, c2: g.c2, cp: g.cp }); }
      if (!seenS.has(g.sym) && BANNER_SYMS.length < 31) { seenS.add(g.sym); BANNER_SYMS.push({ name: g.symbol, sym: g.sym }); }
    }
  })();
  const owned = (id) => state.inv.some((x) => x.id === id);
  function bannerLook() {
    if (state.banner) return state.banner;
    const top = [...state.inv].sort((a, b) => byId[b.id].price - byId[a.id].price)[0];
    const g = top && byId[top.id];
    return g ? { c1: g.c1, c2: g.c2, cp: g.cp, sym: g.sym, gift: g.id } : { c1: "#5ea8ff", c2: "#2f6fe0", cp: "#1f55b8", sym: null };
  }
  // узор как в Telegram: символы кольцами вокруг аватарки, к краям бледнее
  const RINGS = [[62, 7, 0.6, 22], [96, 11, 0.4, 20], [132, 15, 0.24, 18], [170, 19, 0.13, 16], [210, 23, 0.06, 15]];
  const ringsHtml = RINGS.map(([r, n, o, sz], k) => Array.from({ length: n }, (_, i) => {
    const a = (i + (k % 2) * 0.5) / n * Math.PI * 2;
    return `<i style="left:calc(50% + ${(Math.cos(a) * r * 1.35).toFixed(1)}px);top:${(70 + Math.sin(a) * r * 0.8).toFixed(1)}px;opacity:${o};width:${sz}px"></i>`;
  }).join("")).join("");
  function paintBanner() {
    const b = bannerLook(), el = $("#pfBanner"), rings = $("#pfRings");
    el.style.cssText = `--c1:${b.c1};--c2:${b.c2};--cp:${b.cp}` + (b.sym ? `;--sym:url('${b.sym}')` : "");
    el.classList.toggle("has", !!b.sym);
    if (App.onLook) App.onLook(b);
    if (b.sym && !rings.firstChild) rings.innerHTML = ringsHtml;
    const g = b.gift && owned(b.gift) ? byId[b.gift] : null, ic = $("#pfGift");
    ic.hidden = !g;
    if (g) { ic.src = g.img; ic.alt = g.gift; }
    $(".ava", el).classList.toggle("aring", !!(App.styleOf && App.styleOf(b)));
  }
  function renderBannerSheet() {
    const b = bannerLook();
    const ids = [...new Set([...state.inv].sort((x, y) => byId[y.id].price - byId[x.id].price).map((x) => x.id))];
    $("#bnGifts").innerHTML = ids.length
      ? ids.map((id) => `<button class="bn-gift ${b.gift === id ? "on" : ""}" data-g="${id}" aria-label="${byId[id].gift}">${chip(byId[id])}</button>`).join("")
      : `<div class="empty sm">Выиграйте подарок, и его можно будет поставить на обложку</div>`;
    $("#bnColors").innerHTML = BANNER_COLORS.map((c, i) => `<button class="bn-color ${!b.gift && c.c1 === b.c1 && c.c2 === b.c2 ? "on" : ""}" data-c="${i}" title="${c.name}" aria-label="${c.name}" style="background:radial-gradient(circle at 50% 35%, ${c.c1}, ${c.c2})"></button>`).join("");
    $("#bnSyms").innerHTML = `<button class="bn-sym none ${!b.sym ? "on" : ""}" data-s="-1" aria-label="Без узора">Нет</button>` +
      BANNER_SYMS.map((x, i) => `<button class="bn-sym ${!b.gift && x.sym === b.sym ? "on" : ""}" data-s="${i}" title="${x.name}" aria-label="${x.name}"><i style="--sym:url('${x.sym}')"></i></button>`).join("");
  }
  function initBanner() {
    $("#bannerEdit").addEventListener("click", () => { renderBannerSheet(); openSheet($("#bannerSheet")); });
    $("#bnGifts").addEventListener("click", (e) => {
      const b = e.target.closest("[data-g]"); if (!b) return;
      const g = byId[b.dataset.g];
      state.banner = { c1: g.c1, c2: g.c2, cp: g.cp, sym: g.sym, gift: g.id }; save(); hap.soft(); paintBanner(); renderBannerSheet();
    });
    $("#bnColors").addEventListener("click", (e) => {
      const b = e.target.closest("[data-c]"); if (!b) return;
      const c = BANNER_COLORS[Number(b.dataset.c)];
      state.banner = { ...bannerLook(), c1: c.c1, c2: c.c2, cp: c.cp, gift: null }; save(); hap.soft(); paintBanner(); renderBannerSheet();
    });
    $("#bnSyms").addEventListener("click", (e) => {
      const b = e.target.closest("[data-s]"); if (!b) return;
      const i = Number(b.dataset.s);
      state.banner = { ...bannerLook(), sym: i < 0 ? null : BANNER_SYMS[i].sym, gift: null }; save(); hap.soft(); paintBanner(); renderBannerSheet();
    });
    $("#bnReset").addEventListener("click", () => { state.banner = null; save(); hap.soft(); paintBanner(); renderBannerSheet(); });
  }

  // ---------- промокод ----------
  function initPromo() {
    $("#promoBtn").addEventListener("click", () => { $("#promoInput").value = ""; openSheet($("#promoSheet")); });
    $("#promoGo").addEventListener("click", () => {
      const v = $("#promoInput").value.trim();
      if (/^[PR]-\d+-[A-Za-z0-9]+-[0-9a-f]{10}$/.test(v) || !App.redeemPromo) { if (redeemCode(v)) closeSheet(); return; }
      if (!v) return toast("Введите промокод");
      App.redeemPromo(v).then(() => closeSheet(), (msg) => { toast(msg); hap.lose(); });
    });
  }

  // ---------- админ-панель ----------
  // Видна только админу. Сервера нет, поэтому панель меняет данные на этом устройстве,
  // а другим игрокам звёзды выдаются промокодом.
  const isAdmin = !!(user && user.id === ADMIN_ID) || ["127.0.0.1", "localhost"].includes(location.hostname);
  function initAdmin() {
    const row = $("#adminBtn");
    row.hidden = !isAdmin;
    if (!isAdmin) return;
    const num = (id) => Math.floor(Number($(id).value) || 0);
    const info = () => {
      const dep = (state.deposits || []).reduce((a, d) => a + d.n, 0);
      $("#admInfo").innerHTML = `Баланс ${STAR} ${fmt(state.balance)} · подарков ${state.inv.length} · игр ${state.stats.spins} · пополнено ${STAR} ${fmt(dep)}`;
    };
    row.addEventListener("click", () => { if (App.openAdmin) return App.openAdmin(); info(); $("#admGift").innerHTML = byPrice.map((g) => `<option value="${g.id}">${g.gift} · ${g.model} · ${fmtS(g.price)}</option>`).join(""); openSheet($("#adminSheet")); });
    $("#admGive").addEventListener("click", () => {
      const n = num("#admStars"); if (!n) return toast("Введите сумму");
      state.balance = Math.max(0, state.balance + n); save(); hap.coin(); renderBalance(true); renderStake(); info();
      toast(`${n > 0 ? "+" : ""}${fmt(n)} звёзд`);
    });
    $("#admGrant").addEventListener("click", () => {
      const g = byId[$("#admGift").value]; if (!g) return;
      grant(g); hap.coin(); renderStake(); renderProfile(); renderTasks(); info();
      toast(`Выдан ${g.gift} #${g.num}`);
    });
    $("#admCode").addEventListener("click", () => {
      const n = num("#admCodeSum"); if (n < 1) return toast("Введите сумму");
      const code = makeCode("P", n, Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36));
      $("#admCodeOut").textContent = code; $("#admCodeOut").hidden = false; hap.soft();
      navigator.clipboard && navigator.clipboard.writeText(code).then(() => toast("Промокод скопирован"), () => {});
    });
    $("#admReset").addEventListener("click", () => {
      if (!confirm("Сбросить баланс, подарки и историю на этом устройстве?")) return;
      const keep = { fair: state.fair, sound: state.sound, haptics: state.haptics, banner: state.banner, codes: state.codes };
      state = Object.assign(freshState(), keep);
      state.stats = { spins: 0, wins: 0, best: 0, wagered: 0, lowWins: 0, bestStreak: 0, bestCrash: 0, arenaWins: 0, contracts: 0 };
      state.claimed = {}; stake.uids.clear(); stake.stars = 0;
      save(); location.reload();
    });
  }

  // ---------- клавиатура ----------
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.key === "Escape") return closeSheet();
    if ((e.key === "Enter" || e.key === " ") && t.matches && t.matches(".gift")) { e.preventDefault(); return t.click(); }
    if (e.code === "Space" && !sheetEl && tab === "pageUp" && result.hidden && !(t.closest && t.closest("input, select, textarea, button, [role=button]"))) { e.preventDefault(); cta.click(); }
  });

  // ---------- запуск ----------
  function start() {
    initDucks(); initProfile(); initFriends(); initBanner(); initPromo(); initAdmin(); readLaunch();
    if (App.initSocial) App.initSocial();
    all("[data-balance]").forEach((n) => (n.textContent = fmt(state.balance)));
    Object.values(modes).forEach((m) => m.init && m.init());
    renderFeed(); renderTasks();
    showMode(modes[state.lastMode] ? state.lastMode : "classic");
    const splash = $("#splash"), t0 = performance.now();
    playDuck($(".duck", splash), true);
    const hide = () => setTimeout(() => { splash.classList.add("done"); setTimeout(syncDucks, 400); }, Math.max(0, 1100 - (performance.now() - t0)));
    if (document.readyState === "complete") hide(); else addEventListener("load", hide);
    setTimeout(() => splash.classList.add("done"), 3500);
  }

  const App = window.App = {
    HOUSE, rtp, CFG, CATALOG, byId, byPrice, state: () => state, save, user, inTg,
    $, all, STAR, fmt, fmtS, pct, xf, REDUCED, wait, tween,
    hap, snd, duckData, makeCode, redeemCode, setDuck, playDuck, syncDucks, initDucks,
    bg, pic, tile, chip, starChip, bestGift, payout, grant, sellUids,
    Fair, sha256, hex, enc, nextRound, Dial, confetti, PARTY, toast,
    openSheet, closeSheet, get sheet() { return sheetEl; },
    stake, stakeValue, takeStake, stakeChips, renderStake, renderBalance,
    showPrize, showMiss, log, renderFeed, renderTasks, renderProfile, openGift, setCta,
    locked, invTile, bannerLook, tg, BOT_USERNAME, get tab() { return tab; }, applyReward, buyStars, live: null,
    registerMode(name, m) { modes[name] = m; }, get modes() { return modes; }, showMode, start,
    mode: null, modeName: "", busy: false, pressed: false,
  };
})();
