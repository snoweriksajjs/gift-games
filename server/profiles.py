"""Профиль как в Telegram: несколько юзернеймов, галочка, музыка, свой канал, подарки вокруг аватарки и истории.

- Юзернеймы: основной бесплатно, ещё до 9 штук по 50 звёзд (всего не больше 10). Не короче 5 символов, у админа от 1.
- Галочка: 100 звёзд или выдаёт админ, у админов сразу. Вид галочки выбирается из нескольких дизайнов.
- Музыка: любой аудиофайл, играет прямо в приложении.
- Канал: один из своих каналов DuckChance показывается карточкой в профиле.
- Подарки вокруг аватарки: до 6 своих подарков.
- Истории: фото или видео, 24 часа видны кружком на аватарке, потом остаются в профиле в разделе «Истории».
"""
import json, re, time

G = {}
TAG = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,31}$")
MAX_TAGS, TAG_PRICE, CHECK_PRICE = 10, 50, 100
CHECKS = ["classic", "mint", "violet", "gold", "rose", "fire", "ice", "dark"]   # дизайны галочки
# цвет ника: однотонные для всех, градиенты для аккаунтов с галочкой
NAME_SOLID = ["red", "orange", "violet", "green", "cyan", "blue", "pink"]
NAME_GRAD = ["sunset", "berry", "sea", "night", "gold", "aqua", "fire"]
STORY_TTL = 86400


def bind(g):
    G.update(g)
    db = g["db"]
    db.executescript("""
    CREATE TABLE IF NOT EXISTS tags (tag TEXT PRIMARY KEY COLLATE NOCASE, user INTEGER, at INTEGER);
    CREATE INDEX IF NOT EXISTS tags_user ON tags (user);
    CREATE TABLE IF NOT EXISTS stories (id INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, url TEXT, kind TEXT, caption TEXT,
      created INTEGER, deleted INTEGER);
    CREATE INDEX IF NOT EXISTS stories_user ON stories (user, id);
    CREATE TABLE IF NOT EXISTS story_views (story INTEGER, user INTEGER, at INTEGER, PRIMARY KEY (story, user));
    CREATE TABLE IF NOT EXISTS profile_views (user INTEGER, viewer INTEGER, at INTEGER, PRIMARY KEY (user, viewer));
    """)
    for c, d in [("music", "TEXT"), ("channel", "INTEGER"), ("orbit", "TEXT"), ("verified", "INTEGER"), ("check_style", "TEXT"), ("name_color", "TEXT")]:
        g["add_column"]("users", c, d)


def err(code, text):
    return G["HttpError"](code, text)


def q(*a):
    return G["q"](*a)


def q1(*a):
    return G["q1"](*a)


def run(*a):
    return G["run"](*a)


def is_admin(uid):
    return uid in G["admin"].ADMINS


def tag_ok(tag, uid):
    """Свободен ли юзернейм: среди основных юзернеймов игроков, дополнительных и юзернеймов чатов."""
    if not TAG.match(tag or "") or (len(tag) < 5 and not is_admin(uid)):
        return False
    if tag.lower() in G["RESERVED"] and not is_admin(uid):
        return False
    return not (q1("SELECT 1 x FROM users WHERE handle=? COLLATE NOCASE AND id<>?", tag, uid)
                or q1("SELECT 1 x FROM tags WHERE tag=? COLLATE NOCASE", tag)
                or q1("SELECT 1 x FROM chats WHERE handle=? COLLATE NOCASE", tag))


def active_story(uid):
    return q1("SELECT id FROM stories WHERE user=? AND deleted IS NULL AND created>? ORDER BY id DESC LIMIT 1", uid, int(time.time()) - STORY_TTL)


def extra(uid, full=False, viewer=None):
    """Добавка к карточке игрока: галочка и истории. В полной карточке ещё музыка, канал, юзернеймы и подарки."""
    u = q1("SELECT verified, check_style, music, channel, orbit, name_color, created FROM users WHERE id=?", uid) or {}
    verified = bool(u.get("verified")) or is_admin(uid)
    st = active_story(uid)
    nc = u.get("name_color")
    if nc in NAME_GRAD and not verified:
        nc = None
    out = {"verified": verified, "check": (u.get("check_style") or "classic") if verified else None, "story": st["id"] if st else 0,
           "name_color": nc}
    if st and viewer:
        out["story_seen"] = bool(q1("SELECT 1 x FROM story_views WHERE story=? AND user=?", st["id"], viewer))
    if not full:
        return out
    out["tags"] = [r["tag"] for r in q("SELECT tag FROM tags WHERE user=? ORDER BY at", uid)]
    out["music"] = json.loads(u["music"]) if u.get("music") else None
    ch = q1("SELECT id, title, photo, handle FROM chats WHERE id=? AND kind='channel' AND owner=?", u.get("channel") or 0, uid)
    if ch:
        ch["members"] = (q1("SELECT COUNT(*) n FROM members WHERE chat=?", ch["id"]) or {}).get("n", 0)
    out["channel"] = ch
    orbit = json.loads(u["orbit"]) if u.get("orbit") else []
    own = {r["gift"] for r in q("SELECT gift FROM inventory WHERE user=?", uid)}
    out["orbit"] = [g for g in orbit if g in own][:6]      # подарок продан или передан: с аватарки пропадает
    out["stories"] = (q1("SELECT COUNT(*) n FROM stories WHERE user=? AND deleted IS NULL", uid) or {}).get("n", 0)
    out["views"] = (q1("SELECT COUNT(*) n FROM profile_views WHERE user=?", uid) or {}).get("n", 0)
    out["since"] = u.get("created") or 0
    w = q1("SELECT balance FROM wallets WHERE user=?", uid)
    out["balance"] = w["balance"] if w else None
    return out


def viewed(uid, viewer, now):
    """Просмотр профиля: каждый игрок считается один раз."""
    if viewer != uid:
        run("INSERT OR IGNORE INTO profile_views (user, viewer, at) VALUES (?, ?, ?)", uid, viewer, now)


def story_out(s, viewer):
    return {"id": s["id"], "user": s["user"], "url": s["url"], "kind": s["kind"], "caption": s["caption"] or "", "created": s["created"],
            "active": s["created"] > int(time.time()) - STORY_TTL,
            "views": (q1("SELECT COUNT(*) n FROM story_views WHERE story=?", s["id"]) or {}).get("n", 0) if s["user"] == viewer else None}


def handle(method, p, uid, body, query, now):
    if not p or p[0] not in ("profile", "tags", "verify", "stories", "story"):
        return None
    bank = G["bank"]

    if p == ["profile"] and method == "POST":
        sets = []
        if "music" in body:
            m = body["music"]
            if m:
                url = G["clean_media"](m.get("url"), ("mp3", "m4a", "ogg", "wav"))
                if not url:
                    raise err(400, "bad music")
                sets.append(("music", json.dumps({"url": url, "title": G["clean"](m.get("title"), 64) or "Без названия"}, ensure_ascii=False)))
            else:
                sets.append(("music", None))
        if "channel" in body:
            cid = int(body["channel"] or 0)
            if cid and not q1("SELECT 1 x FROM chats WHERE id=? AND kind='channel' AND owner=?", cid, uid):
                raise err(403, "not your channel")
            sets.append(("channel", cid or None))
        if "orbit" in body:
            ids = body["orbit"] if isinstance(body["orbit"], list) else []
            own = [r["gift"] for r in q("SELECT gift FROM inventory WHERE user=?", uid)]
            pick = []
            for g in ids[:6]:
                if isinstance(g, str) and g in own and own.count(g) > pick.count(g):
                    pick.append(g)
            sets.append(("orbit", json.dumps(pick)))
        if "name_color" in body:
            nc = body["name_color"]
            if nc and nc not in NAME_SOLID + NAME_GRAD:
                raise err(400, "bad color")
            if nc in NAME_GRAD and not extra(uid)["verified"]:
                raise err(403, "not verified")
            sets.append(("name_color", nc or None))
        if "check" in body:
            if body["check"] not in CHECKS:
                raise err(400, "bad check")
            if not extra(uid)["verified"]:
                raise err(403, "not verified")
            sets.append(("check_style", body["check"]))
        for k, v in sets:
            run(f"UPDATE users SET {k}=? WHERE id=?", v, uid)
        return {"me": G["user_card"](uid, True)}

    if p == ["tags", "add"] and method == "POST":
        G["limit"](uid, "tags", 20, 3600)
        tag = G["clean"](body.get("tag"), 32).lstrip("@")
        if not tag_ok(tag, uid):
            raise err(409, "taken" if TAG.match(tag or "") and len(tag) >= (1 if is_admin(uid) else 5) else "bad tag")
        main = q1("SELECT handle FROM users WHERE id=?", uid)
        count = (1 if main and main.get("handle") else 0) + len(q("SELECT tag FROM tags WHERE user=?", uid))
        if count >= MAX_TAGS:
            raise err(409, "max tags")
        with bank.tx():
            if not is_admin(uid):          # дополнительный юзернейм за звёзды, админу бесплатно
                bank.need(uid)
                bank.move(uid, -TAG_PRICE, f"юзернейм @{tag}")
            G["db"].execute("INSERT INTO tags (tag, user, at) VALUES (?, ?, ?)", (tag, uid, now))
            st = bank.state(uid) if bank.wallet(uid) else None
        return {"me": G["user_card"](uid, True), "state": st}

    if p == ["tags", "remove"] and method == "POST":
        run("DELETE FROM tags WHERE tag=? COLLATE NOCASE AND user=?", G["clean"](body.get("tag"), 32).lstrip("@"), uid)
        return {"me": G["user_card"](uid, True)}

    if p == ["tags", "main"] and method == "POST":      # сделать дополнительный юзернейм основным
        tag = G["clean"](body.get("tag"), 32).lstrip("@")
        row = q1("SELECT tag FROM tags WHERE tag=? COLLATE NOCASE AND user=?", tag, uid)
        if not row:
            raise err(404, "no tag")
        old = (q1("SELECT handle FROM users WHERE id=?", uid) or {}).get("handle")
        with bank.tx():
            G["db"].execute("DELETE FROM tags WHERE tag=? COLLATE NOCASE", (row["tag"],))
            G["db"].execute("UPDATE users SET handle=? WHERE id=?", (row["tag"], uid))
            if old:
                G["db"].execute("INSERT INTO tags (tag, user, at) VALUES (?, ?, ?)", (old, uid, now))
        return {"me": G["user_card"](uid, True)}

    if p == ["verify", "buy"] and method == "POST":
        if extra(uid)["verified"]:
            raise err(409, "already verified")
        with bank.tx():
            bank.need(uid)
            bank.move(uid, -CHECK_PRICE, "галочка")
            G["db"].execute("UPDATE users SET verified=1 WHERE id=?", (uid,))
            st = bank.state(uid)
        return {"me": G["user_card"](uid, True), "state": st}

    if p == ["stories"] and method == "POST":
        G["limit"](uid, "story", 20, 86400)
        url = G["clean_media"](body.get("url"), ("jpg", "mp4"))
        if not url:
            raise err(400, "bad media")
        sid = run("INSERT INTO stories (user, url, kind, caption, created) VALUES (?, ?, ?, ?, ?)",
                  uid, url, "video" if url.endswith(".mp4") else "photo", G["clean"](body.get("caption"), 200), now)
        return {"story": story_out(q1("SELECT * FROM stories WHERE id=?", sid), uid)}

    if len(p) == 2 and p[0] == "stories" and method == "GET":
        tid = int(p[1])
        rows = q("SELECT * FROM stories WHERE user=? AND deleted IS NULL ORDER BY id DESC LIMIT 100", tid)
        return {"stories": [story_out(s, uid) for s in rows], "user": G["user_card"](tid)}

    if len(p) == 3 and p[0] == "story" and method == "POST":
        sid = int(p[1])
        s = q1("SELECT * FROM stories WHERE id=? AND deleted IS NULL", sid)
        if not s:
            raise err(404, "no story")
        if p[2] == "view":
            if s["user"] != uid:
                run("INSERT OR IGNORE INTO story_views (story, user, at) VALUES (?, ?, ?)", sid, uid, now)
            return {"ok": True}
        if p[2] == "delete":
            if s["user"] != uid and not is_admin(uid):
                raise err(403, "not yours")
            run("UPDATE stories SET deleted=? WHERE id=?", now, sid)
            return {"ok": True}
    raise err(404, "not found")
