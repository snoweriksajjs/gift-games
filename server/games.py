"""Онлайн-игры DuckChance: общий краш, арена с живыми игроками и лента выигрышей.

Раунды разыгрывает сервер. Честность: до начала раунда игроки видят хеш секретного числа (sha256),
после раунда сервер раскрывает само число, и результат можно пересчитать.
Выигрыш выдаётся через «выдачи» (таблица grants): игрок получит его, даже если закрыл приложение посреди раунда.

Ставка списывается на устройстве игрока, сервер знает только её сумму (как и весь баланс в приложении).
Пока баланс не переехал на сервер, ущерб от поддельных ставок ограничен: потолок ставки (max_bet),
выход из Арены без выдачи звёзд, крупные выигрыши (hold_over) ждут подтверждения админа.
"""
import hashlib, json, math, os, secrets, threading, time

import catalog

G = {}
lock = threading.RLock()

SPEED = 0.09                     # множитель краша = e^(SPEED * секунды)
CRASH_BET_MS, CRASH_END_MS = 8000, 3500
ARENA_GATHER_MS = 25000          # сколько ждём соперников после первой ставки
ARENA_SHOW_MS = 16500            # отсчёт, удар, полёт мяча и показ победителя
ARENA_FLY_MS = 8000              # полёт мяча одинаковый у всех игроков


def max_bet():
    return int(G["admin"].settings().get("max_bet") or 100000)


MIN_BET = 10     # меньше нельзя: на 1–9 звёздах округление выплаты вниз заметно съедает выигрыш


def bet_of(body, key="bet"):
    """Целая ставка от 1 до max_bet, иначе 400 (бесконечность, текст и дроби отклоняются)."""
    v = body.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v != int(v):
        raise G["HttpError"](400, "bad bet")
    v = int(v)
    if not MIN_BET <= v <= max_bet():
        raise G["HttpError"](400, "bad bet")
    return v


def bind(g):
    G.update(g)
    threading.Thread(target=loop, daemon=True).start()


def now_ms():
    return int(time.time() * 1000)


def rtp(mode):
    """Шанс режима для всех (в общих раундах личных шансов нет)."""
    a = G["admin"]
    return a.effective_rtp(a.settings(), None)[1][mode]


def roll_of(seed):
    return int(hashlib.sha256(seed.encode()).hexdigest()[:13], 16) / 16 ** 13


def card(uid):
    u = G["user_card"](uid)
    return {"id": uid, "name": u["name"], "photo": u["photo"], "look": u["look"]}


def give_win(uid, value, note):
    """Выигрыш через выдачу: приложение превратит сумму в подарок и сдачу звёздами.
    Крупный выигрыш получает отметку hold: игрок получит его после подтверждения админом."""
    hold = 1 if int(value) > int(G["admin"].settings().get("hold_over") or 50000) else None
    return G["run"]("INSERT INTO grants (user, kind, amount, gift, wager, note, created, hold) VALUES (?, 'win', ?, NULL, 0, ?, ?, ?)",
                    uid, int(value), note, int(time.time()), hold), bool(hold)


# ---------- лента выигрышей ----------
feed = []


def to_feed(uid, mode, value, mult, gift=None):
    c = card(uid)
    with lock:
        feed.insert(0, {"user": {"id": uid, "name": c["name"], "photo": c["photo"]}, "mode": mode, "value": int(value),
                        "mult": round(mult, 2) if mult else None, "gift": gift, "at": int(time.time())})
        del feed[40:]


# ---------- краш ----------
crash = {}
crash_hist = []


def commit(seed, r):
    """Отпечаток раунда: и секретное число, и доля возврата. Админ не может поменять шансы уже объявленного раунда."""
    return hashlib.sha256(f"{seed}:{r}".encode()).hexdigest()


def crash_new():
    seed, r = secrets.token_hex(16), round(rtp("crash"), 4)
    crash.clear()
    crash.update({"id": now_ms(), "phase": "bet", "seed": seed, "rtp": r, "hash": commit(seed, r),
                  "bet_end": now_ms() + CRASH_BET_MS, "t0": None, "cp": None, "bets": {}})


def crash_m(t):
    return math.exp(SPEED * max(0, t - crash["t0"]) / 1000) if crash.get("t0") else 1.0


def crash_cash(uid, at):
    b = crash["bets"].get(uid)
    if not b or b["cashed"]:
        return None
    b["cashed"] = round(at, 2)
    value = int(b["bet"] * b["cashed"])
    b["grant"], b["held"] = give_win(uid, value, f"Краш ×{b['cashed']:.2f}".replace(".", ","))
    to_feed(uid, "crash", value, b["cashed"])
    return b


def crash_tick(t):
    if not crash:
        return crash_new()
    ph = crash["phase"]
    if ph == "bet" and t >= crash["bet_end"]:
        cp = min(1000.0, max(1.0, math.floor(crash["rtp"] / (1 - roll_of(crash["seed"])) * 100) / 100))
        crash.update({"phase": "fly", "t0": t, "cp": cp, "crash_at": t + int(math.log(cp) / SPEED * 1000)})
    elif ph == "fly":
        m = crash_m(t)
        for uid, b in list(crash["bets"].items()):           # автовывод
            if not b["cashed"] and b["auto"] and b["auto"] <= min(m, crash["cp"]) and b["auto"] < crash["cp"]:
                crash_cash(uid, b["auto"])
        if t >= crash["crash_at"]:
            crash.update({"phase": "end", "end_at": t})
            crash_hist.insert(0, crash["cp"])
            del crash_hist[14:]
    elif ph == "end" and t >= crash["end_at"] + CRASH_END_MS:
        crash_new()


def crash_state(uid):
    t = now_ms()
    c = crash
    out = {"now": t, "id": c["id"], "phase": c["phase"], "hash": c["hash"], "bet_end": c["bet_end"], "t0": c["t0"], "speed": SPEED,
           "history": crash_hist[:14],
           "bets": [{**card(u), "bet": b["bet"], "cashed": b["cashed"], "gift": b.get("gift")} for u, b in c["bets"].items()]}
    if c["phase"] == "end":
        out.update({"cp": c["cp"], "seed": c["seed"], "rtp": c["rtp"]})
    mine = c["bets"].get(uid)
    if mine:
        out["my"] = {"bet": mine["bet"], "cashed": mine["cashed"], "auto": mine["auto"], "grant": mine.get("grant"), "held": mine.get("held", False)}
    return out


# ---------- арена ----------
arena = {}
arena_hist = []


def arena_new():
    seed, r = secrets.token_hex(16), round(rtp("arena"), 4)
    arena.clear()
    arena.update({"id": now_ms(), "phase": "wait", "seed": seed, "rtp": r, "hash": commit(seed, r),
                  "players": [], "ends_at": None, "play_at": None, "winner": None, "payout": 0})


def arena_tick(t):
    if not arena:
        return arena_new()
    ph = arena["phase"]
    if ph == "gather" and t >= arena["ends_at"]:
        if len(arena["players"]) < 2:              # один игрок: ждём ещё, он может выйти и забрать ставку
            arena["ends_at"] = t + ARENA_GATHER_MS
            return
        total = sum(p["value"] for p in arena["players"])
        roll, acc, wi = roll_of(arena["seed"]), 0, len(arena["players"]) - 1
        for i, p in enumerate(arena["players"]):
            acc += p["value"] / total
            if roll < acc:
                wi = i
                break
        payout = int(total * arena["rtp"])
        w = arena["players"][wi]
        arena.update({"phase": "play", "play_at": t, "winner": wi, "payout": payout, "total": total})
        arena["grant"], arena["held"] = give_win(w["id"], payout, f"Арена, банк {total}")
        to_feed(w["id"], "arena", payout, payout / max(1, w["value"]))
    elif ph == "play" and t >= arena["play_at"] + ARENA_SHOW_MS:
        arena_hist.insert(0, {"winner": card(arena["players"][arena["winner"]]["id"])["name"], "total": arena["total"]})
        del arena_hist[10:]
        arena_new()


def arena_state(uid):
    a = arena
    out = {"now": now_ms(), "id": a["id"], "phase": a["phase"], "hash": a["hash"], "ends_at": a["ends_at"], "play_at": a["play_at"],
           "fly_ms": ARENA_FLY_MS, "show_ms": ARENA_SHOW_MS,
           "players": [{**card(p["id"]), "value": p["value"], "gifts": p["gifts"]} for p in a["players"]], "history": arena_hist[:10]}
    if a["phase"] == "play":
        out.update({"winner": a["winner"], "seed": a["seed"], "payout": a["payout"], "total": a["total"], "rtp": a["rtp"]})
        if a["players"][a["winner"]]["id"] == uid:
            out["my_grant"] = a.get("grant")
            out["my_held"] = a.get("held", False)
    return out


# ---------- цикл и запросы ----------
def loop():
    while True:
        try:
            t = now_ms()
            with lock:
                crash_tick(t)
                arena_tick(t)
        except Exception as e:
            print("Ошибка игрового цикла:", repr(e), flush=True)
        time.sleep(0.1)


def clean_gifts(gifts):
    return [g for g in (gifts or []) if isinstance(g, str) and G["GIFT_ID"].match(g)][:10]


def handle(method, p, uid, body, query, now):
    if not p or p[0] not in ("crash", "arena", "feed", "online"):
        return None
    err = G["HttpError"]
    with lock:
        if p == ["crash"] and method == "GET":
            return crash_state(uid)
        if p == ["crash", "bet"] and method == "POST":
            G["limit"](uid, "crashbet", 10, 30)
            if crash["phase"] != "bet":
                raise err(409, "betting closed")
            if uid in crash["bets"]:
                raise err(409, "already in")
            bet = bet_of(body)
            auto = body.get("auto") or 0
            if isinstance(auto, bool) or not isinstance(auto, (int, float)) or not math.isfinite(auto) or auto < 0:
                raise err(400, "bad auto")
            if auto >= 1000:                         # точка краша не выше ×1000: такой автовывод не сработал бы никогда
                raise err(400, "auto too high")
            crash["bets"][uid] = {"bet": bet, "auto": round(auto, 2) if auto >= 1.01 else 0, "cashed": None,
                                  "gift": (clean_gifts(body.get("gifts")) or [None])[0]}
            return crash_state(uid)
        if p == ["crash", "cashout"] and method == "POST":
            if crash["phase"] != "fly":
                raise err(409, "not flying")
            m = crash_m(now_ms())
            if m >= crash["cp"]:
                raise err(409, "crashed")
            b = crash_cash(uid, m)
            if not b:
                raise err(409, "no bet")
            return {"cashed": b["cashed"], "grant": b["grant"], "held": b["held"], "value": int(b["bet"] * b["cashed"])}

        if p == ["arena"] and method == "GET":
            return arena_state(uid)
        if p == ["arena", "join"] and method == "POST":
            G["limit"](uid, "arenajoin", 10, 30)
            if arena["phase"] not in ("wait", "gather"):
                raise err(409, "round is playing")
            if any(x["id"] == uid for x in arena["players"]):
                raise err(409, "already in")
            if len(arena["players"]) >= 12:
                raise err(409, "room full")
            value = bet_of(body)
            arena["players"].append({"id": uid, "value": value, "gifts": clean_gifts(body.get("gifts"))})
            if arena["phase"] == "wait":
                arena.update({"phase": "gather", "ends_at": now_ms() + ARENA_GATHER_MS})
            elif len(arena["players"]) == 2:          # второй игрок: короткий отсчёт, чтобы не ждать
                arena["ends_at"] = min(arena["ends_at"], now_ms() + 15000)
            return arena_state(uid)
        if p == ["arena", "leave"] and method == "POST":
            if arena["phase"] != "gather":
                raise err(409, "cannot leave now")
            me = next((x for x in arena["players"] if x["id"] == uid), None)
            if not me:
                raise err(409, "not in")
            arena["players"].remove(me)
            if not arena["players"]:
                arena_new()
            # ставку списало устройство игрока, оно её и вернёт: сервер звёзд не выдаёт (иначе выход печатал бы деньги)
            return {"ok": True, "value": me["value"]}

        if p == ["feed"] and method == "GET":
            online = (G["q1"]("SELECT COUNT(*) n FROM users WHERE seen>?", int(time.time()) - 180) or {}).get("n", 0)
            return {"feed": feed[:30], "online": online,
                    "crash": {"phase": crash.get("phase"), "players": len(crash.get("bets", {}))},
                    "arena": {"phase": arena.get("phase"), "players": len(arena.get("players", []))}}
        if p == ["feed"] and method == "POST":     # выигрыш в одиночных режимах: апгрейд, серия, контракт, яйцо
            G["limit"](uid, "feed", 12, 60)
            mode = body.get("mode")
            if mode not in ("classic", "streak", "contract", "egg"):
                raise err(400, "bad mode")
            value, mult = body.get("value"), body.get("mult") or 0
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 1 <= value <= 10 ** 7:
                raise err(400, "bad value")
            if isinstance(mult, bool) or not isinstance(mult, (int, float)) or not math.isfinite(mult) or not 0 <= mult <= 10000:
                raise err(400, "bad mult")
            gift = (clean_gifts([body.get("gift")]) or [None])[0]
            if gift and not catalog.parse(gift):
                gift = None
            to_feed(uid, mode, int(value), float(mult) or None, gift)
            return {"ok": True}
    raise err(404, "not found")
