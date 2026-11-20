"""NFT-подарки через бизнес-аккаунт владельца: пополнение и автоматический вывод.

Подключение (делает владелец, один раз):
  1. @BotFather → бот → Bot Settings → Business Mode → включить.
  2. На аккаунте-хранилище (нужен Telegram Premium): Настройки → Telegram для бизнеса → Чат-боты → @DuckChanceApp,
     права «Подарки и звёзды»: просмотр, передача подарков и перевод звёзд.
  Бот получает событие business_connection. Подключение принимаем только от аккаунта из настройки nft_account
  или от админа: иначе любой владелец Premium подключил бы бота и «пополнял» игроков чужими подарками.

Пополнение: игрок дарит NFT-подарок аккаунту. Сервер раз в 30 секунд и сразу после сообщения о подарке читает
подарки аккаунта (getBusinessAccountGifts), находит новый в каталоге по коллекции, модели и фону и кладёт игроку
в инвентарь. Подарки, которые лежали на аккаунте до первого подключения, личные: их не трогаем.

Вывод: сервер берёт такой же настоящий подарок из запаса и передаёт игроку (transferGift). Подарок, который игрок
положил сам или выиграл из запаса, закреплён за ним, пока лежит у него. Комиссию Telegram за передачу аккаунт
платит звёздами, игрок возмещает её из игрового баланса. Telegram передаёт подарок только в чат, где за последние
24 часа было сообщение, поэтому перед выводом игрок пишет аккаунту любое сообщение.
"""
import json, os, threading, time, urllib.error

import bank
import catalog

G = {}
SYNC_EVERY = int(os.environ.get("NFT_SYNC_EVERY", "30"))           # сверка подарков аккаунта, секунд
RESOLVE_AFTER = int(os.environ.get("NFT_RESOLVE_AFTER", "60"))     # через сколько секунд разбираем оборванный вывод
PRIZE_SHARE = 0.7                # подарок из запаса идёт в выигрыш, если стоит не меньше 70% суммы (остаток звёздами)
RIGHTS = {"can_view_gifts_and_stars": "просмотр подарков и звёзд", "can_transfer_and_upgrade_gifts": "передача подарков",
          "can_transfer_stars": "перевод звёзд"}
_kick = threading.Event()
_sync_lock = threading.Lock()
_errs, _bal = {}, {"at": 0, "value": None}


def bind(g):
    G.update(g)
    with G["lock"]:
        G["db"].executescript("""
        CREATE TABLE IF NOT EXISTS biz (id TEXT PRIMARY KEY, user INTEGER, username TEXT, name TEXT, rights TEXT,
          enabled INTEGER, allowed INTEGER, date INTEGER, since INTEGER, updated INTEGER);
        CREATE TABLE IF NOT EXISTS nft_stock (owned TEXT PRIMARY KEY, gift TEXT, name TEXT, title TEXT, sender INTEGER, sent INTEGER,
          fee INTEGER, next_at INTEGER, movable INTEGER, inv INTEGER, state TEXT, deposit TEXT, seen INTEGER, raw TEXT);
        CREATE INDEX IF NOT EXISTS nft_stock_gift ON nft_stock (gift, state);
        CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, gift TEXT, owned TEXT,
          fee INTEGER, status TEXT, error TEXT, created INTEGER, done INTEGER);
        CREATE INDEX IF NOT EXISTS withdrawals_user ON withdrawals (user, id);
        """)
    threading.Thread(target=loop, daemon=True).start()


def err(code, text):
    return G["HttpError"](code, text)


def report(where, e):
    """Ошибка в журнал: одна и та же не чаще раза в 5 минут."""
    key, t = (where, repr(e)[:200]), time.time()
    if t - _errs.get(key, 0) >= 300:
        if len(_errs) > 100:
            _errs.clear()
        _errs[key] = t
        print(f"NFT ({where}):", repr(e)[:300], flush=True)


def account_name():
    return str(G["admin"].settings().get("nft_account") or "").lstrip("@")


def allowed_user(u):
    name = (u.get("username") or "").lower()
    return u.get("id") in G["admin"].ADMINS or bool(name and name == account_name().lower())


def conn():
    """Действующее подключение бизнес-аккаунта: последнее включённое и разрешённое."""
    r = G["q1"]("SELECT * FROM biz WHERE enabled=1 AND allowed=1 ORDER BY date DESC LIMIT 1")
    if r:
        r["rights"] = json.loads(r["rights"] or "{}")
    return r


def right(c, name):
    return bool(c and (c.get("rights") or {}).get(name))


def first_since():
    """С какого момента подарки аккаунта считаются пополнениями: первое подключение."""
    r = G["q1"]("SELECT MIN(since) s FROM biz WHERE allowed=1")
    return (r or {}).get("s") or int(time.time())


def tg_error(e):
    if isinstance(e, urllib.error.HTTPError):
        try:
            body = e.read().decode("utf-8", "ignore")
            return json.loads(body).get("description") or body[:200]
        except Exception:
            return f"HTTP {e.code}"
    return repr(e)[:200]


def _bg(fn, *a):
    threading.Thread(target=fn, args=a, daemon=True).start()


def send_to(uid, text, button=True):
    """Сообщение игроку от бота (если он запускал бота; иначе Telegram откажет, и это не страшно)."""
    def go():
        try:
            kw = {"reply_markup": {"inline_keyboard": [[{"text": "Открыть DuckChance", "web_app": {"url": f"{G['SITE']}?v={G['VER']}"}}]]}} if button else {}
            G["tg_call"]("sendMessage", chat_id=uid, text=text, **kw)
        except Exception:
            pass
    _bg(go)


def admins(text):
    for a in G["admin"].ADMINS:
        send_to(a, text, button=False)


def kick():
    """Сверить подарки аккаунта сейчас, не дожидаясь очередной сверки."""
    _kick.set()


# ---------- события бота ----------
def on_connection(bc):
    u = bc.get("user") or {}
    ok, now = allowed_user(u), int(time.time())
    with G["lock"]:
        old = G["db"].execute("SELECT since FROM biz WHERE id=?", (bc["id"],)).fetchone()
        first = G["db"].execute("SELECT MIN(since) FROM biz WHERE allowed=1").fetchone()[0]
        since = old["since"] if old and old["since"] else (first or int(bc.get("date") or now))
        G["db"].execute("INSERT OR REPLACE INTO biz (id, user, username, name, rights, enabled, allowed, date, since, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (bc["id"], u.get("id"), u.get("username") or "", f"{u.get('first_name') or ''} {u.get('last_name') or ''}".strip(),
                         json.dumps(bc.get("rights") or {}), 1 if bc.get("is_enabled") else 0, 1 if ok else 0, int(bc.get("date") or now), since, now))
    who = "@" + u["username"] if u.get("username") else f"id {u.get('id')}"
    miss = [v for k, v in RIGHTS.items() if not (bc.get("rights") or {}).get(k)]
    if not ok:
        admins(f"Бизнес-аккаунт {who} подключил бота, но это не аккаунт для NFT из настроек админки. Подключение не используется.")
    elif not bc.get("is_enabled"):
        admins(f"Бизнес-аккаунт {who} отключил бота: пополнение и вывод NFT остановлены.")
    else:
        admins(f"Бизнес-аккаунт {who} подключён." + (f" Не хватает прав: {', '.join(miss)}." if miss else " Все права на месте: пополнение и вывод NFT работают."))
    kick()


def on_gift_message(m):
    """Сообщение о подарке в чатах бизнес-аккаунта: сверяем подарки сразу."""
    c = conn()
    if not c or m.get("business_connection_id") != c["id"]:
        return
    frm = (m.get("from") or {}).get("id")
    if frm == c["user"]:          # подарок отправил сам аккаунт (это вывод игроку), не пополнение
        return
    if m.get("unique_gift"):
        kick()
    elif m.get("gift") and frm:
        send_to(frm, "Пополнение принимает только NFT-подарки (улучшенные). Обычный подарок сам не зачисляется: напишите в поддержку бота.")


# ---------- сверка подарков аккаунта ----------
def describe(og):
    g = og.get("gift") or {}
    gid = catalog.find(g.get("base_name"), (g.get("model") or {}).get("name"), (g.get("backdrop") or {}).get("name"))
    movable = 1 if og.get("can_be_transferred") and not g.get("is_from_blockchain") and not g.get("is_burned") else 0
    return {"gift": gid, "name": g.get("name") or "", "title": f"{g.get('base_name') or 'Подарок'} #{g.get('number') or ''}".strip(" #"),
            "sender": (og.get("sender_user") or {}).get("id"), "fee": int(og.get("transfer_star_count") or 0),
            "next_at": int(og.get("next_transfer_date") or 0) or None, "movable": movable}


def fetch_all(c):
    out, offset = {}, ""
    for _ in range(50):
        r = G["tg_call"]("getBusinessAccountGifts", business_connection_id=c["id"], exclude_unlimited=True,
                         exclude_limited_upgradable=True, exclude_limited_non_upgradable=True, offset=offset, limit=100)["result"]
        for og in r.get("gifts") or []:
            if og.get("type") == "unique" and og.get("owned_gift_id"):
                out[og["owned_gift_id"]] = og
        offset = r.get("next_offset") or ""
        if not offset:
            break
    return out


def sync():
    c = conn()
    if not c or not right(c, "can_view_gifts_and_stars"):
        return False
    with _sync_lock:
        owned = fetch_all(c)
        now, since, unknown = int(time.time()), first_since(), []
        with G["lock"]:
            rows = {r["owned"]: dict(r) for r in G["db"].execute("SELECT owned, state FROM nft_stock").fetchall()}
            for oid, og in owned.items():
                d = describe(og)
                if oid not in rows:
                    personal = int(og.get("send_date") or 0) < since
                    deposit = None
                    if not personal and d["sender"] and d["sender"] != c["user"]:
                        deposit = "new" if d["gift"] else "unknown"
                        if not d["gift"]:
                            unknown.append(d)
                    G["db"].execute("INSERT INTO nft_stock (owned, gift, name, title, sender, sent, fee, next_at, movable, inv, state, deposit, seen, raw) "
                                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
                                    (oid, d["gift"], d["name"], d["title"], d["sender"], int(og.get("send_date") or 0), d["fee"], d["next_at"], d["movable"],
                                     "personal" if personal else "stock", deposit, now, json.dumps(og, ensure_ascii=False)[:6000]))
                else:
                    G["db"].execute("UPDATE nft_stock SET fee=?, next_at=?, movable=?, seen=?, state=CASE WHEN state='gone' THEN 'stock' ELSE state END WHERE owned=?",
                                    (d["fee"], d["next_at"], d["movable"], now, oid))
            for oid, r in rows.items():
                if oid not in owned and r["state"] in ("stock", "personal"):   # владелец сам передал или продал подарок
                    G["db"].execute("UPDATE nft_stock SET state='gone', seen=? WHERE owned=?", (now, oid))
        resolve_sending(owned)
    for d in unknown:
        admins(f"Пришёл NFT-подарок {d['title']} от id {d['sender']}, но его модели или фона нет в каталоге. Зачислите игроку вручную через выдачи.")
        send_to(d["sender"], f"Подарок {d['title']} получен. Его пока нет в каталоге игры: админ проверит и зачислит вручную.")
    credit_pending()
    return True


def loop():
    time.sleep(3)
    while True:
        _kick.wait(SYNC_EVERY)
        _kick.clear()
        try:
            sync()
        except Exception as e:
            report("сверка", e)


# ---------- пополнение ----------
def credit(r):
    uid = r["sender"]
    with bank.tx():
        if not bank.wallet(uid):          # игрок ещё не открывал приложение: зачислим, когда откроет
            fresh = G["db"].execute("UPDATE nft_stock SET deposit='waiting' WHERE owned=? AND deposit='new'", (r["owned"],)).rowcount
            inv = None
        else:
            if G["db"].execute("UPDATE nft_stock SET deposit='credited' WHERE owned=? AND deposit IN ('new', 'waiting')", (r["owned"],)).rowcount != 1:
                return
            inv = bank.add_gift(uid, r["gift"], "пополнение NFT-подарком")
            G["db"].execute("UPDATE nft_stock SET inv=? WHERE owned=?", (inv, r["owned"]))
    if inv is None:
        if fresh:
            send_to(uid, f"Подарок {r['title']} получен. Откройте DuckChance, и он появится у вас в профиле.")
        return
    G["admin"].ref_activate(uid)          # пополнение засчитывается для бонуса пригласившему
    g = catalog.get(r["gift"])
    send_to(uid, f"Подарок {r['title']} зачислен в DuckChance" + (f", оценка ⭐ {g['price']}" if g else "") + ".")


def credit_pending(uid=None):
    """Пополнения, которые ещё не дошли до игрока (новые или ждали, пока он откроет приложение)."""
    sql = "SELECT owned, gift, title, sender FROM nft_stock WHERE deposit IN ('new', 'waiting') AND state='stock' AND gift IS NOT NULL"
    for r in G["q"](sql + (" AND sender=?" if uid else ""), *([uid] if uid else [])):
        try:
            credit(r)
        except Exception as e:
            report("зачисление", e)


def credit_user(uid):
    credit_pending(uid)


# ---------- выигрыш подарком из запаса ----------
def prize_from_stock(uid, value):
    """Вызывается внутри транзакции выигрыша: самый дорогой свободный подарок из запаса не дороже суммы.
    Возвращает (подарок каталога, номер в инвентаре) или None."""
    if value <= 0 or not public()["withdraw"]:
        return None
    rows = G["db"].execute("SELECT s.owned, s.gift FROM nft_stock s WHERE s.state='stock' AND s.movable=1 AND s.gift IS NOT NULL "
                           "AND (s.inv IS NULL OR NOT EXISTS (SELECT 1 FROM inventory i WHERE i.uid=s.inv))").fetchall()
    best = None
    for r in rows:
        g = catalog.get(r["gift"])
        if g and value * PRIZE_SHARE <= g["price"] <= value and (not best or g["price"] > best[0]["price"]):
            best = (g, r["owned"])
    if not best:
        return None
    inv = bank.add_gift(uid, best[0]["id"], "выигрыш подарком из наличия")
    G["db"].execute("UPDATE nft_stock SET inv=? WHERE owned=?", (inv, best[1]))
    return best[0], inv


def reserve(inv, gid):
    """Выигранный подарок (апгрейд) закрепляем за игроком, если такой же есть в запасе. Внутри транзакции."""
    r = G["db"].execute("SELECT owned FROM nft_stock WHERE state='stock' AND movable=1 AND gift=? "
                        "AND (inv IS NULL OR NOT EXISTS (SELECT 1 FROM inventory i WHERE i.uid=nft_stock.inv)) LIMIT 1", (gid,)).fetchone()
    if r:
        G["db"].execute("UPDATE nft_stock SET inv=? WHERE owned=?", (inv, r["owned"]))


# ---------- вывод ----------
def availability(uid, now=None):
    """Какие подарки игрока можно вывести: {номер в инвентаре: {"owned", "fee", "at"}}. Под общей блокировкой."""
    now = now or int(time.time())
    items = [dict(r) for r in G["db"].execute("SELECT uid, gift FROM inventory WHERE user=? AND stake IS NULL", (uid,)).fetchall()]
    gifts = sorted({i["gift"] for i in items})
    stock = []
    for k in range(0, len(gifts), 500):
        part = gifts[k:k + 500]
        stock += [dict(r) for r in G["db"].execute(
            f"SELECT s.owned, s.gift, s.fee, s.next_at, s.inv, EXISTS (SELECT 1 FROM inventory i WHERE i.uid=s.inv) AS held "
            f"FROM nft_stock s WHERE s.state='stock' AND s.movable=1 AND s.gift IN ({','.join('?' * len(part))}) ORDER BY s.fee", part).fetchall()]
    used, out = set(), {}
    mine = {i["uid"] for i in items}
    for s in stock:                       # сначала подарки, закреплённые за этим игроком
        if s["held"] and s["inv"] in mine:
            out[s["inv"]] = s
            used.add(s["owned"])
    free = {}
    for s in stock:
        if not s["held"] and s["owned"] not in used:
            free.setdefault(s["gift"], []).append(s)
    for i in items:
        if i["uid"] not in out and free.get(i["gift"]):
            out[i["uid"]] = free[i["gift"]].pop(0)
    return {u: {"owned": s["owned"], "fee": int(s["fee"] or 0), "at": s["next_at"] if s["next_at"] and s["next_at"] > now else None}
            for u, s in out.items()}


def public():
    c = conn()
    return {"account": (c and c.get("username")) or account_name(), "deposit": bool(c and right(c, "can_view_gifts_and_stars")),
            "withdraw": bool(c and right(c, "can_transfer_and_upgrade_gifts") and right(c, "can_view_gifts_and_stars"))}


def mine(uid):
    with G["lock"]:
        av = availability(uid)
        w = bank.wallet(uid)
    wg = json.loads(w["wager"] or "null") if w else None
    left = max(0, int((wg or {}).get("need", 0) - (wg or {}).get("done", 0)))
    return {"items": [{"uid": u, "fee": a["fee"], "at": a["at"]} for u, a in av.items()], "wager_left": left, **public()}


def finish(w):
    with bank.tx():
        if G["db"].execute("UPDATE withdrawals SET status='done', done=? WHERE id=? AND status='sending'", (int(time.time()), w["id"])).rowcount == 1:
            G["db"].execute("UPDATE nft_stock SET state='out' WHERE owned=?", (w["owned"],))


def undo(w, why):
    """Передача не состоялась: подарок обратно в инвентарь, комиссия обратно на баланс."""
    with bank.tx():
        if G["db"].execute("UPDATE withdrawals SET status='failed', error=?, done=? WHERE id=? AND status='sending'",
                           (why[:300], int(time.time()), w["id"])).rowcount != 1:
            return False
        inv = bank.add_gift(w["user"], w["gift"], "вывод не состоялся, подарок вернулся")
        G["db"].execute("UPDATE nft_stock SET state='stock', inv=? WHERE owned=? AND state='sending'", (inv, w["owned"]))
        if w["fee"]:
            bank.move(w["user"], int(w["fee"]), "возврат комиссии за вывод")
    return True


def resolve_sending(owned):
    """Вывод, который оборвался на середине (перезапуск, обрыв связи): подарок ушёл, если его больше нет на аккаунте."""
    for w in G["q"]("SELECT * FROM withdrawals WHERE status='sending' AND created<?", int(time.time()) - RESOLVE_AFTER):
        if w["owned"] in owned:
            undo(w, "Telegram не подтвердил передачу")
        else:
            finish(w)


def write_first(why):
    t = why.lower()
    return any(x in t for x in ("peer", "chat", "active", "24", "user_not", "privacy"))


def checking(uid, e):
    report("вывод", e)
    kick()
    with G["lock"]:
        return {"checking": True, "state": bank.state(uid)}


def withdraw(uid, body):
    c = conn()
    if not c or not right(c, "can_transfer_and_upgrade_gifts"):
        raise err(503, "withdraw off")
    G["limit"](uid, "withdraw", 6, 60)
    inv_uid = body.get("uid")
    if isinstance(inv_uid, bool) or not isinstance(inv_uid, int):
        raise err(400, "bad gift")
    now = int(time.time())
    with bank.tx():
        w = bank.need(uid)
        wg = json.loads(w["wager"] or "null")
        if wg and wg.get("need", 0) > wg.get("done", 0):
            raise err(403, "wager")
        item = bank.q1("SELECT uid, gift, stake FROM inventory WHERE uid=? AND user=?", inv_uid, uid)
        if not item or item["stake"]:
            raise err(409, "gift not yours")
        a = availability(uid, now).get(inv_uid)
        if not a:
            raise err(409, "not in stock")
        if a["at"]:
            raise err(409, f"later:{a['at']}")
        st = bank.q1("SELECT owned, gift, name, title, fee FROM nft_stock WHERE owned=? AND state='stock'", a["owned"])
        fee = int(st["fee"] or 0)
        if fee and not right(c, "can_transfer_stars"):
            raise err(503, "fee right")
        if fee and (star_balance(c) or 0) < fee:      # комиссию платит аккаунт: без звёзд Telegram откажет
            low_stars(fee)
            raise err(503, "no stars")
        if fee:
            bank.move(uid, -fee, f"комиссия Telegram за вывод {st['title']}")
        bank.ex("DELETE FROM inventory WHERE uid=? AND user=?", inv_uid, uid)
        bank.ex("INSERT INTO ledger (user, delta, reason, at) VALUES (?, 0, ?, ?)", uid, f"-{item['gift']} вывод в Telegram ({st['title']})", now)
        bank.ex("UPDATE nft_stock SET state='sending', inv=NULL WHERE owned=?", st["owned"])
        wid = bank.ex("INSERT INTO withdrawals (user, gift, owned, fee, status, created) VALUES (?, ?, ?, ?, 'sending', ?)",
                      uid, item["gift"], st["owned"], fee, now).lastrowid
    rec = {"id": wid, "user": uid, "gift": item["gift"], "owned": st["owned"], "fee": fee}
    try:
        params = {"business_connection_id": c["id"], "owned_gift_id": st["owned"], "new_owner_chat_id": uid}
        if fee:
            params["star_count"] = fee
        G["tg_call"]("transferGift", **params)
    except urllib.error.HTTPError as e:
        why = tg_error(e)
        if e.code < 500:
            undo(rec, why)
            print("Вывод не прошёл:", uid, st["title"], why, flush=True)
            raise err(409, "write first" if write_first(why) else f"telegram: {why[:160]}")
        return checking(uid, e)           # ответ Telegram неясен: сверка через минуту решит, ушёл подарок или нет
    except Exception as e:                # обрыв связи: подарок мог уйти, ждём сверку
        return checking(uid, e)
    finish(rec)
    _bal["at"] = 0                        # после передачи звёзд на аккаунте стало меньше
    with G["lock"]:
        return {"ok": True, "title": st["title"], "name": st["name"], "fee": fee, "state": bank.state(uid)}


_low = {"at": 0}


def low_stars(fee):
    """Напомнить админу пополнить звёзды аккаунта: не чаще раза в час."""
    if time.time() - _low["at"] > 3600:
        _low["at"] = time.time()
        admins(f"Игрок хотел вывести подарок, но на бизнес-аккаунте не хватает звёзд на комиссию Telegram ({fee}). Пополните звёзды на аккаунте @{account_name()}.")


# ---------- админка ----------
def star_balance(c):
    if not c or not right(c, "can_view_gifts_and_stars"):
        return None
    if time.time() - _bal["at"] > 60:
        try:
            _bal["value"] = G["tg_call"]("getBusinessAccountStarBalance", business_connection_id=c["id"])["result"].get("amount")
        except Exception as e:
            report("баланс", e)
        _bal["at"] = time.time()
    return _bal["value"]


def admin_view():
    c = conn()
    last = G["q1"]("SELECT id, user, username, name, rights, enabled, allowed, date, since, updated FROM biz ORDER BY updated DESC LIMIT 1")
    if last:
        last["rights"] = json.loads(last["rights"] or "{}")
    stock = G["q"]("SELECT owned, gift, name, title, sender, sent, fee, next_at, movable, inv, state, deposit FROM nft_stock "
                   "WHERE state IN ('stock', 'personal', 'sending') ORDER BY sent DESC LIMIT 300")
    for s in stock:
        g = catalog.get(s["gift"]) if s["gift"] else None
        s["price"] = g["price"] if g else None
    counts = {r["state"]: r["n"] for r in G["q"]("SELECT state, COUNT(*) n FROM nft_stock GROUP BY state")}
    wd = G["q"]("SELECT id, user, gift, owned, fee, status, error, created, done FROM withdrawals ORDER BY id DESC LIMIT 40")
    deps = G["q"]("SELECT owned, title, sender, sent, deposit FROM nft_stock WHERE deposit IS NOT NULL ORDER BY sent DESC LIMIT 40")
    return {"conn": last, "active": bool(c), "rights": RIGHTS, "account": account_name(), "balance": star_balance(c),
            "stock": stock, "counts": counts, "withdrawals": wd, "deposits": deps, **public()}


def handle(method, p, uid, body, query, now):
    if not p or p[0] != "nft":
        return None
    a = p[1:]
    if a == ["mine"] and method == "GET":
        return mine(uid)
    if a == ["withdraw"] and method == "POST":
        return withdraw(uid, body)
    if a == ["sync"] and method == "POST":      # «Я отправил подарок»: проверить сразу
        G["limit"](uid, "nftsync", 6, 60)
        kick()
        return {"ok": True}
    if a and a[0] == "admin":
        if uid not in G["admin"].ADMINS:
            raise err(403, "admins only")
        if a == ["admin"] and method == "GET":
            return admin_view()
        if a == ["admin", "sync"] and method == "POST":
            try:
                sync()
            except Exception as e:
                raise err(502, f"telegram: {tg_error(e)}")
            return admin_view()
        if a == ["admin", "state"] and method == "POST":
            st, oid = body.get("state"), str(body.get("owned") or "")
            if st not in ("stock", "personal"):
                raise err(400, "bad state")
            with G["lock"]:
                n = G["db"].execute("UPDATE nft_stock SET state=? WHERE owned=? AND state IN ('stock', 'personal') "
                                    "AND (inv IS NULL OR NOT EXISTS (SELECT 1 FROM inventory i WHERE i.uid=nft_stock.inv))", (st, oid)).rowcount
            if n != 1:
                raise err(409, "cannot change")
            G["admin"].log(uid, "nft_state", {"owned": oid, "state": st})
            return admin_view()
    raise err(404, "not found")
