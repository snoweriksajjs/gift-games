"""Сервер DuckChance: чаты, группы, каналы и передача подарков между игроками.

Запуск:  TG_TOKEN=<токен бота> python3 server/app.py
Переменные окружения:
  TG_TOKEN   токен бота (обязательно). Им проверяется подпись initData из Telegram.
  PORT       порт (по умолчанию 8787). Снаружи сервер закрывает Caddy с HTTPS.
  DB         путь к базе SQLite (по умолчанию duckchance.db рядом с запуском)
  ORIGIN     адрес сайта, которому разрешены запросы (по умолчанию GitHub Pages)
  BOT        1, чтобы в этом же процессе работал бот (оплата, приглашения, уведомления)
  DEV        1 только для проверки на своём компьютере: вход без Telegram по заголовку X-Dev-User

Только стандартная библиотека Python 3.9+.
"""
import hashlib, hmac, json, os, re, sqlite3, sys, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("TG_TOKEN") or sys.exit("Нужна переменная окружения TG_TOKEN")
PORT = int(os.environ.get("PORT", "8787"))
DB_PATH = os.environ.get("DB", "duckchance.db")
ORIGINS = set(os.environ.get("ORIGIN", "https://snoweriksajjs.github.io").split(","))
DEV = os.environ.get("DEV") == "1"
SITE = os.environ.get("SITE", "https://snoweriksajjs.github.io/gift-games/")
VER = os.environ.get("APP_VER", "13")
AUTH_TTL = 7 * 86400          # сколько живёт подпись initData
GIFT_ID = re.compile(r"^g\d{1,4}$")
HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")
SYM = re.compile(r"^https://cdn\.changes\.tg/[^\"'()\s]{1,200}$")

# ---------- база ----------
db = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
db.row_factory = sqlite3.Row
db.execute("PRAGMA journal_mode=WAL")
db.create_function("ulower", 1, lambda x: (x or "").lower())   # встроенный lower() в SQLite не знает кириллицу
lock = threading.Lock()
db.executescript("""
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, username TEXT, photo TEXT, look TEXT, seen INTEGER);
CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, title TEXT, about TEXT, owner INTEGER,
  created INTEGER, dm_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS members (chat INTEGER, user INTEGER, role TEXT, read_id INTEGER DEFAULT 0, PRIMARY KEY (chat, user));
CREATE INDEX IF NOT EXISTS members_user ON members (user);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat INTEGER, user INTEGER, text TEXT, gift TEXT,
  reply INTEGER, created INTEGER);
CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat, id);
CREATE TABLE IF NOT EXISTS transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user INTEGER, to_user INTEGER, gift TEXT,
  msg INTEGER, created INTEGER, claimed INTEGER);
CREATE INDEX IF NOT EXISTS transfers_to ON transfers (to_user, claimed);
""")


def q(sql, *args):
    with lock:
        return [dict(r) for r in db.execute(sql, args).fetchall()]


def q1(sql, *args):
    r = q(sql, *args)
    return r[0] if r else None


def run(sql, *args):
    with lock:
        return db.execute(sql, args).lastrowid


class HttpError(Exception):
    def __init__(self, code, text):
        super().__init__(text)
        self.code, self.text = code, text


# ---------- вход через Telegram ----------
SECRET = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()


def check_init_data(raw):
    """Проверяет подпись initData по документации Telegram и возвращает пользователя."""
    pairs = dict(urllib.parse.parse_qsl(raw, keep_blank_values=True))
    got = pairs.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    want = hmac.new(SECRET, check.encode(), hashlib.sha256).hexdigest()
    if not got or not hmac.compare_digest(want, got):
        raise HttpError(401, "bad signature")
    if time.time() - int(pairs.get("auth_date", "0")) > AUTH_TTL:
        raise HttpError(401, "expired")
    return json.loads(pairs.get("user", "{}"))


def touch_user(u):
    name = " ".join(x for x in [u.get("first_name"), u.get("last_name")] if x)[:64] or "Игрок"
    with lock:
        db.execute("""INSERT INTO users (id, name, username, photo, seen) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username, photo=excluded.photo, seen=excluded.seen""",
                   (int(u["id"]), name, (u.get("username") or "")[:32], (u.get("photo_url") or "")[:300], int(time.time())))
    return int(u["id"])


# ---------- ограничение частоты ----------
hits = {}


def limit(uid, key, n, per):
    now = time.time()
    arr = [t for t in hits.get((uid, key), []) if now - t < per]
    if len(arr) >= n:
        raise HttpError(429, "slow down")
    arr.append(now)
    hits[(uid, key)] = arr


# ---------- разметка ответов ----------
def user_card(uid):
    u = q1("SELECT id, name, username, photo, look, seen FROM users WHERE id=?", uid)
    if not u:
        return {"id": uid, "name": "Игрок", "username": "", "photo": "", "look": None}
    u["look"] = json.loads(u["look"]) if u["look"] else None
    return u


def msg_out(m, cache):
    if m["user"] not in cache:
        cache[m["user"]] = user_card(m["user"])
    return {"id": m["id"], "chat": m["chat"], "user": cache[m["user"]], "text": m["text"], "gift": m["gift"],
            "reply": m["reply"], "created": m["created"]}


def member(chat, uid):
    return q1("SELECT role, read_id FROM members WHERE chat=? AND user=?", chat, uid)


def chat_or_404(cid):
    c = q1("SELECT * FROM chats WHERE id=?", cid)
    if not c:
        raise HttpError(404, "no chat")
    return c


def chat_out(c, uid):
    me = member(c["id"], uid)
    last = q1("SELECT * FROM messages WHERE chat=? ORDER BY id DESC LIMIT 1", c["id"])
    out = {"id": c["id"], "kind": c["kind"], "title": c["title"], "about": c["about"], "owner": c["owner"],
           "role": me["role"] if me else None,
           "members": q1("SELECT COUNT(*) n FROM members WHERE chat=?", c["id"])["n"],
           "last": msg_out(last, {}) if last else None,
           "unread": q1("SELECT COUNT(*) n FROM messages WHERE chat=? AND id>? AND user<>?", c["id"], me["read_id"], uid)["n"] if me else 0}
    if c["kind"] == "dm":
        other = q1("SELECT user FROM members WHERE chat=? AND user<>?", c["id"], uid)
        out["peer"] = user_card(other["user"] if other else uid)
    return out


def dm_chat(a, b):
    key = f"{min(a, b)}:{max(a, b)}"
    c = q1("SELECT * FROM chats WHERE dm_key=?", key)
    if c:
        return c
    now = int(time.time())
    with lock:
        db.execute("INSERT OR IGNORE INTO chats (kind, title, about, owner, created, dm_key) VALUES ('dm', '', '', ?, ?, ?)", (a, now, key))
        cid = db.execute("SELECT id FROM chats WHERE dm_key=?", (key,)).fetchone()[0]
        for u in {a, b}:
            db.execute("INSERT OR IGNORE INTO members (chat, user, role) VALUES (?, ?, 'member')", (cid, u))
    return chat_or_404(cid)


def post_message(cid, uid, text="", gift=None, reply=None):
    mid = run("INSERT INTO messages (chat, user, text, gift, reply, created) VALUES (?, ?, ?, ?, ?, ?)",
              cid, uid, text, gift, reply, int(time.time()))
    run("UPDATE members SET read_id=? WHERE chat=? AND user=?", mid, cid, uid)
    notify(cid, uid, text, gift)
    return mid


# ---------- уведомления через бота ----------
last_ping = {}


def tg_call(method, **params):
    data = urllib.parse.urlencode({k: json.dumps(v) if isinstance(v, (dict, list, bool)) else v for k, v in params.items()}).encode()
    with urllib.request.urlopen(f"https://api.telegram.org/bot{TOKEN}/{method}", data=data, timeout=15) as r:
        return json.load(r)


def notify(cid, uid, text, gift):
    """Личные сообщения и подарки: напоминаем в боте тем, кто сейчас не в приложении."""
    c = chat_or_404(cid)
    if c["kind"] != "dm":
        return
    other = q1("SELECT u.id, u.seen FROM members m JOIN users u ON u.id=m.user WHERE m.chat=? AND m.user<>?", cid, uid)
    if not other or time.time() - (other["seen"] or 0) < 60:
        return
    if not gift and time.time() - last_ping.get((cid, other["id"]), 0) < 600:
        return
    last_ping[(cid, other["id"])] = time.time()
    name = user_card(uid)["name"]
    body = f"{name} отправил вам подарок" if gift else f"Новое сообщение от {name}"
    url = f"{SITE}?{urllib.parse.urlencode({'v': VER, 'chat': cid})}"

    def send():
        try:
            tg_call("sendMessage", chat_id=other["id"], text=body,
                    reply_markup={"inline_keyboard": [[{"text": "Открыть", "web_app": {"url": url}}]]})
        except Exception as e:
            print("Уведомление не ушло:", e, flush=True)
    threading.Thread(target=send, daemon=True).start()


# ---------- обработчики ----------
def clean(s, n):
    return re.sub(r"[\u0000-\u0008\u000b-\u001f]", "", str(s or "")).strip()[:n]


def api(method, path, uid, body, query):
    p = path.strip("/").split("/")[1:]          # без "api"
    now = int(time.time())

    if p == ["me"] and method == "POST":
        look = body.get("look")
        if look is not None:
            look = look if isinstance(look, dict) else {}
            ok = {"c1": HEX, "c2": HEX, "cp": HEX, "sym": SYM, "gift": GIFT_ID}
            look = {k: str(look[k]) for k, rx in ok.items() if isinstance(look.get(k), str) and rx.match(look[k])}
            run("UPDATE users SET look=? WHERE id=?", json.dumps(look), uid)
        pending = q1("SELECT COUNT(*) n FROM transfers WHERE to_user=? AND claimed IS NULL", uid)["n"]
        return {"me": user_card(uid), "pending": pending}

    if p == ["chats"] and method == "GET":
        rows = q("SELECT c.* FROM chats c JOIN members m ON m.chat=c.id WHERE m.user=?", uid)
        out = [chat_out(c, uid) for c in rows]
        out = [c for c in out if c["kind"] != "dm" or c["last"]]
        out.sort(key=lambda c: c["last"]["id"] if c["last"] else 0, reverse=True)
        return {"chats": out}

    if p == ["chats"] and method == "POST":
        limit(uid, "create", 5, 3600)
        kind = body.get("kind")
        title = clean(body.get("title"), 48)
        if kind not in ("group", "channel") or not title:
            raise HttpError(400, "bad chat")
        cid = run("INSERT INTO chats (kind, title, about, owner, created) VALUES (?, ?, ?, ?, ?)",
                  kind, title, clean(body.get("about"), 200), uid, now)
        run("INSERT INTO members (chat, user, role) VALUES (?, ?, 'owner')", cid, uid)
        return chat_out(chat_or_404(cid), uid)

    if p == ["dm"] and method == "POST":
        other = int(body.get("user") or 0)
        if not q1("SELECT id FROM users WHERE id=?", other):
            raise HttpError(404, "no user")
        return chat_out(dm_chat(uid, other), uid)

    if p == ["search"] and method == "GET":
        s = clean(query.get("q", [""])[0], 32).lstrip("@").lower()
        if len(s) < 2:
            return {"users": [], "chats": []}
        like = f"%{s}%"
        users = q("SELECT id FROM users WHERE id<>? AND (ulower(username) LIKE ? OR ulower(name) LIKE ?) ORDER BY seen DESC LIMIT 20", uid, like, like)
        chats = q("SELECT * FROM chats WHERE kind<>'dm' AND ulower(title) LIKE ? ORDER BY id DESC LIMIT 20", like)
        return {"users": [user_card(u["id"]) for u in users], "chats": [chat_out(c, uid) for c in chats]}

    if len(p) == 2 and p[0] == "user" and method == "GET":
        return user_card(int(p[1]))

    if len(p) >= 2 and p[0] == "chat":
        cid = int(p[1])
        c = chat_or_404(cid)
        me = member(cid, uid)
        public = c["kind"] != "dm"
        if not me and not public:
            raise HttpError(403, "not a member")
        sub = p[2] if len(p) > 2 else ""

        if sub == "" and method == "GET":
            return chat_out(c, uid)

        if sub == "messages" and method == "GET":
            after = int(query.get("after", ["0"])[0] or 0)
            before = int(query.get("before", ["0"])[0] or 0)
            if after:
                rows = q("SELECT * FROM messages WHERE chat=? AND id>? ORDER BY id LIMIT 100", cid, after)
            else:
                rows = q("SELECT * FROM messages WHERE chat=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 50", cid, before, before)[::-1]
            if me and rows:
                run("UPDATE members SET read_id=MAX(read_id, ?) WHERE chat=? AND user=?", rows[-1]["id"], cid, uid)
            cache = {}
            return {"messages": [msg_out(m, cache) for m in rows]}

        if sub == "messages" and method == "POST":
            if not me:
                raise HttpError(403, "join first")
            if c["kind"] == "channel" and me["role"] not in ("owner", "admin"):
                raise HttpError(403, "only admins post in channels")
            limit(uid, "msg", 20, 10)
            text = clean(body.get("text"), 2000)
            if not text:
                raise HttpError(400, "empty")
            reply = body.get("reply")
            reply = int(reply) if reply and q1("SELECT id FROM messages WHERE id=? AND chat=?", int(reply), cid) else None
            mid = post_message(cid, uid, text, None, reply)
            return msg_out(q1("SELECT * FROM messages WHERE id=?", mid), {})

        if sub == "join" and method == "POST":
            if public and not me:
                run("INSERT OR IGNORE INTO members (chat, user, role) VALUES (?, ?, 'member')", cid, uid)
            return chat_out(c, uid)

        if sub == "leave" and method == "POST":
            if me and me["role"] != "owner":
                run("DELETE FROM members WHERE chat=? AND user=?", cid, uid)
            return {"ok": True}

        if sub == "members" and method == "GET":
            rows = q("SELECT user, role FROM members WHERE chat=? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 200", cid)
            return {"members": [{**user_card(r["user"]), "role": r["role"]} for r in rows]}

        if sub == "admin" and method == "POST":     # владелец назначает админа канала или группы
            if not me or me["role"] != "owner":
                raise HttpError(403, "owner only")
            target, on = int(body.get("user") or 0), bool(body.get("on"))
            run("UPDATE members SET role=? WHERE chat=? AND user=? AND role<>'owner'", "admin" if on else "member", cid, target)
            return {"ok": True}

    if p == ["gift", "send"] and method == "POST":
        limit(uid, "gift", 10, 60)
        to, gift = int(body.get("to") or 0), clean(body.get("gift"), 8)
        if to == uid or not GIFT_ID.match(gift) or not q1("SELECT id FROM users WHERE id=?", to):
            raise HttpError(400, "bad gift")
        c = dm_chat(uid, to)
        mid = post_message(c["id"], uid, clean(body.get("text"), 200), gift)
        run("INSERT INTO transfers (from_user, to_user, gift, msg, created) VALUES (?, ?, ?, ?, ?)", uid, to, gift, mid, now)
        return {"chat": c["id"], "message": msg_out(q1("SELECT * FROM messages WHERE id=?", mid), {})}

    if p == ["gift", "incoming"] and method == "GET":
        rows = q("SELECT * FROM transfers WHERE to_user=? AND claimed IS NULL ORDER BY id", uid)
        return {"gifts": [{"id": r["id"], "gift": r["gift"], "msg": r["msg"], "from": user_card(r["from_user"])} for r in rows]}

    if len(p) == 3 and p[:2] == ["gift", "claim"] and method == "POST":
        tid = int(p[2])
        with lock:   # забрать подарок можно ровно один раз
            cur = db.execute("UPDATE transfers SET claimed=? WHERE id=? AND to_user=? AND claimed IS NULL", (now, tid, uid))
            ok = cur.rowcount == 1
        if not ok:
            raise HttpError(409, "already claimed")
        return {"gift": q1("SELECT gift FROM transfers WHERE id=?", tid)["gift"]}

    raise HttpError(404, "not found")


class Handler(BaseHTTPRequestHandler):
    server_version = "DuckChance"

    def log_message(self, fmt, *args):
        pass

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS or (DEV and origin.startswith("http://127.0.0.1")):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Dev-User")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Max-Age", "86400")

    def reply(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def handle_api(self, method):
        try:
            url = urllib.parse.urlparse(self.path)
            if url.path == "/health":
                return self.reply(200, {"ok": True})
            if not url.path.startswith("/api/"):
                raise HttpError(404, "not found")
            auth = self.headers.get("Authorization", "")
            if auth.startswith("tma "):
                uid = touch_user(check_init_data(auth[4:]))
            elif DEV and self.headers.get("X-Dev-User"):
                did, _, name = self.headers["X-Dev-User"].partition(":")
                uid = touch_user({"id": int(did), "first_name": urllib.parse.unquote(name) or f"Тест {did}", "username": f"test{did}"})
            else:
                raise HttpError(401, "no auth")
            body = {}
            if method == "POST":
                n = int(self.headers.get("Content-Length") or 0)
                if n > 16384:
                    raise HttpError(413, "too big")
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
                if not isinstance(body, dict):
                    raise HttpError(400, "bad body")
            self.reply(200, api(method, url.path, uid, body, urllib.parse.parse_qs(url.query)))
        except HttpError as e:
            self.reply(e.code, {"error": e.text})
        except (ValueError, KeyError, TypeError) as e:
            self.reply(400, {"error": "bad request"})
        except Exception as e:
            print("Ошибка:", repr(e), flush=True)
            self.reply(500, {"error": "server error"})

    def do_GET(self):
        self.handle_api("GET")

    def do_POST(self):
        self.handle_api("POST")


def main():
    if os.environ.get("BOT") == "1":
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        import bot_poller
        threading.Thread(target=bot_poller.main, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Сервер DuckChance на 127.0.0.1:{PORT}" + (" (режим проверки)" if DEV else ""), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
