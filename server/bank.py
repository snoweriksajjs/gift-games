"""Кошелёк игрока на сервере: баланс, подарки, стейкинг и розыгрыш раундов.

Раньше всё это жило на устройстве игрока, и сервер верил тому, что присылал телефон.
Теперь деньги ведёт только сервер: телефон просит «сыграть», сервер списывает ставку, разыгрывает раунд,
зачисляет выигрыш и возвращает новое состояние. Анимация на телефоне только показывает уже записанный итог.

Честность одиночных режимов: перед раундом игрок видит отпечаток sha256 секретного числа сервера,
после раунда число раскрывается и сразу готовится следующее. Итог = HMAC-SHA256(секрет, «сид игрока:номер»),
первые 8 знаков, делённые на 2^32 (та же формула, что проверяет окно «Честная игра»).

Старые игроки один раз переносят состояние с телефона (решение владельца: всё как есть).
"""
import hashlib, hmac, json, math, secrets, sys, time

import catalog

G = {}
MAX_CHANCE, MIN_CHANCE = 0.8, 0.01          # Апгрейд
STREAK_MAX = 10                             # Серия: не больше 10 побед (×1024)
LO, HI = 0.3, 3                             # Контракт и платное яйцо: множитель от ×0,3 до ×3
EGG_TIERS = {"common": 250, "rare": 1000, "epic": 5000, "legend": 25000}
STAKE_PLANS = {7: 0.005, 14: 0.012, 30: 0.03}
DAY = 86400
TASKS = {   # встроенные задания: награда и проверка по серверной статистике
    "daily": (25, None), "first": (50, lambda s, n, r: s.get("spins", 0) >= 1), "spins10": (150, lambda s, n, r: s.get("spins", 0) >= 10),
    "wins3": (200, lambda s, n, r: s.get("wins", 0) >= 3), "low": (300, lambda s, n, r: s.get("lowWins", 0) >= 1),
    "streak3": (300, lambda s, n, r: s.get("bestStreak", 0) >= 3), "crash3": (250, lambda s, n, r: s.get("bestCrash", 0) >= 3),
    "contract": (150, lambda s, n, r: s.get("contracts", 0) >= 1), "arena": (250, lambda s, n, r: s.get("arenaWins", 0) >= 1),
    "eggs3": (150, lambda s, n, r: s.get("eggs", 0) >= 3), "inv3": (150, lambda s, n, r: n >= 3),
    "spins50": (500, lambda s, n, r: s.get("spins", 0) >= 50), "friend": (None, lambda s, n, r: r >= 1),
}


def bind(g):
    G.update(g)
    G["db"].executescript("""
    CREATE TABLE IF NOT EXISTS wallets (user INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, stats TEXT, wager TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS inventory (uid INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, gift TEXT, stake TEXT, created INTEGER);
    CREATE INDEX IF NOT EXISTS inventory_user ON inventory (user);
    CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, delta INTEGER, reason TEXT, at INTEGER);
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger (user, id);
    CREATE TABLE IF NOT EXISTS fair (user INTEGER PRIMARY KEY, server_seed TEXT, client_seed TEXT, nonce INTEGER);
    CREATE TABLE IF NOT EXISTS imports (user INTEGER PRIMARY KEY, raw TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS claims (user INTEGER, task TEXT, day TEXT, PRIMARY KEY (user, task));
    CREATE TABLE IF NOT EXISTS daily (user INTEGER, what TEXT, day TEXT, PRIMARY KEY (user, what));
    """)


class tx:
    """Всё внутри выполняется целиком или не выполняется: ставка не спишется, если раунд не состоялся."""
    def __enter__(self):
        G["lock"].acquire()
        G["db"].execute("BEGIN IMMEDIATE")

    def __exit__(self, et, ev, tb):
        try:
            G["db"].execute("ROLLBACK" if et else "COMMIT")
        finally:
            G["lock"].release()
        return False


def charge(uid, body, lo, hi):
    """Ставка в онлайн-режиме: списывается с серверного кошелька. Возвращает сумму и что именно списали."""
    with tx():
        need(uid)
        uids = body.get("uids") or []
        gifts = [q1("SELECT gift FROM inventory WHERE uid=? AND user=? AND stake IS NULL", u, uid) for u in uids] if isinstance(uids, list) else []
        value = take_stake(uid, body)
        if not lo <= value <= hi:
            raise err(400, "bad bet")
        return value, int(body.get("stars") or 0), [g["gift"] for g in gifts if g]


def refund(uid, stars, gifts, reason):
    with tx():
        move(uid, stars, reason)
        for gid in gifts:
            add_gift(uid, gid, reason)
        bump(uid, spins=-1)


def claim_grant(uid, gid, now):
    """Забрать выдачу: отметка и зачисление в кошелёк одной транзакцией."""
    with tx():
        need(uid)
        if ex("UPDATE grants SET claimed=? WHERE id=? AND user=? AND claimed IS NULL AND hold IS NULL", now, gid, uid).rowcount != 1:
            raise err(409, "claimed")
        g = q1("SELECT id, kind, amount, gift, wager, note FROM grants WHERE id=?", gid)
        g["result"] = credit_grant(uid, g)
        g["state"] = state(uid)
        return g


def err(code, text):
    return G["HttpError"](code, text)


def q1(sql, *a):
    r = G["db"].execute(sql, a).fetchone()
    return dict(r) if r else None


def ex(sql, *a):
    return G["db"].execute(sql, a)


def msk_day(t=None):
    return time.strftime("%Y-%m-%d", time.gmtime((t or time.time()) + 3 * 3600))


def rtp(uid, mode):
    a = G["admin"]
    return a.effective_rtp(a.settings(), a.personal_rtp(uid))[1][mode]


def as_int(v, lo, hi, name="bad number"):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v != int(v) or not lo <= v <= hi:
        raise err(400, name)
    return int(v)


# ---------- состояние ----------
def wallet(uid):
    return q1("SELECT * FROM wallets WHERE user=?", uid)


def need(uid):
    w = wallet(uid)
    if not w:
        raise err(428, "import first")       # сначала перенос с телефона
    return w


def stats_of(w):
    return json.loads(w["stats"] or "{}")


def bump(uid, **kw):
    """Статистика для заданий: счётчики складываются, best* берут максимум."""
    w = wallet(uid)
    s = stats_of(w)
    for k, v in kw.items():
        s[k] = max(s.get(k, 0), v) if k.startswith("best") else s.get(k, 0) + v
    ex("UPDATE wallets SET stats=? WHERE user=?", json.dumps(s), uid)


def fair_row(uid):
    f = q1("SELECT * FROM fair WHERE user=?", uid)
    if not f:
        f = {"user": uid, "server_seed": secrets.token_hex(32), "client_seed": secrets.token_hex(8), "nonce": 0}
        ex("INSERT INTO fair (user, server_seed, client_seed, nonce) VALUES (?, ?, ?, ?)", uid, f["server_seed"], f["client_seed"], 0)
    return f


def state(uid):
    w = need(uid)
    inv = [{"uid": r["uid"], "id": r["gift"], **({"stake": json.loads(r["stake"])} if r["stake"] else {})}
           for r in G["db"].execute("SELECT uid, gift, stake FROM inventory WHERE user=? ORDER BY uid", (uid,)).fetchall()]
    f = fair_row(uid)
    return {"balance": w["balance"], "inv": inv, "stats": stats_of(w), "wager": json.loads(w["wager"] or "null"),
            "fair": {"hash": hashlib.sha256(f["server_seed"].encode()).hexdigest(), "clientSeed": f["client_seed"], "nonce": f["nonce"]},
            "claimed": {r["task"]: r["day"] for r in G["db"].execute("SELECT task, day FROM claims WHERE user=?", (uid,)).fetchall()},
            "freeEgg": (q1("SELECT day FROM daily WHERE user=? AND what='free_egg'", uid) or {}).get("day")}


def move(uid, delta, reason):
    """Изменить баланс. Минус проверяется: баланс не уходит ниже нуля."""
    if delta < 0:
        if ex("UPDATE wallets SET balance=balance+? WHERE user=? AND balance>=?", delta, uid, -delta).rowcount != 1:
            raise err(402, "not enough stars")
    elif delta:
        ex("UPDATE wallets SET balance=balance+? WHERE user=?", delta, uid)
    if delta:
        ex("INSERT INTO ledger (user, delta, reason, at) VALUES (?, ?, ?, ?)", uid, delta, reason, int(time.time()))


def add_gift(uid, gid, reason):
    cur = ex("INSERT INTO inventory (user, gift, created) VALUES (?, ?, ?)", uid, gid, int(time.time()))
    ex("INSERT INTO ledger (user, delta, reason, at) VALUES (?, 0, ?, ?)", uid, f"+{gid} {reason}", int(time.time()))
    return cur.lastrowid


def take_stake(uid, body, gifts_only=False):
    """Списать ставку: звёзды и подарки (свои и не в стейкинге). Возвращает сумму ставки."""
    stars = 0 if gifts_only else as_int(body.get("stars") or 0, 0, 10 ** 12, "bad stars")
    uids = body.get("uids") or []
    if not isinstance(uids, list) or len(uids) > 50 or len(set(uids)) != len(uids):
        raise err(400, "bad gifts")
    value = stars
    for u in uids:
        r = q1("SELECT gift, stake FROM inventory WHERE uid=? AND user=?", as_int(u, 1, 10 ** 12, "bad gifts"), uid)
        if not r or r["stake"]:
            raise err(409, "gift not yours")
        value += catalog.get(r["gift"])["price"]
    if value <= 0:
        raise err(400, "empty bet")
    move(uid, -stars, "ставка")
    for u in uids:
        ex("DELETE FROM inventory WHERE uid=? AND user=?", u, uid)
    w = wallet(uid)
    wg = json.loads(w["wager"] or "null")
    if wg and wg.get("need", 0) > wg.get("done", 0):
        wg["done"] = wg.get("done", 0) + value
        ex("UPDATE wallets SET wager=? WHERE user=?", json.dumps(wg), uid)
    bump(uid, spins=1, wagered=value)
    return value


def pay(uid, value, reason, free=False):
    """Выигрыш: самый дорогой подарок по сумме и остаток звёздами."""
    value = int(math.floor(value))
    nft = sys.modules.get("nft")
    hit = nft.prize_from_stock(uid, value) if nft else None    # настоящий подарок из запаса: его можно вывести в Telegram
    if hit:
        g, guid = hit
    else:
        g = catalog.best(value) if value > 0 else None
        guid = add_gift(uid, g["id"], reason) if g else None
    stars = value - (g["price"] if g else 0)
    move(uid, stars, reason)
    if not free:
        bump(uid, won=value)
    return {"gift": g["id"] if g else None, "uid": guid, "stars": stars, "value": value}


def next_round(uid):
    """Число раунда из секрета сервера и сида игрока. Секрет раскрывается, следующий готовится сразу."""
    f = fair_row(uid)
    h = hmac.new(f["server_seed"].encode(), f"{f['client_seed']}:{f['nonce']}".encode(), hashlib.sha256).hexdigest()
    rnd = {"serverSeed": f["server_seed"], "hash": hashlib.sha256(f["server_seed"].encode()).hexdigest(),
           "clientSeed": f["client_seed"], "nonce": f["nonce"], "roll": int(h[:8], 16) / 4294967296}
    ex("UPDATE fair SET server_seed=?, nonce=nonce+1 WHERE user=?", secrets.token_hex(32), uid)
    return rnd


def range_mult(roll, r, lo, hi):
    base = max(r, lo + 0.01)
    k = (hi - lo) / (base - lo) - 1
    m = lo + (hi - lo) * roll ** k
    return m if r >= lo + 0.01 else m * (r / base)


def streak_chance(H):
    def ev(P):
        return sum(P ** k * (1 - P) * 2 ** k for k in range(1, STREAK_MAX)) + P ** STREAK_MAX * 2 ** STREAK_MAX
    lo, hi = 0.0, 0.5
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if ev(mid) < H else (lo, mid)
    return lo


# ---------- режимы ----------
def play_classic(uid, body):
    t = catalog.get(body.get("target"))
    if not t:
        raise err(400, "bad target")
    value = take_stake(uid, body)
    if t["price"] <= value:
        raise err(400, "target too cheap")
    ch = min(MAX_CHANCE, value / t["price"] * rtp(uid, "classic"))
    if ch < MIN_CHANCE:
        raise err(400, "chance too low")
    rnd = next_round(uid)
    win = rnd["roll"] < ch
    out = {"round": rnd, "chance": ch, "win": win, "bet": value}
    if win:
        out["uid"] = add_gift(uid, t["id"], "апгрейд")
        if sys.modules.get("nft"):
            sys.modules["nft"].reserve(out["uid"], t["id"])
        bump(uid, wins=1, won=t["price"], **({"lowWins": 1} if ch < 0.25 else {}))
    return out


def play_streak(uid, body):
    value = take_stake(uid, body)
    P = streak_chance(rtp(uid, "streak"))
    rounds = []
    for _ in range(STREAK_MAX):
        r = next_round(uid)
        rounds.append(r)
        if r["roll"] >= P:
            break
    wins = sum(1 for r in rounds if r["roll"] < P)
    out = {"rounds": rounds, "chance": P, "wins": wins, "bet": value}
    bump(uid, bestStreak=wins)
    if wins:
        out["prize"] = pay(uid, value * 2 ** wins, f"серия {wins}")
        bump(uid, wins=1)
    return out


def play_contract(uid, body):
    if not 3 <= len(body.get("uids") or []) <= 10:
        raise err(400, "3 to 10 gifts")
    value = take_stake(uid, body, gifts_only=True)
    rnd = next_round(uid)
    m = range_mult(rnd["roll"], rtp(uid, "contract"), LO, HI)
    prize = pay(uid, value * m, "контракт")
    bump(uid, contracts=1, **({"wins": 1} if m >= 1 else {}))
    return {"round": rnd, "mult": m, "bet": value, "prize": prize}


def play_egg(uid, body):
    tier = body.get("tier")
    if tier == "free":
        if not G["admin"].settings().get("free_egg", True):
            raise err(423, "free egg off")
        day = msk_day()
        if ex("INSERT OR IGNORE INTO daily (user, what, day) VALUES (?, 'free_egg', ?)", uid, day).rowcount != 1 and \
                ex("UPDATE daily SET day=? WHERE user=? AND what='free_egg' AND day<>?", day, uid, day).rowcount != 1:
            raise err(409, "free egg used")
        rnd = next_round(uid)
        value = round(30 + 270 * rnd["roll"] ** 3)
        prize = pay(uid, value, "бесплатное яйцо", free=True)
        bump(uid, eggs=1)
        return {"round": rnd, "mult": 1, "bet": 0, "prize": prize, "free": True}
    price = EGG_TIERS.get(tier)
    if not price:
        raise err(400, "bad tier")
    take_stake(uid, {"stars": price})
    rnd = next_round(uid)
    m = range_mult(rnd["roll"], rtp(uid, "egg"), LO, HI)
    prize = pay(uid, price * m, "яйцо")
    bump(uid, eggs=1, **({"wins": 1} if m >= 1 else {}))
    return {"round": rnd, "mult": m, "bet": price, "prize": prize}


# ---------- прочее ----------
def sell(uid, body):
    uids = body.get("uids") or []
    if not isinstance(uids, list) or not uids or len(uids) > 500:
        raise err(400, "bad gifts")
    total = 0
    for u in uids:
        r = q1("SELECT gift, stake FROM inventory WHERE uid=? AND user=?", as_int(u, 1, 10 ** 12, "bad gifts"), uid)
        if not r or r["stake"]:
            continue
        ex("DELETE FROM inventory WHERE uid=? AND user=?", u, uid)
        total += catalog.get(r["gift"])["price"]
    move(uid, total, "продажа")
    return {"sold": total}


def stake(uid, body):
    u = as_int(body.get("uid"), 1, 10 ** 12, "bad gift")
    days = as_int(body.get("days"), 1, 30, "bad plan")
    if days not in STAKE_PLANS:
        raise err(400, "bad plan")
    r = q1("SELECT gift, stake FROM inventory WHERE uid=? AND user=?", u, uid)
    if not r or r["stake"]:
        raise err(409, "gift not yours")
    now = int(time.time() * 1000)
    reward = max(1, math.floor(catalog.get(r["gift"])["price"] * STAKE_PLANS[days] + 0.5))
    k = {"from": now, "until": now + days * DAY * 1000, "days": days, "reward": reward}
    ex("UPDATE inventory SET stake=? WHERE uid=?", json.dumps(k), u)
    return {"stake": k}


def unstake(uid, body):
    u = as_int(body.get("uid"), 1, 10 ** 12, "bad gift")
    r = q1("SELECT stake FROM inventory WHERE uid=? AND user=?", u, uid)
    if not r or not r["stake"]:
        raise err(409, "not staked")
    k = json.loads(r["stake"])
    done = time.time() * 1000 >= k["until"]
    ex("UPDATE inventory SET stake=NULL WHERE uid=?", u)
    if done:
        move(uid, k["reward"], "стейкинг")
    return {"reward": k["reward"] if done else 0}


def task(uid, body):
    tid = body.get("id")
    if tid not in TASKS:
        raise err(400, "bad task")
    reward, check = TASKS[tid]
    w = need(uid)
    refs = (q1("SELECT COUNT(*) n FROM grants WHERE user=? AND note LIKE 'За приглашённого друга%'", uid) or {}).get("n", 0)
    n = (q1("SELECT COUNT(*) n FROM inventory WHERE user=?", uid) or {}).get("n", 0)
    if check and not check(stats_of(w), n, refs):
        raise err(412, "not done")
    if reward is None:
        reward = int(G["admin"].settings().get("ref_bonus") or 100)
    day = msk_day() if tid == "daily" else "once"
    if tid == "daily":
        ok = ex("INSERT OR IGNORE INTO claims (user, task, day) VALUES (?, ?, ?)", uid, tid, day).rowcount == 1 or \
            ex("UPDATE claims SET day=? WHERE user=? AND task=? AND day<>?", day, uid, tid, day).rowcount == 1
    else:
        ok = ex("INSERT OR IGNORE INTO claims (user, task, day) VALUES (?, ?, ?)", uid, tid, day).rowcount == 1
    if not ok:
        raise err(409, "claimed")
    move(uid, reward, f"задание {tid}")
    return {"reward": reward}


def credit_grant(uid, g):
    """Выдача (админ, выигрыш онлайн-режима, оплата, друг, промокод) зачисляется в кошелёк."""
    kind, amount = g["kind"], int(g["amount"] or 0)
    out = {}
    if kind == "win":
        out = pay(uid, amount, g.get("note") or "выигрыш")
        bump(uid, wins=1)
    elif kind in ("add", "stars", "pay"):
        move(uid, max(amount, -(wallet(uid)["balance"])), g.get("note") or kind)
    elif kind == "set":
        move(uid, max(0, amount) - wallet(uid)["balance"], "админ: баланс")
    elif kind == "gift" and catalog.get(g.get("gift")):
        out = {"uid": add_gift(uid, g["gift"], g.get("note") or "выдача")}
    if g.get("wager") and amount > 0:
        w = wallet(uid)
        wg = json.loads(w["wager"] or "null") or {"need": 0, "done": 0}
        wg["need"] = wg.get("need", 0) + amount * float(g["wager"])
        ex("UPDATE wallets SET wager=? WHERE user=?", json.dumps(wg), uid)
    return out


def do_import(uid, body):
    """Перенос с телефона, один раз: баланс, подарки, стейкинг, отыгрыш (решение владельца: всё как есть)."""
    if wallet(uid):
        raise err(409, "already imported")
    bal = body.get("balance") or 0
    bal = int(bal) if isinstance(bal, (int, float)) and not isinstance(bal, bool) and math.isfinite(bal) and bal > 0 else 0
    bal = min(bal, 10 ** 12)
    now = int(time.time())
    ex("INSERT INTO wallets (user, balance, stats, wager, created) VALUES (?, ?, ?, ?, ?)", uid, bal,
       json.dumps({k: v for k, v in (body.get("stats") or {}).items() if isinstance(v, (int, float)) and math.isfinite(v)} if isinstance(body.get("stats"), dict) else {}),
       json.dumps(body.get("wager")) if isinstance(body.get("wager"), dict) else None, now)
    inv = body.get("inv") if isinstance(body.get("inv"), list) else []
    for it in inv[:3000]:
        gid = it.get("id") if isinstance(it, dict) else None
        if not catalog.get(gid):
            continue
        k = it.get("stake") if isinstance(it.get("stake"), dict) else None
        if k:      # стейкинг не дольше 30 дней от сегодня: часы на телефоне могли быть переведены
            k = {"from": int(k.get("from") or now * 1000), "until": min(int(k.get("until") or 0), (now + 30 * DAY) * 1000),
                 "days": int(k.get("days") or 7), "reward": max(0, min(int(k.get("reward") or 0), 10 ** 9))}
        ex("INSERT INTO inventory (user, gift, stake, created) VALUES (?, ?, ?, ?)", uid, gid, json.dumps(k) if k else None, now)
    claimed = body.get("claimed") if isinstance(body.get("claimed"), dict) else {}
    for t, d in claimed.items():
        if t in TASKS and t != "daily":
            ex("INSERT OR IGNORE INTO claims (user, task, day) VALUES (?, ?, 'once')", uid, t)
    if isinstance(body.get("freeEgg"), str):
        ex("INSERT OR IGNORE INTO daily (user, what, day) VALUES (?, 'free_egg', ?)", uid, body["freeEgg"][:10])
    if isinstance(body.get("clientSeed"), str) and body["clientSeed"].strip():
        fair_row(uid)
        ex("UPDATE fair SET client_seed=? WHERE user=?", body["clientSeed"].strip()[:64], uid)
    ex("INSERT INTO imports (user, raw, at) VALUES (?, ?, ?)", uid, json.dumps(body)[:200000], now)
    ex("INSERT INTO ledger (user, delta, reason, at) VALUES (?, ?, 'перенос с телефона', ?)", uid, bal, now)


def handle(method, p, uid, body, query, now):
    if not p or p[0] != "w":
        return None
    a = p[1:]
    with G["lock"]:
        if a == ["state"] and method == "GET":
            if not wallet(uid):
                return {"need_import": True}
            return state(uid)
        if method != "POST":
            raise err(404, "not found")
        if a == ["import"]:
            with tx():
                do_import(uid, body)
            if sys.modules.get("nft"):
                sys.modules["nft"].credit_user(uid)
            return state(uid)
        G["limit"](uid, "bank", 40, 10)
        if a == ["seed"]:
            need(uid)
            s = str(body.get("clientSeed") or "").strip()[:64]
            if not s:
                raise err(400, "bad seed")
            fair_row(uid)
            ex("UPDATE fair SET client_seed=? WHERE user=?", s, uid)
            return state(uid)
        fn = {("play", "classic"): play_classic, ("play", "streak"): play_streak, ("play", "contract"): play_contract,
              ("play", "egg"): play_egg, ("sell",): sell, ("stake",): stake, ("unstake",): unstake, ("task",): task}.get(tuple(a))
        if not fn:
            raise err(404, "not found")
        with tx():
            need(uid)
            out = fn(uid, body)
            out["state"] = state(uid)
            G["db"].execute("UPDATE users SET balance=? WHERE id=?", (out["state"]["balance"], uid))
        if a[0] == "play" and not out.get("free"):
            G["admin"].ref_activate(uid)
        return out
