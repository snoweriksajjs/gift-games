"""Админка DuckChance на сервере: настройки игры, промокоды, задания, выдачи игрокам, статистика и рассылка.

Подключается из app.py: admin.bind(globals()), затем admin.handle(...) в начале обработки каждого запроса.
Баланс и подарки живут на устройстве игрока, поэтому изменения доходят до него «выдачами»:
сервер ставит выдачу в очередь, приложение забирает её при следующей синхронизации (каждую ровно один раз).
"""
import json, os, random, re, string, sys, threading, time

G = {}           # общие функции и константы из app.py
ADMINS = set(int(x) for x in os.environ.get("ADMIN_IDS", "8083284748").split(",") if x.strip().isdigit())

DEFAULTS = {
    "rtp": 0.95,                 # доля ставок, которая в среднем возвращается игрокам
    "modes": {},                 # своя доля для режима: {"crash": 0.93}
    "deposits": True,            # пополнение звёздами
    "free_egg": True,            # бесплатное яйцо раз в день
    "ref_bonus": 100,            # звёзд за приглашённого друга
    "maintenance": False,        # технические работы: приложение закрыто для всех, кроме админов
    "maint_text": "Идут технические работы. Скоро вернёмся.",
    "withdraw_note": "Вывод подарков скоро",
    "market_prices": True,       # брать цены подарков с рынка (Fragment)
    "star_usd": 0.015,           # сколько долларов стоит одна звезда при пересчёте цен
    "max_bet": 100000,           # самая большая ставка в Краше и на Арене
    "hold_over": 50000,          # выигрыш в онлайн-режимах больше этой суммы ждёт подтверждения админа
    "transfers": True,           # передача подарков между игроками
    "transfers_day": 10,         # сколько подарков игрок может передать за сутки
}
PRICES_URL = os.environ.get("PRICES_URL", "https://atlannn.github.io/telegram-gifts-floor-price/api/v1/latest.json")
PRICES_EVERY = 3 * 3600
MODES = ["classic", "streak", "contract", "arena", "crash", "egg"]


def bind(g):
    G.update(g)
    db = g["db"]
    db.executescript("""
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS promos (code TEXT PRIMARY KEY COLLATE NOCASE, kind TEXT, amount INTEGER, gift TEXT,
      uses_max INTEGER, uses INTEGER DEFAULT 0, wager REAL DEFAULT 0, expires INTEGER, created INTEGER, active INTEGER DEFAULT 1, note TEXT);
    CREATE TABLE IF NOT EXISTS promo_uses (code TEXT COLLATE NOCASE, user INTEGER, at INTEGER, PRIMARY KEY (code, user));
    CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, kind TEXT, target TEXT, reward INTEGER,
      active INTEGER DEFAULT 1, created INTEGER);
    CREATE TABLE IF NOT EXISTS task_done (task INTEGER, user INTEGER, at INTEGER, PRIMARY KEY (task, user));
    CREATE TABLE IF NOT EXISTS grants (id INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, kind TEXT, amount INTEGER, gift TEXT,
      wager REAL DEFAULT 0, note TEXT, created INTEGER, claimed INTEGER);
    CREATE INDEX IF NOT EXISTS grants_user ON grants (user, claimed);
    CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin INTEGER, action TEXT, data TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS payments (charge TEXT PRIMARY KEY, user INTEGER, stars INTEGER, payload TEXT, at INTEGER);
    """)
    g["add_column"]("users", "banned", "INTEGER")
    g["add_column"]("users", "rtp", "TEXT")
    g["add_column"]("users", "wagered", "INTEGER")   # всего поставлено (с устройства игрока)
    g["add_column"]("users", "won", "INTEGER")       # всего выиграно, без бесплатных яиц
    g["add_column"]("grants", "hold", "INTEGER")     # 1: крупный выигрыш ждёт проверки админом, игрок его пока не получает
    threading.Thread(target=prices_loop, daemon=True).start()
    threading.Thread(target=backup_loop, daemon=True).start()          # личные шансы игрока: {"all": 0.9, "modes": {"crash": 0.8}}


q = lambda *a: G["q"](*a)
q1 = lambda *a: G["q1"](*a)
run = lambda *a: G["run"](*a)


def err(code, text):
    return G["HttpError"](code, text)


def record_payment(uid, stars, payload, charge):
    """Оплата звёздами: запись в базу и выдача на баланс. Начисляет сервер, а не окно оплаты,
    поэтому звёзды не пропадут, даже если приложение закрылось сразу после оплаты. Повтор той же оплаты не начисляется."""
    with G["lock"]:
        new = G["db"].execute("INSERT OR IGNORE INTO payments (charge, user, stars, payload, at) VALUES (?, ?, ?, ?, ?)",
                              (charge, uid, int(stars), payload, int(time.time()))).rowcount == 1
        if new:
            G["db"].execute("INSERT INTO grants (user, kind, amount, gift, wager, note, created) VALUES (?, 'pay', ?, NULL, 0, ?, ?)",
                            (uid, int(stars), "Пополнение", int(time.time())))
    return new


BACKUP_DIR = os.environ.get("BACKUP_DIR") or os.path.join(os.path.dirname(os.path.abspath(os.environ.get("DB", "duckchance.db"))), "backups")


def backup_loop():
    """Копия базы каждый час (24 штуки по кругу) и раз в сутки (7 штук по кругу)."""
    import sqlite3
    while True:
        time.sleep(3600)
        try:
            os.makedirs(BACKUP_DIR, exist_ok=True)
            t = time.gmtime()
            for name in (f"hour-{t.tm_hour:02d}.db", f"day-{t.tm_wday}.db") if t.tm_hour == 0 else (f"hour-{t.tm_hour:02d}.db",):
                dst = sqlite3.connect(os.path.join(BACKUP_DIR, name))
                with G["lock"]:
                    G["db"].backup(dst)
                dst.close()
        except Exception as e:
            print("Бэкап не удался:", repr(e), flush=True)


def settings():
    s = dict(DEFAULTS)
    for r in q("SELECT key, value FROM settings"):
        try:
            s[r["key"]] = json.loads(r["value"])
        except ValueError:
            pass
    return s


# ---------- рыночные цены подарков ----------
# Открытый датасет минимальных цен коллекций на Fragment (обновляется раз в день): цены в GRAM и долларах.
# Переводим в звёзды по курсу star_usd. Внутри коллекции сохраняем соотношение моделей из каталога (не больше ×3).
def _slug(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def refresh_prices():
    """Минимальные цены коллекций с Fragment, в звёздах по курсу star_usd. Цена подарка = минимум коллекции × редкость."""
    import urllib.request, catalog
    s = settings()
    req = urllib.request.Request(PRICES_URL, headers={"User-Agent": "DuckChance-bot"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    floors_src = dict(data.get("floors") or [])
    star = float(s.get("star_usd") or 0.015)
    floors = {}
    for name in catalog.base_floors():
        f = floors_src.get(_slug(name))
        if f and f.get("floor_usd"):
            floors[name] = max(1, int(round(f["floor_usd"] / star)))
    if not floors:
        raise RuntimeError("no prices")
    for k, v in (("floors", floors), ("prices_date", data.get("date") or ""), ("prices_at", int(time.time()))):
        run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, json.dumps(v))
    apply_prices(floors)
    print(f"Цены коллекций обновлены: {len(floors)}, данные за {data.get('date')}", flush=True)
    return {"count": len(floors), "date": data.get("date")}


def apply_prices(floors):
    """Цены для сервера: баннеры профиля и подписи в боте."""
    try:
        import catalog
        catalog.catalog()
        catalog.set_floors(floors if settings().get("market_prices", True) else {})
    except Exception as e:
        print("Цены не применились:", e, flush=True)


def prices_loop():
    time.sleep(5)
    s = settings()
    if isinstance(s.get("floors"), dict):
        apply_prices(s["floors"])
    while True:
        try:
            s = settings()
            if s.get("market_prices", True) and time.time() - int(s.get("prices_at") or 0) > PRICES_EVERY - 60:
                refresh_prices()
        except Exception as e:
            print("Цены подарков не обновились:", e, flush=True)
        time.sleep(600)


def log(admin, action, data):
    run("INSERT INTO admin_log (admin, action, data, at) VALUES (?, ?, ?, ?)", admin, action, json.dumps(data, ensure_ascii=False)[:2000], int(time.time()))


def personal_rtp(uid):
    r = q1("SELECT rtp FROM users WHERE id=?", uid)
    try:
        return json.loads(r["rtp"]) if r and r.get("rtp") else None
    except ValueError:
        return None


def first(*vals):
    """Первое заданное значение; 0 тоже считается заданным."""
    for v in vals:
        if v is not None:
            return v
    return None


def effective_rtp(s, mine):
    """Шанс по режимам: личный режим, потом личный общий, потом режим для всех, потом общий."""
    mine = mine or {}
    out = {}
    for m in MODES:
        out[m] = first((mine.get("modes") or {}).get(m), mine.get("all"), (s.get("modes") or {}).get(m), s["rtp"])
    return first(mine.get("all"), s["rtp"]), out


def public_config(uid):
    s = settings()
    base, modes = effective_rtp(s, personal_rtp(uid))
    tasks = q("SELECT id, title, kind, target, reward FROM tasks WHERE active=1 ORDER BY id")
    done = {r["task"] for r in q("SELECT task FROM task_done WHERE user=?", uid)}
    for t in tasks:
        t["done"] = t["id"] in done
    floors = s.get("floors") if s.get("market_prices", True) and isinstance(s.get("floors"), dict) else None
    return {"floors": floors, "prices_date": s.get("prices_date") if floors else "",
            "rtp": base, "modes": modes, "deposits": s["deposits"], "free_egg": s["free_egg"], "ref_bonus": s["ref_bonus"],
            "max_bet": s["max_bet"], "transfers": s["transfers"],
            "maintenance": s["maintenance"] and uid not in ADMINS, "maint_text": s["maint_text"], "withdraw_note": s["withdraw_note"],
            "tasks": tasks, "admin": uid in ADMINS}


def gift_ok(g):
    """Номер подарка из каталога (не просто похожий на номер)."""
    import catalog
    return isinstance(g, str) and bool(G["GIFT_ID"].match(g)) and catalog.parse(g) is not None


def num(v, lo, hi, default=0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


# ---------- статистика ----------
def stats():
    now = int(time.time())
    one = lambda sql, *a: (q1(sql, *a) or {}).get("n") or 0
    pay = q1("SELECT COUNT(*) n, COALESCE(SUM(stars),0) s FROM payments") or {}
    pay_n, pay_sum = pay.get("n") or 0, pay.get("s") or 0
    pay_day = (q1("SELECT COALESCE(SUM(stars),0) s FROM payments WHERE at>?", now - 86400) or {}).get("s") or 0
    bp = sys.modules.get("bot_poller")
    return {
        "users": one("SELECT COUNT(*) n FROM users"),
        "new_day": one("SELECT COUNT(*) n FROM users WHERE created>?", now - 86400),
        "new_week": one("SELECT COUNT(*) n FROM users WHERE created>?", now - 7 * 86400), "active_day": one("SELECT COUNT(*) n FROM users WHERE seen>?", now - 86400),
        "active_week": one("SELECT COUNT(*) n FROM users WHERE seen>?", now - 7 * 86400),
        "online": one("SELECT COUNT(*) n FROM users WHERE seen>?", now - 300),
        "bot_users": len(bp.state["subs"]) if bp else 0,
        "payments": pay_n, "paid_stars": pay_sum, "paid_day": pay_day,
        "balances": one("SELECT COALESCE(SUM(balance),0) n FROM users"),
        "banned": one("SELECT COUNT(*) n FROM users WHERE banned=1"),
        "held": one("SELECT COUNT(*) n FROM grants WHERE hold=1 AND claimed IS NULL"),
        "chats": one("SELECT COUNT(*) n FROM chats WHERE kind='group'"), "channels": one("SELECT COUNT(*) n FROM chats WHERE kind='channel'"),
        "dms": one("SELECT COUNT(*) n FROM chats WHERE kind='dm'"), "messages": one("SELECT COUNT(*) n FROM messages"),
        "transfers": one("SELECT COUNT(*) n FROM transfers"), "promo_uses": one("SELECT COUNT(*) n FROM promo_uses"),
        "tasks_done": one("SELECT COUNT(*) n FROM task_done"),
        "top": [G["user_card"](r["id"]) | {"balance": r["balance"] or 0} for r in q("SELECT id, balance FROM users ORDER BY balance DESC LIMIT 5")],
    }


def user_full(uid):
    u = q1("SELECT * FROM users WHERE id=?", uid)
    if not u:
        raise err(404, "no user")
    card = G["user_card"](uid, True)
    mine = personal_rtp(uid)
    card["rtp"] = mine
    base, eff = effective_rtp(settings(), mine)
    card["rtp_effective"] = eff
    card["rtp_base"] = base
    card["wagered"] = u.get("wagered") or 0
    card["won"] = u.get("won") or 0
    card.update({"balance": u.get("balance") or 0, "staked": u.get("staked") or 0, "banned": bool(u.get("banned")),
                 "tg_username": u.get("username") or "",
                 "chats": (q1("SELECT COUNT(*) n FROM members WHERE user=?", uid) or {}).get("n", 0),
                 "messages": (q1("SELECT COUNT(*) n FROM messages WHERE user=?", uid) or {}).get("n", 0),
                 "grants": q("SELECT * FROM grants WHERE user=? ORDER BY id DESC LIMIT 20", uid),
                 "promos": q("SELECT code, at FROM promo_uses WHERE user=? ORDER BY at DESC LIMIT 20", uid)})
    return card


# ---------- рассылка ----------
def broadcast(admin, text, photo, button, test):
    bp = sys.modules.get("bot_poller")
    if not bp:
        raise err(503, "bot is off")
    markup = None
    if button == "play":
        markup = {"inline_keyboard": [[bp.app_btn("Играть", icon="fire", style="primary")]]}
    elif isinstance(button, dict) and button.get("text") and re.match(r"^https://", str(button.get("url", ""))):
        markup = {"inline_keyboard": [[{"text": str(button["text"])[:40], "url": str(button["url"])[:300]}]]}
    targets = [admin] if test else list(bp.state["subs"])
    threading.Thread(target=bp.broadcast_html, args=(admin, targets, text, photo, markup, test), daemon=True).start()
    return {"ok": True, "targets": len(targets)}


def gen_code():
    return "DUCK-" + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))


# ---------- обработчик ----------
def handle(method, p, uid, body, query, now):
    """Возвращает ответ, если путь наш, иначе None."""
    u = q1("SELECT banned FROM users WHERE id=?", uid)
    is_admin = uid in ADMINS
    if not is_admin and u and u.get("banned") and not (p == ["config"] or (p == ["me"] and method == "GET")):
        raise err(403, "banned")
    if not is_admin and method == "POST" and p != ["me"] and settings().get("maintenance"):
        raise err(503, "maintenance")

    if p == ["config"] and method == "GET":
        cfg = public_config(uid)
        cfg["banned"] = bool(u and u.get("banned"))
        return cfg

    # ---- промокод любого формата ----
    if p == ["promo"] and method == "POST":
        G["limit"](uid, "promo", 10, 600)
        code = G["clean"](body.get("code"), 40).strip().upper()     # регистр не важен, и для кириллицы тоже
        pr = q1("SELECT * FROM promos WHERE code=? COLLATE NOCASE", code)
        if not pr or not pr["active"]:
            raise err(404, "no promo")
        if pr["expires"] and now > pr["expires"]:
            raise err(410, "expired")
        if pr["uses_max"] and pr["uses"] >= pr["uses_max"]:
            raise err(410, "used up")
        import bank
        with bank.tx():
            bank.need(uid)
            if G["db"].execute("INSERT OR IGNORE INTO promo_uses (code, user, at) VALUES (?, ?, ?)", (pr["code"], uid, now)).rowcount != 1:
                raise err(409, "already used")
            if G["db"].execute("UPDATE promos SET uses=uses+1 WHERE code=? AND (uses_max IS NULL OR uses_max=0 OR uses<uses_max)", (pr["code"],)).rowcount != 1:
                raise err(410, "used up")
            r = {"kind": pr["kind"], "amount": pr["amount"] or 0, "gift": pr["gift"], "wager": pr["wager"] or 0, "note": "Промокод"}
            r["result"] = bank.credit_grant(uid, {**r, "kind": "add" if r["kind"] == "stars" else r["kind"]})
            r["state"] = bank.state(uid)
            return r

    # ---- задания: подписка проверяется через бота ----
    if p == ["task", "check"] and method == "POST":
        G["limit"](uid, "task", 20, 60)
        t = q1("SELECT * FROM tasks WHERE id=? AND active=1", int(body.get("id") or 0))
        if not t:
            raise err(404, "no task")
        if q1("SELECT 1 x FROM task_done WHERE task=? AND user=?", t["id"], uid):
            raise err(409, "done")
        if t["kind"] == "sub":
            chat = t["target"] if t["target"].startswith("@") or t["target"].lstrip("-").isdigit() else "@" + t["target"]
            try:
                r = G["tg_call"]("getChatMember", chat_id=chat, user_id=uid)
                status = r["result"]["status"]
            except Exception as e:
                print("Проверка подписки не удалась:", e, flush=True)
                raise err(424, "cannot check")
            if status not in ("member", "administrator", "creator", "restricted"):
                raise err(412, "not subscribed")
        import bank
        with bank.tx():
            bank.need(uid)
            if G["db"].execute("INSERT OR IGNORE INTO task_done (task, user, at) VALUES (?, ?, ?)", (t["id"], uid, now)).rowcount != 1:
                raise err(409, "done")
            bank.move(uid, int(t["reward"] or 0), f"задание {t['id']}")
            return {"reward": t["reward"], "state": bank.state(uid)}

    # ---- выдачи от админа ----
    if p == ["grants"] and method == "GET":
        return {"grants": q("SELECT id, kind, amount, gift, wager, note FROM grants WHERE user=? AND claimed IS NULL AND hold IS NULL ORDER BY id", uid)}
    if len(p) == 3 and p[:2] == ["grants", "claim"] and method == "POST":
        import bank
        return bank.claim_grant(uid, int(p[2]), now)

    if not p or p[0] != "admin":
        return None
    if uid not in ADMINS:
        raise err(403, "admins only")
    a = p[1:]

    if a == ["stats"]:
        return stats()

    # крупные выигрыши онлайн-режимов на проверке: выдать или отклонить
    if a == ["held"] and method == "GET":
        rows = q("SELECT id, user, amount, note, created FROM grants WHERE hold=1 AND claimed IS NULL ORDER BY id DESC LIMIT 100")
        return {"held": [r | {"player": G["user_card"](r["user"])} for r in rows]}
    if len(a) == 3 and a[0] == "held" and a[2] in ("release", "reject") and method == "POST":
        gid = int(a[1])
        if a[2] == "release":
            ok = G["db"].execute("UPDATE grants SET hold=NULL WHERE id=? AND hold=1 AND claimed IS NULL", (gid,)).rowcount == 1
        else:
            ok = G["db"].execute("UPDATE grants SET claimed=?, note=COALESCE(note,'') || ' (отклонено)' WHERE id=? AND hold=1 AND claimed IS NULL", (now, gid)).rowcount == 1
        if not ok:
            raise err(409, "already done")
        log(uid, "held_" + a[2], {"grant": gid})
        return {"ok": True}

    if a == ["users"] and method == "GET":
        s = G["clean"](query.get("q", [""])[0], 40).lstrip("@").lower()
        sort = {"seen": "seen DESC", "balance": "balance DESC", "new": "rowid DESC"}.get(query.get("sort", ["seen"])[0], "seen DESC")
        off = int(query.get("offset", ["0"])[0] or 0)
        if query.get("filter", [""])[0] == "rtp":          # только игроки со своими шансами
            rows = q(f"SELECT id FROM users WHERE rtp IS NOT NULL ORDER BY {sort} LIMIT 50 OFFSET ?", off)
        elif s:
            like = f"%{s}%"
            rows = q(f"SELECT id FROM users WHERE ulower(name) LIKE ? OR ulower(handle) LIKE ? OR ulower(username) LIKE ? OR CAST(id AS TEXT)=? ORDER BY {sort} LIMIT 50 OFFSET ?", like, like, like, s, off)
        else:
            rows = q(f"SELECT id FROM users ORDER BY {sort} LIMIT 50 OFFSET ?", off)
        out = []
        for r in rows:
            uu = q1("SELECT balance, banned, username, rtp, wagered, won FROM users WHERE id=?", r["id"])
            out.append(G["user_card"](r["id"]) | {"balance": uu["balance"] or 0, "banned": bool(uu["banned"]), "tg_username": uu["username"] or "",
                                                 "own_rtp": bool(uu["rtp"]), "wagered": uu["wagered"] or 0, "won": uu["won"] or 0})
        return {"users": out, "total": (q1("SELECT COUNT(*) n FROM users") or {}).get("n", 0)}

    if len(a) >= 2 and a[0] == "user":
        tid = int(a[1])
        if len(a) == 2 and method == "GET":
            return user_full(tid)
        if a[2:] == ["grant"] and method == "POST":
            kind = body.get("kind")
            if kind not in ("add", "set", "gift"):
                raise err(400, "bad kind")
            amount = int(num(body.get("amount"), -10**9, 10**9))
            gift = body.get("gift") if kind == "gift" else None
            if kind == "gift" and not gift_ok(gift):
                raise err(400, "bad gift")
            run("INSERT INTO grants (user, kind, amount, gift, wager, note, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                tid, kind, amount, gift, num(body.get("wager"), 0, 50), G["clean"](body.get("note"), 120), now)
            log(uid, "grant", {"user": tid, "kind": kind, "amount": amount, "gift": gift})
            return {"ok": True}
        if a[2:] == ["rtp"] and method == "POST":      # личные шансы игрока
            if body.get("reset"):
                run("UPDATE users SET rtp=NULL WHERE id=?", tid)
                log(uid, "rtp", {"user": tid, "reset": True})
                return {"ok": True, "rtp": None}
            mine = {}
            if body.get("all") is not None and body.get("all") != "":
                mine["all"] = round(num(body["all"], 0, 1, 0.95), 3)
            if isinstance(body.get("modes"), dict):
                mm = {m: round(num(v, 0, 1, 0.95), 3) for m, v in body["modes"].items() if m in MODES and v is not None and v != ""}
                if mm:
                    mine["modes"] = mm
            run("UPDATE users SET rtp=? WHERE id=?", json.dumps(mine) if mine else None, tid)
            log(uid, "rtp", {"user": tid, **mine})
            return {"ok": True, "rtp": mine or None}
        if a[2:] == ["verify"] and method == "POST":      # выдать или снять галочку
            run("UPDATE users SET verified=? WHERE id=?", 1 if body.get("on") else None, tid)
            log(uid, "verify", {"user": tid, "on": bool(body.get("on"))})
            return {"ok": True}
        if a[2:] == ["ban"] and method == "POST":
            if tid in ADMINS and body.get("on"):
                raise err(400, "cannot ban admin")
            run("UPDATE users SET banned=? WHERE id=?", 1 if body.get("on") else None, tid)
            log(uid, "ban", {"user": tid, "on": bool(body.get("on"))})
            return {"ok": True}
        if a[2:] == ["message"] and method == "POST":
            text = G["clean"](body.get("text"), 3500)
            if not text:
                raise err(400, "empty")
            bp = sys.modules.get("bot_poller")
            try:
                (bp.send if bp else None)(tid, text)
            except Exception as e:
                raise err(502, f"not delivered: {e}")
            return {"ok": True}

    if a == ["settings"] and method == "GET":
        return settings()
    if a == ["settings"] and method == "POST":
        s = settings()
        if "rtp" in body:
            s["rtp"] = round(num(body["rtp"], 0, 1, 0.95), 3)
        if isinstance(body.get("modes"), dict):
            s["modes"] = {m: round(num(v, 0, 1, 0.95), 3) for m, v in body["modes"].items() if m in MODES and v is not None and v != ""}
        for k in ("deposits", "free_egg", "maintenance", "transfers"):
            if k in body:
                s[k] = bool(body[k])
        if "market_prices" in body:
            s["market_prices"] = bool(body["market_prices"])
        if "star_usd" in body:
            s["star_usd"] = round(num(body["star_usd"], 0.001, 1, 0.015), 4)
        if "ref_bonus" in body:
            s["ref_bonus"] = int(num(body["ref_bonus"], 0, 100000, 100))
        if "max_bet" in body:
            s["max_bet"] = int(num(body["max_bet"], 10, 10**9, 100000))
        if "hold_over" in body:
            s["hold_over"] = int(num(body["hold_over"], 100, 10**9, 50000))
        if "transfers_day" in body:
            s["transfers_day"] = int(num(body["transfers_day"], 0, 1000, 10))
        for k in ("maint_text", "withdraw_note"):
            if k in body:
                s[k] = G["clean"](body[k], 200)
        s.pop("prices", None); s.pop("floors", None)   # цены пишет только обновление цен
        for k, v in s.items():
            run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, json.dumps(v, ensure_ascii=False))
        log(uid, "settings", body)
        if "star_usd" in body or "market_prices" in body:     # пересчитать цены по новому курсу
            def redo():
                try:
                    refresh_prices() if settings().get("market_prices", True) else apply_prices({})
                except Exception as e:
                    print("Цены не пересчитались:", e, flush=True)
            threading.Thread(target=redo, daemon=True).start()
        return s

    if a == ["prices", "refresh"] and method == "POST":
        try:
            return refresh_prices()
        except Exception as e:
            raise err(502, f"prices: {e}")

    if a == ["promos"] and method == "GET":
        return {"promos": q("SELECT * FROM promos ORDER BY created DESC LIMIT 200")}
    if a == ["promos"] and method == "POST":
        code = (G["clean"](body.get("code"), 40).strip() or gen_code()).upper()
        if not re.match(r"^[\w\-\.!@#$%&*+=?а-яА-ЯёЁ]{2,40}$", code):
            raise err(400, "bad code")
        kind = body.get("kind")
        if kind not in ("stars", "gift"):
            raise err(400, "bad kind")
        gift = body.get("gift") if kind == "gift" else None
        if kind == "gift" and not gift_ok(gift):
            raise err(400, "bad gift")
        days = num(body.get("days"), 0, 3650)
        try:
            run("INSERT INTO promos (code, kind, amount, gift, uses_max, wager, expires, created, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                code, kind, int(num(body.get("amount"), 0, 10**8)), gift, int(num(body.get("uses_max"), 0, 10**7)),
                num(body.get("wager"), 0, 50), int(now + days * 86400) if days else None, now, G["clean"](body.get("note"), 120))
        except Exception:
            raise err(409, "exists")
        log(uid, "promo", {"code": code})
        return q1("SELECT * FROM promos WHERE code=?", code)
    if len(a) == 3 and a[0] == "promos" and method == "POST":
        code = a[1]
        if a[2] == "toggle":
            run("UPDATE promos SET active=1-active WHERE code=? COLLATE NOCASE", code)
        elif a[2] == "delete":
            run("DELETE FROM promos WHERE code=? COLLATE NOCASE", code)
        return {"ok": True}

    if a == ["tasks"] and method == "GET":
        rows = q("SELECT * FROM tasks ORDER BY id DESC")
        for t in rows:
            t["done"] = (q1("SELECT COUNT(*) n FROM task_done WHERE task=?", t["id"]) or {}).get("n", 0)
        return {"tasks": rows}
    if a == ["tasks"] and method == "POST":
        kind = body.get("kind")
        if kind not in ("sub", "link"):
            raise err(400, "bad kind")
        target = G["clean"](body.get("target"), 200)
        title = G["clean"](body.get("title"), 80)
        if not target or not title:
            raise err(400, "empty")
        if kind == "link" and not target.startswith("https://"):
            raise err(400, "bad link")
        if kind == "sub":
            target = re.sub(r"^(https://)?t\.me/", "@", target)
        tid = run("INSERT INTO tasks (title, kind, target, reward, created) VALUES (?, ?, ?, ?, ?)", title, kind, target, int(num(body.get("reward"), 0, 10**6)), now)
        log(uid, "task", {"id": tid, "title": title})
        return q1("SELECT * FROM tasks WHERE id=?", tid)
    if len(a) == 3 and a[0] == "tasks" and method == "POST":
        tid = int(a[1])
        if a[2] == "toggle":
            run("UPDATE tasks SET active=1-active WHERE id=?", tid)
        elif a[2] == "delete":
            run("DELETE FROM tasks WHERE id=?", tid)
            run("DELETE FROM task_done WHERE task=?", tid)
        return {"ok": True}

    if a == ["broadcast"] and method == "POST":
        text = str(body.get("text") or "")[:4000]
        photo = G["clean_photo"](body.get("photo")) if body.get("photo") else ""
        if not text.strip() and not photo:
            raise err(400, "empty")
        log(uid, "broadcast", {"test": bool(body.get("test")), "len": len(text)})
        return broadcast(uid, text, photo, body.get("button"), bool(body.get("test")))

    if a == ["log"]:
        return {"log": q("SELECT * FROM admin_log ORDER BY id DESC LIMIT 100")}

    raise err(404, "not found")
