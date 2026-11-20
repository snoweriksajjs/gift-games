"""Сервер DuckChance: чаты, группы и каналы как в Telegram, юзернеймы, передача подарков.

Запуск:  TG_TOKEN=<токен бота> python3 server/app.py
Переменные окружения:
  TG_TOKEN   токен бота (обязательно). Им проверяется подпись initData из Telegram.
  PORT       порт (по умолчанию 8787). Снаружи сервер закрывает nginx с HTTPS.
  DB         путь к базе SQLite (по умолчанию duckchance.db)
  MEDIA      папка для загруженных фото (по умолчанию media рядом с базой)
  PUBLIC     внешний адрес сервера, нужен для картинок в приглашениях
  ORIGIN     адрес сайта, которому разрешены запросы (по умолчанию GitHub Pages)
  BOT        1, чтобы в этом же процессе работал бот (оплата, приглашения, уведомления)
  BOT_NAME   имя бота без @ для ссылок-приглашений
  DEV        1 только для проверки на своём компьютере: вход без Telegram по заголовку X-Dev-User

Только стандартная библиотека Python 3.9+.
"""
import base64, hashlib, hmac, json, os, re, sqlite3, sys, threading, time, urllib.parse, urllib.request


MONEY = re.compile(r"^/api/(w/|grants/claim|gift/(send|claim)|crash/bet|arena/(join|leave)|promo$|task/check)")


def no_nan(c):
    """NaN и Infinity в запросе не принимаем: иначе ответы сервера перестают быть JSON."""
    raise ValueError("bad number " + c)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("TG_TOKEN") or sys.exit("Нужна переменная окружения TG_TOKEN")
PORT = int(os.environ.get("PORT", "8787"))
DB_PATH = os.environ.get("DB", "duckchance.db")
MEDIA = os.environ.get("MEDIA") or os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "media")
PUBLIC = os.environ.get("PUBLIC", "https://duck.2-27-12-205.sslip.io").rstrip("/")
ORIGINS = set(os.environ.get("ORIGIN", "https://snoweriksajjs.github.io").split(","))
DEV = os.environ.get("DEV") == "1"
SITE = os.environ.get("SITE", "https://snoweriksajjs.github.io/gift-games/")
VER = os.environ.get("APP_VER", "29")
BOT_NAME = os.environ.get("BOT_NAME", "DuckChanceApp")
AUTH_TTL = 7 * 86400          # сколько живёт подпись initData
GIFT_ID = re.compile(r"^(g\d{1,4}|c\d{1,3}\.\d{1,3}\.\d{1,3})$")   # старый номер или «коллекция.модель.фон»
HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")
SYM = re.compile(r"^https://cdn\.changes\.tg/[^\"'()\s]{1,200}$")
HANDLE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{3,23}$")
MEDIA_NAME = re.compile(r"^[0-9a-f]{20}\.(jpg|mp4|mp3|m4a|ogg|wav)$")
MEDIA_TYPES = {"jpg": "image/jpeg", "mp4": "video/mp4", "mp3": "audio/mpeg", "m4a": "audio/mp4", "ogg": "audio/ogg", "wav": "audio/wav"}
RAW_MAX = 15_000_000          # музыка и видео для историй


def sniff(raw, kind):
    """Тип файла по первым байтам, а не по имени: сохраняем только то, что действительно аудио, видео или фото."""
    if raw[:3] == b"\xff\xd8\xff":
        return "jpg"
    if raw[:3] == b"ID3" or (raw[:1] == b"\xff" and raw[1:2] and raw[1] & 0xE0 == 0xE0):
        return "mp3"
    if raw[:4] == b"OggS":
        return "ogg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        return "wav"
    if raw[4:8] == b"ftyp":
        return "m4a" if kind == "audio" else "mp4"
    return None


def clean_media(url, exts):
    """Ссылка на наш файл нужного типа, иначе пусто."""
    name = (url or "").rsplit("/", 1)[-1]
    if not (url or "").startswith(PUBLIC + "/media/") or not MEDIA_NAME.match(name) or name.rsplit(".", 1)[1] not in exts:
        return ""
    return url if os.path.exists(os.path.join(MEDIA, name)) else ""
# текст под реферальным баннером: его видят друзья, которым его переслали
REF_CAPTION = ("🎁 <b>Залетай в DuckChance</b>\n\n"
               "Тут выбивают NFT-подарки Telegram: Plush Pepe, Durov's Cap, Heart Locket и ещё полсотни коллекций.\n\n"
               "🥚 Каждый день бесплатное яйцо с подарком внутри\n"
               "⚡ Апгрейд, краш, арена: раунд длится секунды\n"
               "🔒 Шанс виден до ставки\n\n"
               "Жми кнопку и забирай первое яйцо 👇")
RESERVED = {"admin", "admins", "support", "duckchance", "telegram", "settings", "official", "moderator"}

# права админа и разрешения участников, как в Telegram
ADMIN_RIGHTS = ["info", "post", "delete", "ban", "invite", "pin", "promote"]
MEMBER_PERMS = ["send", "media", "gifts", "invite", "pin"]
DEFAULT_PERMS = {"send": True, "media": True, "gifts": True, "invite": True, "pin": False}
DEFAULT_ADMIN = {"info": True, "post": True, "delete": True, "ban": True, "invite": True, "pin": True, "promote": False}

os.makedirs(MEDIA, exist_ok=True)

# ---------- база ----------
db = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
db.row_factory = sqlite3.Row
db.execute("PRAGMA journal_mode=WAL")
db.create_function("ulower", 1, lambda x: (x or "").lower())   # встроенный lower() в SQLite не знает кириллицу
lock = threading.RLock()
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
CREATE TABLE IF NOT EXISTS bans (chat INTEGER, user INTEGER, PRIMARY KEY (chat, user));
CREATE TABLE IF NOT EXISTS blocks (user INTEGER, target INTEGER, at INTEGER, PRIMARY KEY (user, target));
""")


def add_column(table, col, decl):
    cols = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
    if col not in cols:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


# новые поля поверх первой версии базы
for t, c, d in [("users", "created", "INTEGER"), ("users", "balance", "INTEGER"), ("users", "staked", "INTEGER"), ("users", "handle", "TEXT"), ("users", "gifts", "TEXT"), ("users", "bio", "TEXT"),
                ("chats", "photo", "TEXT"), ("chats", "look", "TEXT"), ("chats", "handle", "TEXT"),
                ("chats", "perms", "TEXT"), ("chats", "pinned", "INTEGER"), ("chats", "private", "INTEGER"), ("chats", "verified", "INTEGER"), ("chats", "check_style", "TEXT"),
                ("members", "title", "TEXT"), ("members", "muted", "INTEGER"), ("members", "rights", "TEXT"), ("members", "joined", "INTEGER"),
                ("transfers", "inv", "INTEGER"), ("messages", "kind", "TEXT DEFAULT 'text'"), ("messages", "data", "TEXT"), ("messages", "deleted", "INTEGER")]:
    add_column(t, c, d)
db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_handle ON users (handle COLLATE NOCASE)")
db.execute("CREATE UNIQUE INDEX IF NOT EXISTS chats_handle ON chats (handle COLLATE NOCASE)")


def q(sql, *args):
    with lock:
        return [dict(r) for r in db.execute(sql, args).fetchall()]


def q1(sql, *args):
    r = q(sql, *args)
    return r[0] if r else None


def run(sql, *args):
    with lock:
        return db.execute(sql, args).lastrowid


def jload(s, default=None):
    try:
        return json.loads(s) if s else default
    except ValueError:
        return default


class HttpError(Exception):
    def __init__(self, code, text):
        super().__init__(text)
        self.code, self.text = code, text


# ---------- вход через Telegram ----------
# подпись проверяем ключом текущего бота; TG_TOKEN_OLD — прежние боты на время переезда (через запятую)
SECRETS = [hmac.new(b"WebAppData", t.encode(), hashlib.sha256).digest()
           for t in [TOKEN] + [x for x in os.environ.get("TG_TOKEN_OLD", "").split(",") if x]]


def check_init_data(raw):
    """Проверяет подпись initData по документации Telegram и возвращает пользователя."""
    pairs = dict(urllib.parse.parse_qsl(raw, keep_blank_values=True))
    got = pairs.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    ok = any(hmac.compare_digest(hmac.new(k, check.encode(), hashlib.sha256).hexdigest(), got) for k in SECRETS)
    if not got or not ok:
        raise HttpError(401, "bad signature")
    if time.time() - int(pairs.get("auth_date", "0")) > AUTH_TTL:
        raise HttpError(401, "expired")
    return json.loads(pairs.get("user", "{}"))


def handle_free(h, me_user=None, me_chat=None):
    if not HANDLE.match(h or "") or h.lower() in RESERVED:
        return False
    u = q1("SELECT id FROM users WHERE handle=? COLLATE NOCASE", h)
    c = q1("SELECT id FROM chats WHERE handle=? COLLATE NOCASE", h)
    t = q1("SELECT user FROM tags WHERE tag=? COLLATE NOCASE", h) if "profiles" in globals() else None
    return (not u or u["id"] == me_user) and (not c or c["id"] == me_chat) and not t


def touch_user(u):
    uid = int(u["id"])
    name = " ".join(x for x in [u.get("first_name"), u.get("last_name")] if x)[:64] or "Игрок"
    tgname = (u.get("username") or "")[:32]
    with lock:
        fresh = not db.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone()
        db.execute("""INSERT INTO users (id, name, username, photo, seen) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username, photo=excluded.photo, seen=excluded.seen""",
                   (uid, name, tgname, (u.get("photo_url") or "")[:300], int(time.time())))
        # новичку юзернейм из Telegram, если он свободен
        if fresh:
            db.execute("UPDATE users SET created=? WHERE id=?", (int(time.time()), uid))
        if fresh and tgname and handle_free(tgname, uid):
            db.execute("UPDATE users SET handle=? WHERE id=?", (tgname, uid))
    return uid


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
def clean(s, n):
    return re.sub(r"[\u0000-\u0008\u000b-\u001f]", "", str(s or "")).strip()[:n]


def clean_look(look):
    look = look if isinstance(look, dict) else {}
    ok = {"c1": HEX, "c2": HEX, "cp": HEX, "sym": SYM, "gift": GIFT_ID}
    return {k: str(look[k]) for k, rx in ok.items() if isinstance(look.get(k), str) and rx.match(look[k])}


def clean_photo(url):
    url = str(url or "")
    name = url.rsplit("/", 1)[-1]
    return f"{PUBLIC}/media/{name}" if url.startswith(PUBLIC + "/media/") and MEDIA_NAME.match(name) and name.endswith(".jpg") else ""


def user_card(uid, full=False):
    u = q1("SELECT id, name, username, handle, photo, look, seen, gifts, bio FROM users WHERE id=?", uid)
    if not u:
        return {"id": uid, "name": "Игрок", "handle": "", "photo": "", "look": None, "seen": 0}
    out = {"id": u["id"], "name": u["name"], "handle": u["handle"] or "", "photo": u["photo"] or "",
           "look": jload(u["look"]), "seen": u["seen"] or 0}
    if full:
        out["gifts"] = jload(u["gifts"], [])
        out["bio"] = u["bio"] or ""
    if "profiles" in globals():
        out.update(profiles.extra(uid, full))
    return out


def blocked(by, who):
    """by заблокировал who: who не может писать by в личку и дарить ему подарки."""
    return bool(q1("SELECT 1 x FROM blocks WHERE user=? AND target=?", by, who))


def invited(cid, uid):
    """В закрытую группу или канал можно войти, только если участник прислал приглашение в личные сообщения."""
    return bool(q1("""SELECT 1 x FROM messages m JOIN members mm ON mm.chat=m.chat AND mm.user=? JOIN chats c ON c.id=m.chat
                      WHERE c.kind='dm' AND m.kind='invite' AND m.deleted IS NULL AND m.data=?""", uid, json.dumps({"chat": cid})))


def member(chat, uid):
    m = q1("SELECT role, read_id, title, rights, muted FROM members WHERE chat=? AND user=?", chat, uid)
    if m:
        m["rights"] = jload(m["rights"], {})
    return m


def can(c, me, right):
    """Может ли участник сделать действие. Владелец может всё, админ по своим правам, участник группы по разрешениям чата."""
    if not me:
        return False
    if me["role"] == "owner":
        return True
    if me["role"] == "admin":
        if right in ("send", "media", "gifts"):
            return True
        return bool(me["rights"].get(right))
    if c["kind"] == "group" and right in MEMBER_PERMS:
        return bool({**DEFAULT_PERMS, **jload(c["perms"], {})}.get(right))
    return c["kind"] == "dm" and right in ("send", "media", "gifts")


def msg_out(m, cache):
    if m["user"] not in cache:
        cache[m["user"]] = user_card(m["user"])
    out = {"id": m["id"], "chat": m["chat"], "user": cache[m["user"]], "kind": m.get("kind") or "text",
           "text": m["text"] or "", "gift": m["gift"], "data": jload(m.get("data"), {}), "reply": m["reply"], "created": m["created"]}
    if out["kind"] == "invite" and out["data"].get("chat"):
        c = q1("SELECT * FROM chats WHERE id=?", out["data"]["chat"])
        out["data"]["card"] = chat_card(c) if c else None
    if m.get("deleted"):
        out.update(kind="deleted", text="", gift=None, data={})
    return out


def chat_or_404(cid):
    c = q1("SELECT * FROM chats WHERE id=?", cid)
    if not c:
        raise HttpError(404, "no chat")
    return c


def chat_card(c):
    """Короткая карточка группы или канала: для приглашений и поиска."""
    owner = user_card(c["owner"])
    return {"id": c["id"], "kind": c["kind"], "title": c["title"], "about": c["about"] or "", "photo": c["photo"] or "",
            "look": jload(c["look"]), "handle": c["handle"] or "", "owner": {"id": owner["id"], "name": owner["name"], "handle": owner["handle"]},
            "members": q1("SELECT COUNT(*) n FROM members WHERE chat=?", c["id"])["n"]}


def chat_out(c, uid, full=False):
    me = member(c["id"], uid)
    last = q1("SELECT * FROM messages WHERE chat=? ORDER BY id DESC LIMIT 1", c["id"])
    out = {"id": c["id"], "kind": c["kind"], "title": c["title"], "about": c["about"] or "", "owner": c["owner"],
           "photo": c["photo"] or "", "look": jload(c["look"]), "handle": c["handle"] or "",
           "role": me["role"] if me else None, "my_title": me["title"] if me else "",
           "private": bool(c["private"]), "muted": bool(me and me.get("muted")),
           "verified": bool(c["verified"]), "check": (c["check_style"] or "classic") if c["verified"] else None,
           "members": q1("SELECT COUNT(*) n FROM members WHERE chat=?", c["id"])["n"],
           "last": msg_out(last, {}) if last else None,
           "unread": q1("SELECT COUNT(*) n FROM messages WHERE chat=? AND id>? AND user<>?", c["id"], me["read_id"], uid)["n"] if me else 0}
    if c["kind"] == "dm":
        other = q1("SELECT user, read_id FROM members WHERE chat=? AND user<>?", c["id"], uid)
        out["peer"] = user_card(other["user"] if other else uid)
        out["peer_read"] = other["read_id"] if other else 0
    if full:
        out["perms"] = {**DEFAULT_PERMS, **jload(c["perms"], {})}
        out["can"] = {r: can(c, me, r) for r in ADMIN_RIGHTS + MEMBER_PERMS}
        out["banned"] = bool(q1("SELECT 1 x FROM bans WHERE chat=? AND user=?", c["id"], uid))
        pin = q1("SELECT * FROM messages WHERE id=? AND chat=? AND deleted IS NULL", c["pinned"], c["id"]) if c["pinned"] else None
        out["pinned"] = msg_out(pin, {}) if pin else None
        if c["kind"] != "dm":
            out["owner_card"] = user_card(c["owner"])
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
            db.execute("INSERT OR IGNORE INTO members (chat, user, role, joined) VALUES (?, ?, 'member', ?)", (cid, u, now))
    return chat_or_404(cid)


def post_message(cid, uid, text="", gift=None, reply=None, kind="text", data=None, ping=True):
    mid = run("INSERT INTO messages (chat, user, kind, text, gift, data, reply, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              cid, uid, kind, text, gift, json.dumps(data, ensure_ascii=False) if data else None, reply, int(time.time()))
    run("UPDATE members SET read_id=? WHERE chat=? AND user=?", mid, cid, uid)
    typing.get(cid, {}).pop(uid, None)
    if ping:
        notify(cid, uid, text, gift)
    return mid


def service(cid, uid, action, **data):
    """Служебное сообщение посередине чата: создал группу, вступил, сменил фото и так далее."""
    return post_message(cid, uid, kind="service", data={"action": action, **data}, ping=False)


# ---------- «печатает» ----------
typing = {}


def typing_now(cid, uid):
    now = time.time()
    t = typing.get(cid, {})
    return [user_card(u)["name"] for u, ts in list(t.items()) if u != uid and now - ts < 5][:3]


# ---------- уведомления через бота ----------
last_ping = {}


def tg_call(method, **params):
    data = urllib.parse.urlencode({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list, bool)) else v for k, v in params.items()}).encode()
    with urllib.request.urlopen(f"https://api.telegram.org/bot{TOKEN}/{method}", data=data, timeout=15) as r:
        return json.load(r)


def notify(cid, uid, text, gift):
    """Личные сообщения и подарки: напоминаем в боте тем, кто сейчас не в приложении."""
    c = chat_or_404(cid)
    if c["kind"] != "dm":
        return
    other = q1("SELECT u.id, u.seen, m.muted FROM members m JOIN users u ON u.id=m.user WHERE m.chat=? AND m.user<>?", cid, uid)
    if not other or other["muted"] or blocked(other["id"], uid) or time.time() - (other["seen"] or 0) < 60:
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


def save_jpeg(data_url, max_bytes=700_000):
    m = re.match(r"^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$", data_url or "")
    if not m:
        raise HttpError(400, "jpeg only")
    raw = base64.b64decode(m.group(1))
    if len(raw) > max_bytes or raw[:3] != b"\xff\xd8\xff":
        raise HttpError(400, "bad image")
    name = hashlib.sha256(raw).hexdigest()[:20] + ".jpg"
    path = os.path.join(MEDIA, name)
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(raw)
    return f"{PUBLIC}/media/{name}"


# ---------- обработчики ----------
def api(method, path, uid, body, query):
    p = [urllib.parse.unquote(x) for x in path.strip("/").split("/")[1:]]   # без "api"; кириллица в кодах промокодов
    now = int(time.time())
    r = admin.handle(method, p, uid, body, query, now)   # настройки, промокоды, задания, выдачи, админка
    if r is None:
        r = bank.handle(method, p, uid, body, query, now)  # кошелёк: состояние, раунды, продажа, стейкинг
    if r is None:
        r = profiles.handle(method, p, uid, body, query, now)   # юзернеймы, галочка, музыка, истории
    if r is None:
        r = games.handle(method, p, uid, body, query, now)   # онлайн-краш, арена, лента выигрышей
    if r is not None:
        return r

    if p == ["me"] and method == "POST":
        sets = []
        if body.get("look") is not None:
            sets.append(("look", json.dumps(clean_look(body["look"]))))
        with lock:   # соединение с базой одно на все потоки: читаем только под общей блокировкой
            w = bank.wallet(uid)
            rows = db.execute("SELECT gift, stake FROM inventory WHERE user=?", (uid,)).fetchall() if w else []
        if w:   # деньги ведёт сервер: баланс, подарки и статистику берём из кошелька, а не с телефона
            st = bank.stats_of(w)
            gifts = [r["gift"] for r in rows]
            gifts.sort(key=lambda g: -(catalog.get(g) or {"price": 0})["price"])
            staked = sum(json.loads(r["stake"])["reward"] for r in rows if r["stake"])
            sets += [("gifts", json.dumps(gifts[:60])), ("balance", w["balance"]), ("staked", staked),
                     ("wagered", int(st.get("wagered", 0))), ("won", int(st.get("won", 0)))]
        if body.get("bio") is not None:
            sets.append(("bio", clean(body["bio"], 140)))
        for k, v in sets:
            run(f"UPDATE users SET {k}=? WHERE id=?", v, uid)
        pending = q1("SELECT COUNT(*) n FROM transfers WHERE to_user=? AND claimed IS NULL", uid)["n"]
        grants = q1("SELECT COUNT(*) n FROM grants WHERE user=? AND claimed IS NULL AND hold IS NULL", uid)["n"]
        profiles.tg_music_soon(uid)      # песни из профиля Telegram подтянем в фоне
        return {"me": user_card(uid, True), "pending": pending, "grants": grants, "admin": uid in admin.ADMINS}

    if p == ["handle"] and method == "GET":
        h = clean(query.get("h", [""])[0], 24).lstrip("@")
        ok_len = len(h) >= (1 if uid in admin.ADMINS else 5)
        return {"free": profiles.tag_ok(h, uid), "valid": bool(profiles.TAG.match(h)) and ok_len, "min": 1 if uid in admin.ADMINS else 5}

    if p == ["handle"] and method == "POST":
        limit(uid, "handle", 10, 3600)
        h = clean(body.get("handle"), 24).lstrip("@")
        if h == "":
            run("UPDATE users SET handle=NULL WHERE id=?", uid)
            return {"me": user_card(uid, True)}
        if not profiles.tag_ok(h, uid) or q1("SELECT 1 x FROM tags WHERE tag=? COLLATE NOCASE AND user=?", h, uid):
            raise HttpError(409, "taken" if len(h) >= (1 if uid in admin.ADMINS else 5) else "short")
        try:
            run("UPDATE users SET handle=? WHERE id=?", h, uid)
        except sqlite3.IntegrityError:
            raise HttpError(409, "taken")
        return {"me": user_card(uid, True)}

    if p == ["resolve"] and method == "GET":
        h = clean(query.get("h", [""])[0], 24).lstrip("@")
        u = q1("SELECT id FROM users WHERE handle=? COLLATE NOCASE", h) or q1("SELECT user AS id FROM tags WHERE tag=? COLLATE NOCASE", h)
        if u:
            return {"user": user_card(u["id"], True)}
        c = q1("SELECT * FROM chats WHERE handle=? COLLATE NOCASE", h)
        if c:
            return {"chat": chat_card(c)}
        raise HttpError(404, "not found")

    if p == ["upload"] and method == "POST":
        limit(uid, "upload", 30, 3600)
        url = save_jpeg(body.get("data"))
        return {"url": url}

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
        cid = run("INSERT INTO chats (kind, title, about, owner, created, photo, look, private) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                  kind, title, clean(body.get("about"), 255), uid, now, clean_photo(body.get("photo")),
                  json.dumps(clean_look(body.get("look"))) if body.get("look") else None, 1 if body.get("private") else None)
        run("INSERT INTO members (chat, user, role, joined) VALUES (?, ?, 'owner', ?)", cid, uid, now)
        service(cid, uid, "created", title=title)
        return chat_out(chat_or_404(cid), uid, True)

    if p == ["dm"] and method == "POST":
        other = int(body.get("user") or 0)
        if not q1("SELECT id FROM users WHERE id=?", other):
            raise HttpError(404, "no user")
        return chat_out(dm_chat(uid, other), uid, True)

    if p == ["search"] and method == "GET":
        s = clean(query.get("q", [""])[0], 32).lstrip("@").lower()
        if len(s) < 2:
            return {"users": [], "chats": []}
        like = f"%{s}%"
        users = q("""SELECT id FROM users WHERE id<>? AND (ulower(handle) LIKE ? OR ulower(name) LIKE ?)
                     ORDER BY CASE WHEN ulower(handle)=? THEN 0 ELSE 1 END, seen DESC LIMIT 20""", uid, like, like, s)
        chats = q("""SELECT * FROM chats WHERE kind<>'dm' AND private IS NULL AND (ulower(title) LIKE ? OR ulower(handle) LIKE ?)
                     ORDER BY CASE WHEN ulower(handle)=? THEN 0 ELSE 1 END, id DESC LIMIT 20""", like, like, s)
        return {"users": [user_card(u["id"]) for u in users], "chats": [chat_out(c, uid) for c in chats]}

    if len(p) == 2 and p[0] == "user" and method == "GET":
        tid = int(p[1])
        profiles.viewed(tid, uid, now)
        return user_card(tid, True) | {"blocked": blocked(uid, tid)}

    if p == ["block"] and method == "POST":
        tid = int(body.get("user") or 0)
        if tid == uid or not q1("SELECT id FROM users WHERE id=?", tid):
            raise HttpError(400, "bad user")
        if body.get("on"):
            run("INSERT OR IGNORE INTO blocks (user, target, at) VALUES (?, ?, ?)", uid, tid, now)
        else:
            run("DELETE FROM blocks WHERE user=? AND target=?", uid, tid)
        return {"blocked": bool(body.get("on"))}

    if len(p) >= 2 and p[0] == "chat":
        cid = int(p[1])
        c = chat_or_404(cid)
        me = member(cid, uid)
        sub = p[2] if len(p) > 2 else ""
        public = c["kind"] != "dm" and not c["private"]
        # закрытую группу или канал видит только участник, а приглашённый видит карточку и может вступить
        guest_ok = c["kind"] != "dm" and invited(cid, uid) and sub in ("", "card", "join")
        if not me and not public and not guest_ok:
            raise HttpError(403, "not a member")

        if sub == "" and method == "GET":
            return chat_out(c, uid, True)

        if sub == "card" and method == "GET":
            return chat_card(c)

        if sub == "messages" and method == "GET":
            after = int(query.get("after", ["0"])[0] or 0)
            before = int(query.get("before", ["0"])[0] or 0)
            if after:
                rows = q("SELECT * FROM messages WHERE chat=? AND id>? ORDER BY id LIMIT 100", cid, after)
            else:
                rows = q("SELECT * FROM messages WHERE chat=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 60", cid, before, before)[::-1]
            if me and rows:
                run("UPDATE members SET read_id=MAX(read_id, ?) WHERE chat=? AND user=?", rows[-1]["id"], cid, uid)
            cache = {}
            out = {"messages": [msg_out(m, cache) for m in rows], "typing": typing_now(cid, uid)}
            # удалённые и правки после последнего опроса
            since = int(query.get("since", ["0"])[0] or 0)
            if since:
                out["deleted"] = [r["id"] for r in q("SELECT id FROM messages WHERE chat=? AND deleted>=?", cid, since)]
            if c["kind"] == "dm":
                other = q1("SELECT read_id FROM members WHERE chat=? AND user<>?", cid, uid)
                out["peer_read"] = other["read_id"] if other else 0
            out["now"] = now
            out["pinned"] = c["pinned"] or 0
            return out

        if sub == "messages" and method == "POST":
            if not me:
                raise HttpError(403, "join first")
            if c["kind"] == "channel" and not can(c, me, "post"):
                raise HttpError(403, "only admins post in channels")
            photo = body.get("photo") if isinstance(body.get("photo"), dict) else None
            invite = int(body.get("invite") or 0)
            if c["kind"] != "channel" and not can(c, me, "send"):
                raise HttpError(403, "no rights")
            if c["kind"] == "dm":
                peer = q1("SELECT user FROM members WHERE chat=? AND user<>?", cid, uid)
                if peer and blocked(peer["user"], uid):
                    raise HttpError(403, "blocked")
            if photo and not can(c, me, "media") and c["kind"] != "channel":
                raise HttpError(403, "no media")
            limit(uid, "msg", 20, 10)
            text = clean(body.get("text"), 4000)
            reply = body.get("reply")
            reply = int(reply) if reply and q1("SELECT id FROM messages WHERE id=? AND chat=?", int(reply), cid) else None
            if photo:
                url = clean_photo(photo.get("url"))
                if not url:
                    raise HttpError(400, "bad photo")
                w, h = int(photo.get("w") or 0), int(photo.get("h") or 0)
                mid = post_message(cid, uid, text, None, reply, "photo", {"url": url, "w": max(1, min(w, 4000)), "h": max(1, min(h, 4000))})
            elif invite:
                ic = chat_or_404(invite)
                if ic["kind"] == "dm":
                    raise HttpError(400, "bad invite")
                if ic["private"] and not member(invite, uid):
                    raise HttpError(403, "not a member")
                mid = post_message(cid, uid, text, None, reply, "invite", {"chat": invite})
            else:
                if not text:
                    raise HttpError(400, "empty")
                mid = post_message(cid, uid, text, None, reply)
            return msg_out(q1("SELECT * FROM messages WHERE id=?", mid), {})

        if sub == "verify" and method == "POST":       # галочка группы или канала: владелец покупает, админ выдаёт и снимает
            if c["kind"] == "dm":
                raise HttpError(400, "not a chat")
            if body.get("admin"):
                if uid not in admin.ADMINS:
                    raise HttpError(403, "admins only")
                run("UPDATE chats SET verified=? WHERE id=?", 1 if body.get("on") else None, cid)
                return chat_out(chat_or_404(cid), uid, True)
            if not me or me["role"] != "owner":
                raise HttpError(403, "owner only")
            if c["verified"]:
                raise HttpError(409, "already verified")
            with bank.tx():
                bank.need(uid)
                bank.move(uid, -profiles.CHECK_PRICE, f"галочка чата {cid}")
                db.execute("UPDATE chats SET verified=1 WHERE id=?", (cid,))
                st = bank.state(uid)
            return chat_out(chat_or_404(cid), uid, True) | {"state": st}

        if sub == "check" and method == "POST":        # дизайн галочки чата
            if not me or me["role"] != "owner" or not c["verified"]:
                raise HttpError(403, "owner only")
            if body.get("check") not in profiles.CHECKS:
                raise HttpError(400, "bad check")
            run("UPDATE chats SET check_style=? WHERE id=?", body["check"], cid)
            return chat_out(chat_or_404(cid), uid, True)

        if sub == "mute" and method == "POST":         # без звука: бот не присылает уведомления из этого чата
            if not me:
                raise HttpError(403, "not a member")
            run("UPDATE members SET muted=? WHERE chat=? AND user=?", 1 if body.get("on") else None, cid, uid)
            return {"muted": bool(body.get("on"))}

        if sub == "typing" and method == "POST":
            if me:
                typing.setdefault(cid, {})[uid] = time.time()
            return {"ok": True}

        if sub == "delete" and method == "POST":
            m = q1("SELECT * FROM messages WHERE id=? AND chat=?", int(body.get("msg") or 0), cid)
            if not m or not me:
                raise HttpError(404, "no message")
            if m["user"] != uid and not can(c, me, "delete"):
                raise HttpError(403, "no rights")
            run("UPDATE messages SET deleted=? WHERE id=?", now, m["id"])
            if c["pinned"] == m["id"]:
                run("UPDATE chats SET pinned=NULL WHERE id=?", cid)
            return {"ok": True}

        if sub == "pin" and method == "POST":
            if not can(c, me, "pin"):
                raise HttpError(403, "no rights")
            mid = int(body.get("msg") or 0)
            if mid and not q1("SELECT id FROM messages WHERE id=? AND chat=? AND deleted IS NULL", mid, cid):
                raise HttpError(404, "no message")
            run("UPDATE chats SET pinned=? WHERE id=?", mid or None, cid)
            if mid:
                service(cid, uid, "pinned", msg=mid)
            return {"ok": True}

        if sub == "edit" and method == "POST":
            if c["kind"] == "dm" or not can(c, me, "info"):
                raise HttpError(403, "no rights")
            if "private" in body and me and me["role"] == "owner":
                run("UPDATE chats SET private=? WHERE id=?", 1 if body["private"] else None, cid)
            if "title" in body:
                t = clean(body["title"], 48)
                if t and t != c["title"]:
                    run("UPDATE chats SET title=? WHERE id=?", t, cid)
                    service(cid, uid, "title", title=t)
            if "about" in body:
                run("UPDATE chats SET about=? WHERE id=?", clean(body["about"], 255), cid)
            if "photo" in body:
                ph = clean_photo(body["photo"])
                if ph != (c["photo"] or ""):
                    run("UPDATE chats SET photo=? WHERE id=?", ph or None, cid)
                    service(cid, uid, "photo" if ph else "photo_removed", photo=ph)
            if "look" in body:
                run("UPDATE chats SET look=? WHERE id=?", json.dumps(clean_look(body["look"])) if body["look"] else None, cid)
            if "handle" in body:
                h = clean(body["handle"], 24).lstrip("@")
                if h and not handle_free(h, None, cid):
                    raise HttpError(409, "taken")
                try:
                    run("UPDATE chats SET handle=? WHERE id=?", h or None, cid)
                except sqlite3.IntegrityError:
                    raise HttpError(409, "taken")
            if isinstance(body.get("perms"), dict):
                if not can(c, me, "ban"):
                    raise HttpError(403, "no rights")
                old = {**DEFAULT_PERMS, **jload(c["perms"], {})}   # меняем только присланные разрешения
                run("UPDATE chats SET perms=? WHERE id=?", json.dumps({k: bool(body["perms"].get(k, old[k])) for k in MEMBER_PERMS}), cid)
            return chat_out(chat_or_404(cid), uid, True)

        if sub == "join" and method == "POST":
            if q1("SELECT 1 x FROM bans WHERE chat=? AND user=?", cid, uid):
                raise HttpError(403, "banned")
            if (public or guest_ok) and not me:
                run("INSERT OR IGNORE INTO members (chat, user, role, joined) VALUES (?, ?, 'member', ?)", cid, uid, now)
                if c["kind"] == "group":
                    service(cid, uid, "joined")
            return chat_out(c, uid, True)

        if sub == "leave" and method == "POST":
            if me and me["role"] != "owner":
                run("DELETE FROM members WHERE chat=? AND user=?", cid, uid)
                if c["kind"] == "group":
                    service(cid, uid, "left")
            return {"ok": True}

        if sub == "drop" and method == "POST":          # владелец удаляет группу или канал
            if not me or me["role"] != "owner" or not public:
                raise HttpError(403, "owner only")
            for t in ("messages", "members", "bans"):
                run(f"DELETE FROM {t} WHERE chat=?", cid)
            run("DELETE FROM chats WHERE id=?", cid)
            return {"ok": True}

        if sub == "members" and method == "GET":
            # подписчиков канала видят только его админы, участников группы видят её участники
            if c["kind"] == "channel" and not can(c, me, "ban") and not can(c, me, "promote"):
                return {"members": [], "banned": []}
            if c["kind"] == "group" and not me:
                return {"members": [], "banned": []}
            rows = q("""SELECT user, role, title, rights FROM members WHERE chat=?
                        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined LIMIT 300""", cid)
            return {"members": [{**user_card(r["user"]), "role": r["role"], "title": r["title"] or "", "rights": jload(r["rights"], {})} for r in rows],
                    "banned": [user_card(r["user"]) for r in q("SELECT user FROM bans WHERE chat=? LIMIT 100", cid)] if can(c, me, "ban") else []}

        if sub == "admin" and method == "POST":     # назначить или снять админа, задать права и префикс
            if not can(c, me, "promote"):
                raise HttpError(403, "no rights")
            target = int(body.get("user") or 0)
            tm = member(cid, target)
            if not tm or tm["role"] == "owner" or target == uid:
                raise HttpError(400, "bad target")
            if body.get("demote"):
                run("UPDATE members SET role='member', rights=NULL, title=NULL WHERE chat=? AND user=?", cid, target)
                return {"ok": True}
            want = body.get("rights") if isinstance(body.get("rights"), dict) else DEFAULT_ADMIN
            # админ не может выдать права, которых нет у него самого
            rights = {r: bool(want.get(r)) and (me["role"] == "owner" or bool(me["rights"].get(r))) for r in ADMIN_RIGHTS}
            run("UPDATE members SET role='admin', rights=?, title=? WHERE chat=? AND user=?",
                json.dumps(rights), clean(body.get("title"), 16) or None, cid, target)
            return {"ok": True}

        if sub == "title" and method == "POST":     # префикс обычного участника группы
            if not can(c, me, "promote"):
                raise HttpError(403, "no rights")
            target = int(body.get("user") or 0)
            run("UPDATE members SET title=? WHERE chat=? AND user=? AND role<>'owner'", clean(body.get("title"), 16) or None, cid, target)
            if target == uid and me["role"] == "owner":
                run("UPDATE members SET title=? WHERE chat=? AND user=?", clean(body.get("title"), 16) or None, cid, uid)
            return {"ok": True}

        if sub == "ban" and method == "POST":       # удалить участника, по желанию с запретом вернуться
            if not can(c, me, "ban"):
                raise HttpError(403, "no rights")
            target = int(body.get("user") or 0)
            tm = member(cid, target)
            if body.get("unban"):
                run("DELETE FROM bans WHERE chat=? AND user=?", cid, target)
                return {"ok": True}
            if not tm or tm["role"] == "owner" or target == uid or (tm["role"] == "admin" and me["role"] != "owner"):
                raise HttpError(400, "bad target")
            run("DELETE FROM members WHERE chat=? AND user=?", cid, target)
            if body.get("ban"):
                run("INSERT OR IGNORE INTO bans (chat, user) VALUES (?, ?)", cid, target)
            if c["kind"] == "group":
                service(cid, uid, "removed", target=target, name=user_card(target)["name"])
            return {"ok": True}

        if sub == "share" and method == "POST":     # красивое приглашение для пересылки в Telegram
            limit(uid, "share", 20, 3600)
            if not public:
                raise HttpError(400, "bad chat")
            img = save_jpeg(body.get("image"), 900_000)
            card = chat_card(c)
            link = f"https://t.me/{BOT_NAME}?start=chat_{cid}"
            kind = "Канал" if c["kind"] == "channel" else "Группа"
            caption = f"{kind} «{c['title']}» в DuckChance" + (f"\n{c['about']}" if c["about"] else "") + f"\nВладелец: {card['owner']['name']}"
            result = {"type": "photo", "id": f"c{cid}x{now}", "photo_url": img, "thumbnail_url": img, "caption": caption[:1000],
                      "reply_markup": {"inline_keyboard": [[{"text": "Открыть" if c["kind"] == "channel" else "Вступить", "url": link}]]}}
            r = tg_call("savePreparedInlineMessage", user_id=uid, result=result, allow_user_chats=True, allow_group_chats=True,
                        allow_channel_chats=True, allow_bot_chats=False)
            return {"id": r["result"]["id"], "link": link}

    if p == ["ref", "share"] and method == "POST":   # реферальный баннер для пересылки в любой чат
        limit(uid, "refshare", 10, 3600)
        import profile_card, shutil
        u = user_card(uid)
        mp4, jpg = profile_card.render_ref({"name": u["name"], "photo": u["photo"]})
        urls = []
        for src in (mp4, jpg):
            name = hashlib.sha256(open(src, "rb").read()).hexdigest()[:20] + os.path.splitext(src)[1]
            dst = os.path.join(MEDIA, name)
            if not os.path.exists(dst):
                shutil.copyfile(src, dst)
            urls.append(f"{PUBLIC}/media/{name}")
        link = f"https://t.me/{BOT_NAME}?start=ref_{uid}"
        result = {"type": "mpeg4_gif", "id": f"r{uid}x{now}", "mpeg4_url": urls[0], "thumbnail_url": urls[1],
                  "thumbnail_mime_type": "image/jpeg", "mpeg4_width": profile_card.W, "mpeg4_height": profile_card.H,
                  "caption": REF_CAPTION, "parse_mode": "HTML",
                  "reply_markup": {"inline_keyboard": [[{"text": "🎁 Забрать бесплатно", "url": link}]]}}
        r = tg_call("savePreparedInlineMessage", user_id=uid, result=result, allow_user_chats=True, allow_group_chats=True,
                    allow_channel_chats=True, allow_bot_chats=False)
        return {"id": r["result"]["id"], "link": link}

    if p == ["gift", "send"] and method == "POST":
        limit(uid, "gift", 10, 60)
        to = int(body.get("to") or 0)
        if to == uid or not q1("SELECT id FROM users WHERE id=?", to):
            raise HttpError(400, "bad gift")
        if blocked(to, uid):
            raise HttpError(403, "blocked")
        s = admin.settings()
        if not s.get("transfers", True):
            raise HttpError(423, "transfers off")
        # владение подарком сервер пока проверить не может (инвентарь на устройстве), поэтому ограничиваем масштаб
        day = (q1("SELECT COUNT(*) n FROM transfers WHERE from_user=? AND created>?", uid, now - 86400) or {}).get("n", 0)
        if day >= int(s.get("transfers_day", 10)):
            raise HttpError(429, "daily limit")
        # подарок переходит из кошелька в кошелёк: отдать можно только свой и не из стейкинга
        with bank.tx():
            bank.need(uid)
            row = bank.q1("SELECT gift FROM inventory WHERE uid=? AND user=? AND stake IS NULL", int(body.get("uid") or 0), uid)
            if not row:
                raise HttpError(409, "gift not yours")
            gift = row["gift"]
            if bank.wallet(to):        # сразу в кошелёк получателя
                db.execute("UPDATE inventory SET user=? WHERE uid=?", (to, int(body["uid"])))
                in_inv = 1
            else:                      # получатель ещё не перенёс данные: подарок ляжет к нему, когда он его заберёт
                db.execute("DELETE FROM inventory WHERE uid=?", (int(body["uid"]),))
                in_inv = 0
        c = dm_chat(uid, to)
        mid = post_message(c["id"], uid, clean(body.get("text"), 255), gift, kind="gift", data={"to": to})
        run("INSERT INTO transfers (from_user, to_user, gift, msg, created, inv) VALUES (?, ?, ?, ?, ?, ?)", uid, to, gift, mid, now, in_inv)
        return {"chat": c["id"], "message": msg_out(q1("SELECT * FROM messages WHERE id=?", mid), {})}

    if p == ["gift", "incoming"] and method == "GET":
        rows = q("SELECT * FROM transfers WHERE to_user=? AND claimed IS NULL ORDER BY id", uid)
        return {"gifts": [{"id": r["id"], "gift": r["gift"], "msg": r["msg"], "from": user_card(r["from_user"])} for r in rows]}

    if len(p) == 3 and p[:2] == ["gift", "claim"] and method == "POST":
        tid = int(p[2])
        with bank.tx():   # забрать подарок можно ровно один раз
            bank.need(uid)
            if db.execute("UPDATE transfers SET claimed=? WHERE id=? AND to_user=? AND claimed IS NULL", (now, tid, uid)).rowcount != 1:
                raise HttpError(409, "already claimed")
            t = bank.q1("SELECT gift, inv FROM transfers WHERE id=?", tid)
            if not t["inv"]:
                bank.add_gift(uid, t["gift"], "подарок от игрока")
            return {"gift": t["gift"], "state": bank.state(uid)}

    raise HttpError(404, "not found")


import admin                     # server/admin.py лежит рядом
admin.bind(globals())
import catalog
import bank                      # кошелёк игрока: server/bank.py
bank.bind(globals())
import profiles                  # профиль как в Telegram: server/profiles.py
profiles.bind(globals())
import games                     # онлайн-игры: server/games.py
games.bind(globals())


class Handler(BaseHTTPRequestHandler):
    server_version = "DuckChance"

    def log_message(self, fmt, *args):
        pass

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS or (DEV and origin.startswith("http://127.0.0.1")):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Dev-User, X-App-Ver")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Max-Age", "86400")

    def reply(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode()
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

    def serve_media(self, name):
        path = os.path.join(MEDIA, name)
        if not MEDIA_NAME.match(name) or not os.path.exists(path):
            return self.reply(404, {"error": "not found"})
        with open(path, "rb") as f:
            data = f.read()
        rng = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        total = len(data)
        if rng and (rng.group(1) or rng.group(2)):
            a = int(rng.group(1)) if rng.group(1) else max(0, total - int(rng.group(2)))
            b = int(rng.group(2)) if rng.group(1) and rng.group(2) else total - 1
            b = min(b, total - 1)
            data = data[a:b + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {a}-{b}/{total}")
        else:
            self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", MEDIA_TYPES[name.rsplit(".", 1)[1]])
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def handle_api(self, method):
        try:
            url = urllib.parse.urlparse(self.path)
            if url.path == "/health":
                return self.reply(200, {"ok": True})
            if url.path.startswith("/media/") and method == "GET":
                return self.serve_media(url.path[7:])
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
            if method == "POST" and url.path == "/api/media/raw":
                n = int(self.headers.get("Content-Length") or 0)
                if not 0 < n <= RAW_MAX:
                    raise HttpError(413, "too big")
                limit(uid, "raw", 30, 3600)
                raw = self.rfile.read(n)
                kind = urllib.parse.parse_qs(url.query).get("kind", ["audio"])[0]
                ext = sniff(raw, kind)
                if not ext or (kind == "audio" and ext not in ("mp3", "m4a", "ogg", "wav")) or (kind == "story" and ext not in ("jpg", "mp4")):
                    raise HttpError(415, "bad file")
                name = hashlib.sha256(raw).hexdigest()[:20] + "." + ext
                path = os.path.join(MEDIA, name)
                if not os.path.exists(path):
                    with open(path, "wb") as f:
                        f.write(raw)
                return self.reply(200, {"url": f"{PUBLIC}/media/{name}"})
            if method == "POST":
                n = int(self.headers.get("Content-Length") or 0)
                big = url.path in ("/api/upload",) or url.path.endswith("/share")
                if n > (1_300_000 if big else 32768):
                    raise HttpError(413, "too big")
                body = json.loads(self.rfile.read(n) or b"{}", parse_constant=no_nan) if n else {}
                if not isinstance(body, dict):
                    raise HttpError(400, "bad body")
                # деньги ведёт сервер с версии 40: старое приложение из кэша не должно трогать баланс по-старому
                if MONEY.match(url.path) and int(self.headers.get("X-App-Ver") or 0) < 40:
                    raise HttpError(426, "update app")
            self.reply(200, api(method, url.path, uid, body, urllib.parse.parse_qs(url.query)))
        except HttpError as e:
            self.reply(e.code, {"error": e.text})
        except (ValueError, KeyError, TypeError):
            self.reply(400, {"error": "bad request"})
        except urllib.error.HTTPError as e:
            print("Telegram отказал:", e.read()[:300], flush=True)
            self.reply(502, {"error": "telegram"})
        except Exception as e:
            print("Ошибка:", repr(e), flush=True)
            self.reply(500, {"error": "server error"})

    def do_GET(self):
        self.handle_api("GET")

    def do_POST(self):
        self.handle_api("POST")


def main():
    if os.environ.get("BOT") == "1":
        here = os.path.dirname(os.path.abspath(__file__))
        sys.path[:0] = [here, os.path.dirname(here)]   # bot_poller.py лежит рядом или уровнем выше
        import bot_poller
        threading.Thread(target=bot_poller.main, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Сервер DuckChance на 127.0.0.1:{PORT}" + (" (режим проверки)" if DEV else ""), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
