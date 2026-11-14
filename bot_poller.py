"""Бот DuckChance: меню из трёх кнопок, анимированный баннер профиля, поддержка, оплата звёздами,
приглашения и напоминания о бесплатном яйце.

Запуск:  TG_TOKEN=<токен бота> python3 bot_poller.py
Telegram ждёт ответ на pre_checkout_query не дольше 10 секунд, поэтому бот должен работать постоянно.
Токен в код не вписывается, он берётся из переменной окружения.

Меню: «Играть» открывает приложение, «Поддержка» принимает вопрос и пересылает его админам
(админ отвечает ответом на пересланное сообщение, бот возвращает ответ игроку), «Профиль» присылает
анимированный баннер: обложка, рамка, баланс и лучшие подарки (рисует server/profile_card.py).

Премиум-эмодзи с утками работают, если у владельца бота есть Telegram Premium. Если Telegram их не примет,
бот сам переходит на обычные эмодзи.

Приглашения: ссылка t.me/<бот>?start=ref_<id>. За нового человека пригласивший получает кнопку с бонусом.
Напоминания: раз в день в 12:00 по Москве тем, кто давно не заходил. /stop выключает, /remind включает.
"""
import hashlib, hmac, json, os, re, sqlite3, sys, threading, time, urllib.error, urllib.request, urllib.parse, uuid
from datetime import datetime, timedelta, timezone

TOKEN = os.environ.get("TG_TOKEN") or sys.exit("Нужна переменная окружения TG_TOKEN")
API = f"https://api.telegram.org/bot{TOKEN}/"
SITE = os.environ.get("SITE", "https://snoweriksajjs.github.io/gift-games/")
BANNER = os.environ.get("BANNER", "https://snoweriksajjs.github.io/gift-games/img/logo-banner.jpg")
CODE_KEY = os.environ.get("CODE_KEY", "duckchance-codes-v1")   # тот же ключ, что в js/core.js
REF_BONUS = int(os.environ.get("REF_BONUS", "100"))
VER = os.environ.get("APP_VER", "25")
LOG = os.environ.get("PAY_LOG", "payments.log")
SEEN = os.environ.get("SEEN_FILE", "seen_users.json")
STATE = os.environ.get("BOT_STATE", os.path.join(os.path.dirname(os.path.abspath(SEEN)), "bot_state.json"))
DB = os.environ.get("DB", "")          # база сервера: профиль, баланс, кто давно не заходил
ADMINS = [int(x) for x in os.environ.get("ADMIN_IDS", "8083284748").split(",") if x.strip().isdigit()]
MSK = timezone(timedelta(hours=3))
REMIND_HOUR = 12

# утиные премиум-эмодзи из набора UtyaDuckEmojis
DUCK = {"hi": ("👋", "5258029913021119781"), "money": ("🤑", "5260436911478043287"), "fire": ("🔥", "5258044395650841388"),
        "party": ("🥳", "5260515582394005038"), "cool": ("😎", "5260256767664747296"), "strong": ("💪", "5260237109599431823"),
        "love": ("🫶", "5258183535411360332"), "think": ("🤔", "5260486002954237511"), "wow": ("🍾", "5260414358604771183"),
        "ok": ("👌", "5260429575673902036"), "point": ("🫵", "5260324447759402046"), "heart": ("❤️", "5260634973894900408")}
premium = {"text": True, "buttons": True}     # снимается, если Telegram откажет


def e(name):
    ch, eid = DUCK[name]
    return f'<tg-emoji emoji-id="{eid}">{ch}</tg-emoji>'


COMMANDS = [
    {"command": "play", "description": "Открыть DuckChance"},
    {"command": "profile", "description": "Мой профиль"},
    {"command": "egg", "description": "Бесплатное яйцо дня"},
    {"command": "invite", "description": "Пригласить друга и получить звёзды"},
    {"command": "support", "description": "Написать в поддержку"},
    {"command": "help", "description": "Как играть"},
    {"command": "stop", "description": "Выключить напоминания"},
]


def welcome():
    return (f"{e('hi')} <b>Добро пожаловать в DuckChance</b>\n\n"
            "Игры на подарки Telegram за звёзды: <b>апгрейд, серия, контракт, арена, краш</b> и утиные яйца.\n\n"
            f"{e('party')} Каждый день одно яйцо <b>бесплатно</b>\n"
            f"{e('cool')} Каждый раунд можно проверить на честность\n"
            f"{e('love')} Чаты с игроками, группы, каналы и обмен подарками\n\n"
            "<i>Жмите «Играть», чтобы начать.</i>")


HELP = ("<b>Как играть</b>\n\n"
        "<b>Апгрейд.</b> Ставите подарок или звёзды и выбираете подарок дороже. Чем больше разница, тем меньше шанс.\n"
        "<b>Серия.</b> Одна ставка, круг крутится сам. Каждая победа удваивает приз, первый промах заканчивает игру.\n"
        "<b>Контракт.</b> Отдаёте от 3 до 10 подарков и получаете один, дешевле или дороже их суммы.\n"
        "<b>Арена.</b> Игроки ставят в общий банк, мяч скачет по полю. Чья территория, тот забирает всё.\n"
        "<b>Краш.</b> Множитель растёт, пока ракета летит. Заберите выигрыш до взрыва.\n"
        "<b>Яйцо.</b> Разбиваете тремя тапами, внутри подарок. Одно яйцо в день бесплатно.\n\n"
        "<blockquote>Подарки можно продать за звёзды, передать другу или отправить в стейкинг. "
        "Звёзды выводить нельзя, только подарки.</blockquote>")

lock = threading.Lock()


# ---------- запросы к Telegram ----------
def call(method, **params):
    data = urllib.parse.urlencode({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list, bool)) else v for k, v in params.items()}).encode()
    with urllib.request.urlopen(API + method, data=data, timeout=70) as r:
        return json.load(r)["result"]


def call_file(method, field, path, **params):
    """Отправка файла: multipart/form-data без сторонних библиотек."""
    b = uuid.uuid4().hex
    parts = []
    for k, v in params.items():
        v = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list, bool)) else str(v)
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    with open(path, "rb") as f:
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{field}"; filename="{os.path.basename(path)}"\r\nContent-Type: video/mp4\r\n\r\n'.encode() + f.read() + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    req = urllib.request.Request(API + method, data=b"".join(parts), headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["result"]


def strip_premium(params):
    """Убирает премиум-эмодзи из текста и оформление кнопок."""
    out = dict(params)
    for k in ("text", "caption"):
        if k in out:
            out[k] = re.sub(r'<tg-emoji emoji-id="\d+">(.*?)</tg-emoji>', r"\1", out[k])
    kb = out.get("reply_markup")
    if isinstance(kb, dict) and "inline_keyboard" in kb:
        out["reply_markup"] = {"inline_keyboard": [[{k: v for k, v in btn.items() if k not in ("style", "icon_custom_emoji_id")} for btn in row] for row in kb["inline_keyboard"]]}
    return out


def tg(method, file=None, **params):
    """Отправка с премиум-эмодзи; если Telegram их не принимает, повтор без них и дальше без них."""
    send_fn = (lambda p: call_file(method, file[0], file[1], **p)) if file else (lambda p: call(method, **p))
    if not premium["text"]:
        params = strip_premium(params)
    try:
        return send_fn(params)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "ignore")
        if err.code == 400 and premium["text"] and params != strip_premium(params):   # любая ошибка 400 при оформлении: пробуем без него
            res = send_fn(strip_premium(params))      # без оформления прошло: значит, дело было в нём
            print("Премиум-эмодзи недоступны, перехожу на обычные:", body[:160], flush=True)
            premium["text"] = False
            return res
        raise urllib.error.HTTPError(err.url, err.code, body, err.headers, None)


def send(chat, text, **kw):
    return tg("sendMessage", chat_id=chat, text=text, parse_mode="HTML", **kw)


def make_code(kind, amount, nonce):
    sig = hmac.new(CODE_KEY.encode(), f"{kind}:{amount}:{nonce}".encode(), hashlib.sha256).hexdigest()[:10]
    return f"{kind}-{amount}-{nonce}-{sig}"


def app_url(**query):
    return f"{SITE}?{urllib.parse.urlencode({'v': VER, **query})}"


def app_btn(text, icon=None, style=None, **query):
    b = {"text": text, "web_app": {"url": app_url(**query)}}
    if icon:
        b["icon_custom_emoji_id"] = DUCK[icon][1]
    if style:
        b["style"] = style
    return b


def play_button(text, **query):
    return {"inline_keyboard": [[app_btn(text, **query)]]}


def bot_name():
    if not hasattr(bot_name, "v"):
        bot_name.v = call("getMe")["username"]
    return bot_name.v


def share_url(uid):
    link = f"https://t.me/{bot_name()}?start=ref_{uid}"
    return "https://t.me/share/url?" + urllib.parse.urlencode({"url": link, "text": "Залетай в DuckChance: игры на подарки Telegram за звёзды"})


def main_menu(ref=""):
    return {"inline_keyboard": [
        [app_btn("Играть", icon="fire", style="primary", **({"ref": ref} if ref else {}))],
        [{"text": "Поддержка", "callback_data": "support", "icon_custom_emoji_id": DUCK["think"][1]},
         {"text": "Профиль", "callback_data": "profile", "icon_custom_emoji_id": DUCK["cool"][1]}],
    ]}


# ---------- хранение ----------
def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


seen = set(load_json(SEEN, []))
state = load_json(STATE, {})
for k, v in {"subs": [], "muted": [], "reminded": "", "tickets": {}, "cards": {}}.items():
    state.setdefault(k, v)
waiting_support = {}      # кто сейчас пишет вопрос в поддержку


def save_state():
    with lock:
        if len(state["tickets"]) > 3000:
            state["tickets"] = dict(list(state["tickets"].items())[-2000:])
        if len(state["cards"]) > 500:
            state["cards"] = dict(list(state["cards"].items())[-300:])
        save_json(STATE, state)


# ---------- профиль ----------
def user_row(uid):
    if not DB or not os.path.exists(DB):
        return None
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        r = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        con.close()
        return dict(r) if r else None
    except Exception as err:
        print("База недоступна:", err, flush=True)
        return None


def fmt(n):
    return f"{int(n):,}".replace(",", " ")


def send_profile(chat, uid, tg_user):
    row = user_row(uid)
    if not row:
        send(chat, f"{e('think')} Профиль появится, когда вы откроете DuckChance хотя бы раз.", reply_markup=play_button("Открыть DuckChance"))
        return
    try:
        call("sendChatAction", chat_id=chat, action="upload_video")
    except Exception:
        pass
    try:
        look = json.loads(row.get("look") or "null") or {}
    except ValueError:
        look = {}
    try:
        gifts = json.loads(row.get("gifts") or "[]")
    except ValueError:
        gifts = []
    data = {"name": row.get("name") or tg_user.get("first_name") or "Игрок", "handle": row.get("handle") or "",
            "photo": row.get("photo") or "", "look": look, "balance": int(row.get("balance") or 0),
            "gifts": gifts, "staked": int(row.get("staked") or 0)}
    import profile_card
    cat = profile_card._catalog()
    value = sum(cat[g]["price"] for g in gifts if g in cat)
    caption = (f"{e('cool')} <b>{escape(data['name'])}</b>" + (f"  <i>@{escape(data['handle'])}</i>" if data["handle"] else "") + "\n\n"
               f"{e('money')} Баланс: <b>{fmt(data['balance'])} ⭐</b>\n"
               f"{e('party')} Подарков: <b>{len([g for g in gifts if g in cat])}</b> на <b>{fmt(value)} ⭐</b>\n"
               + (f"{e('strong')} В стейкинге: <b>{data['staked']}</b>\n" if data["staked"] else ""))
    kb = {"inline_keyboard": [[app_btn("Открыть профиль", icon="cool", style="primary", open="profile")],
                              [{"text": "Пригласить друга", "callback_data": "invite"}, {"text": "Обновить", "callback_data": "profile"}]]}
    key = profile_card._key(data)
    try:
        if key in state["cards"]:
            tg("sendAnimation", chat_id=chat, animation=state["cards"][key], caption=caption, parse_mode="HTML", reply_markup=kb)
            return
        path = profile_card.render(data)
        m = tg("sendAnimation", file=("animation", path), chat_id=chat, caption=caption, parse_mode="HTML", reply_markup=kb,
               width=profile_card.W, height=profile_card.H)
        fid = (m.get("animation") or m.get("document") or {}).get("file_id")
        if fid:
            state["cards"][key] = fid
            save_state()
    except Exception as err:
        print("Баннер профиля не вышел:", err, flush=True)
        send(chat, caption, reply_markup=kb)


def escape(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---------- реферальный баннер ----------
def ref_caption():
    return (f"{e('party')} <b>Залетай в DuckChance</b>\n\n"
            "Тут выбивают NFT-подарки Telegram: Plush Pepe, Durov's Cap, Heart Locket и ещё полсотни коллекций.\n\n"
            f"{e('fire')} Каждый день бесплатное яйцо с подарком внутри\n"
            f"{e('cool')} Апгрейд, краш, арена: раунд длится секунды\n"
            f"{e('ok')} Любой результат можно проверить\n\n"
            f"Жми кнопку и забирай первое яйцо {e('point')}")


def send_invite(chat, uid, tg_user):
    """Персональный анимированный баннер: его пересылают в чаты, кнопка со ссылкой уходит вместе с ним."""
    link = f"https://t.me/{bot_name()}?start=ref_{uid}"
    row = user_row(uid) or {}
    data = {"name": row.get("name") or tg_user.get("first_name") or "Друг", "photo": row.get("photo") or ""}
    kb = {"inline_keyboard": [[{"text": "Забрать бесплатно", "url": link, "style": "success", "icon_custom_emoji_id": DUCK["party"][1]}]]}
    try:
        call("sendChatAction", chat_id=chat, action="upload_video")
        import profile_card
        key = "ref:" + profile_card._key(data)
        if key in state["cards"]:
            tg("sendAnimation", chat_id=chat, animation=state["cards"][key], caption=ref_caption(), parse_mode="HTML", reply_markup=kb)
        else:
            mp4, _ = profile_card.render_ref(data)
            m = tg("sendAnimation", file=("animation", mp4), chat_id=chat, caption=ref_caption(), parse_mode="HTML", reply_markup=kb,
                   width=profile_card.W, height=profile_card.H)
            fid = (m.get("animation") or m.get("document") or {}).get("file_id")
            if fid:
                state["cards"][key] = fid
                save_state()
    except Exception as err:
        print("Реферальный баннер не вышел:", err, flush=True)
        send(chat, ref_caption(), reply_markup=kb)
    send(chat, f"{e('money')} <b>Перешлите сообщение выше друзьям или в чаты.</b>\n\nЗа каждого, кто придёт по вашей кнопке, вы получите <b>{REF_BONUS} ⭐</b>.\n\nВаша ссылка: <code>{link}</code>",
         reply_markup={"inline_keyboard": [[{"text": "Выбрать чат", "url": share_url(uid)}]]}, disable_web_page_preview=True)


# ---------- рассылка и админ-меню ----------
admin_wait = {}       # админ сейчас присылает сообщение для рассылки
drafts = {}           # черновик рассылки: {admin: {"chat", "msg", "play", "ctl"}}


def bc_markup(play):
    return {"inline_keyboard": [[app_btn("Играть", icon="fire", style="primary")]]} if play else None


def _deliver(targets, send_one, admin, title, ctl=None):
    ok = bad = gone = 0
    for i, uid in enumerate(targets):
        try:
            send_one(uid)
            ok += 1
        except urllib.error.HTTPError as err:
            bad += 1
            if err.code == 403:
                gone += 1
                with lock:
                    state["subs"] = [x for x in state["subs"] if x != uid]
        except Exception:
            bad += 1
        if ctl and (i + 1) % 25 == 0:
            try:
                call("editMessageText", chat_id=admin, message_id=ctl, text=f"{title}: {i + 1} из {len(targets)}…")
            except Exception:
                pass
        time.sleep(0.05)          # не больше 20 сообщений в секунду
    save_state()
    report = f"{e('ok')} <b>{title} завершена</b>\n\nДоставлено: <b>{ok}</b>\nНе доставлено: <b>{bad}</b>" + (f" (заблокировали бота: {gone})" if gone else "")
    try:
        if ctl:
            call("editMessageText", chat_id=admin, message_id=ctl, text=re.sub(r"<[^>]+>", "", report))
        else:
            send(admin, report)
    except Exception:
        pass
    print(f"{title}: {ok} доставлено, {bad} нет", flush=True)


def broadcast_html(admin, targets, text, photo, markup, test=False):
    """Рассылка из админки в приложении: HTML-текст (с премиум-эмодзи), по желанию фото и кнопка."""
    def one(uid):
        if photo:
            tg("sendPhoto", chat_id=uid, photo=photo, caption=text[:1024], parse_mode="HTML", **({"reply_markup": markup} if markup else {}))
        else:
            tg("sendMessage", chat_id=uid, text=text, parse_mode="HTML", **({"reply_markup": markup} if markup else {}))
    _deliver(targets, one, admin, "Тестовая рассылка" if test else "Рассылка")


def broadcast_copy(admin, targets, chat, msg, markup, title, ctl=None):
    """Рассылка из бота: копия любого сообщения админа, со всем оформлением, эмодзи и вложениями."""
    def one(uid):
        call("copyMessage", chat_id=uid, from_chat_id=chat, message_id=msg, **({"reply_markup": markup} if markup else {}))
    _deliver(targets, one, admin, title, ctl)


def admin_menu(chat):
    st = sys.modules.get("admin")
    n = len(state["subs"])
    send(chat, f"{e('cool')} <b>Админка DuckChance</b>\n\nПользователей бота: <b>{n}</b>\n\n"
               "Рассылка: пришлите любое сообщение (текст с форматированием, премиум-эмодзи, фото, видео, файл), бот разошлёт его копию.",
         reply_markup={"inline_keyboard": [[app_btn("Открыть админку", icon="cool", style="primary", admin="1")],
                                           [{"text": "Статистика", "callback_data": "adm_stats"}, {"text": "Рассылка", "callback_data": "adm_bc"}]]})


def admin_stats(chat):
    st = sys.modules.get("admin")
    if not st:
        return send(chat, "Статистика недоступна")
    d = st.stats()
    f = lambda n: fmt(n)
    send(chat, f"{e('money')} <b>Статистика</b>\n\n"
               f"<b>Игроки</b>\nВсего: {f(d['users'])} · в боте: {f(d['bot_users'])}\nНовых за сутки: {f(d['new_day'])} · за неделю: {f(d['new_week'])}\n"
               f"Активных за сутки: {f(d['active_day'])} · за неделю: {f(d['active_week'])} · онлайн: {f(d['online'])}\n\n"
               f"<b>Деньги</b>\nПополнений: {f(d['payments'])} на {f(d['paid_stars'])} ⭐ (за сутки {f(d['paid_day'])} ⭐)\nЗвёзд на балансах: {f(d['balances'])} ⭐\n\n"
               f"<b>Общение</b>\nГрупп: {f(d['chats'])} · каналов: {f(d['channels'])} · личных: {f(d['dms'])}\nСообщений: {f(d['messages'])} · передач подарков: {f(d['transfers'])}\n\n"
               f"Промокодов активировано: {f(d['promo_uses'])} · заданий выполнено: {f(d['tasks_done'])}")


def draft_controls(admin):
    d = drafts[admin]
    n = len(state["subs"])
    kb = {"inline_keyboard": [
        [{"text": ("Кнопка «Играть»: вкл" if d["play"] else "Кнопка «Играть»: выкл"), "callback_data": "adm_bc_play"}],
        [{"text": "Отправить себе", "callback_data": "adm_bc_test"}, {"text": f"Разослать всем ({n})", "callback_data": "adm_bc_ask"}],
        [{"text": "Отмена", "callback_data": "adm_bc_cancel"}]]}
    return kb


def on_admin_draft(m):
    admin = m["from"]["id"]
    admin_wait.pop(admin, None)
    drafts[admin] = {"chat": m["chat"]["id"], "msg": m["message_id"], "play": True}
    send(admin, f"{e('think')} <b>Черновик рассылки готов.</b> Сообщение выше уйдёт как есть: оформление, эмодзи и вложения сохранятся.",
         reply_markup=draft_controls(admin))


def on_admin_callback(q, data):
    admin, chat, mid = q["from"]["id"], q["message"]["chat"]["id"], q["message"]["message_id"]
    if data == "adm_stats":
        return admin_stats(chat)
    if data == "adm_bc":
        admin_wait[admin] = "bc"
        return send(chat, f"{e('point')} Пришлите сообщение для рассылки. Можно текст с форматированием и премиум-эмодзи, фото, видео, GIF, файл или голосовое.",
                    reply_markup={"inline_keyboard": [[{"text": "Отмена", "callback_data": "adm_bc_cancel"}]]})
    d = drafts.get(admin)
    if data == "adm_bc_cancel":
        admin_wait.pop(admin, None)
        drafts.pop(admin, None)
        return call("editMessageText", chat_id=chat, message_id=mid, text="Рассылка отменена.")
    if not d:
        return send(chat, "Черновик не найден, начните заново: /admin")
    if data == "adm_bc_play":
        d["play"] = not d["play"]
        return call("editMessageReplyMarkup", chat_id=chat, message_id=mid, reply_markup=draft_controls(admin))
    if data == "adm_bc_test":
        threading.Thread(target=broadcast_copy, args=(admin, [admin], d["chat"], d["msg"], bc_markup(d["play"]), "Тестовая рассылка"), daemon=True).start()
        return
    if data == "adm_bc_ask":
        n = len(state["subs"])
        return call("editMessageReplyMarkup", chat_id=chat, message_id=mid, reply_markup={"inline_keyboard": [
            [{"text": f"Да, разослать {n} пользователям", "callback_data": "adm_bc_go", "style": "danger"}],
            [{"text": "Назад", "callback_data": "adm_bc_back"}]]})
    if data == "adm_bc_back":
        return call("editMessageReplyMarkup", chat_id=chat, message_id=mid, reply_markup=draft_controls(admin))
    if data == "adm_bc_go":
        drafts.pop(admin, None)
        call("editMessageText", chat_id=chat, message_id=mid, text="Рассылка началась…")
        threading.Thread(target=broadcast_copy, args=(admin, list(state["subs"]), d["chat"], d["msg"], bc_markup(d["play"]), "Рассылка", mid), daemon=True).start()


# ---------- поддержка ----------
def ask_support(chat, uid):
    waiting_support[uid] = time.time()
    send(chat, f"{e('think')} <b>Поддержка DuckChance</b>\n\nНапишите вопрос одним сообщением, можно с фото или скриншотом. Мы ответим прямо здесь.",
         reply_markup={"inline_keyboard": [[{"text": "Отмена", "callback_data": "support_cancel"}]]})


def to_support(m):
    u = m["from"]
    head = f"Вопрос в поддержку от <b>{escape(u.get('first_name', ''))}</b>" + (f" @{u['username']}" if u.get("username") else "") + f" (id {u['id']})\n<i>Ответьте на сообщение ниже, и бот перешлёт ответ.</i>"
    ok = False
    for admin in ADMINS:
        try:
            call("sendMessage", chat_id=admin, text=head, parse_mode="HTML")
            c = call("copyMessage", chat_id=admin, from_chat_id=m["chat"]["id"], message_id=m["message_id"])
            state["tickets"][f"{admin}:{c['message_id']}"] = u["id"]
            ok = True
        except Exception as err:
            print("Не удалось передать вопрос админу", admin, err, flush=True)
    save_state()
    if ok:
        send(m["chat"]["id"], f"{e('ok')} Вопрос передан в поддержку. Ответ придёт сюда.")
    else:
        send(m["chat"]["id"], "Поддержка сейчас недоступна, попробуйте чуть позже.")


def from_support(m):
    """Админ ответил на пересланный вопрос: возвращаем ответ игроку."""
    rep = m.get("reply_to_message") or {}
    uid = state["tickets"].get(f"{m['chat']['id']}:{rep.get('message_id')}")
    if not uid:
        return False
    try:
        send(uid, f"{e('love')} <b>Ответ поддержки</b>")
        call("copyMessage", chat_id=uid, from_chat_id=m["chat"]["id"], message_id=m["message_id"])
        send(m["chat"]["id"], "Ответ отправлен.")
    except Exception as err:
        send(m["chat"]["id"], f"Не доставлено: {escape(err)}")
    return True


# ---------- команды ----------
def on_start(m):
    uid, arg = m["from"]["id"], (m.get("text", "").split(" ", 1) + [""])[1].strip()
    with lock:
        is_new = uid not in seen
        seen.add(uid)
        save_json(SEEN, sorted(seen))
        if uid not in state["subs"]:
            state["subs"].append(uid)
    save_state()
    ref = arg[4:] if arg.startswith("ref_") and arg[4:].isdigit() else ""
    chat = arg[5:] if arg.startswith("chat_") and arg[5:].isdigit() else ""
    if chat:   # приглашение в группу или канал внутри приложения
        send(m["chat"]["id"], f"{e('point')} Вас пригласили в чат DuckChance. Откройте, чтобы вступить.", reply_markup=play_button("Открыть чат", chat=chat))
        return
    try:
        tg("sendPhoto", chat_id=m["chat"]["id"], photo=BANNER, caption=welcome(), parse_mode="HTML", reply_markup=main_menu(ref))
    except Exception as err:   # картинка не загрузилась: присылаем текстом
        print("Баннер не отправился:", err, flush=True)
        send(m["chat"]["id"], welcome(), reply_markup=main_menu(ref))
    # бонус пригласившему: только за нового человека и не за самого себя
    if ref and is_new and int(ref) != uid:
        code = make_code("R", REF_BONUS, str(uid))
        name = escape(m["from"].get("first_name", "Друг"))
        try:
            send(int(ref), f"{e('party')} {name} пришёл по вашей ссылке. Заберите <b>{REF_BONUS} звёзд</b>.",
                 reply_markup=play_button(f"Забрать {REF_BONUS} звёзд", code=code))
            print("Приглашение:", ref, "<-", uid, flush=True)
        except Exception as err:  # пригласивший мог не запускать бота или заблокировать его
            print("Не удалось написать пригласившему", ref, err, flush=True)


def on_command(m, cmd):
    uid, chat = m["from"]["id"], m["chat"]["id"]
    if cmd == "play":
        send(chat, f"{e('fire')} Открыть DuckChance:", reply_markup=main_menu())
    elif cmd == "profile":
        threading.Thread(target=send_profile, args=(chat, uid, m["from"]), daemon=True).start()
    elif cmd == "egg":
        send(chat, f"{e('party')} Каждый день одно яйцо <b>бесплатно</b>, внутри от 30 до 300 звёзд. Разбейте его тремя тапами.",
             reply_markup=play_button("Разбить яйцо", open="egg"))
    elif cmd == "chats":
        send(chat, f"{e('love')} Личные сообщения, группы и каналы игроков. Там же можно подарить подарок.",
             reply_markup=play_button("Открыть чаты", open="chats"))
    elif cmd == "invite":
        threading.Thread(target=send_invite, args=(chat, uid, m["from"]), daemon=True).start()
    elif cmd == "support":
        ask_support(chat, uid)
    elif cmd == "admin" and uid in ADMINS:
        admin_menu(chat)
    elif cmd == "help":
        send(chat, HELP, reply_markup=play_button("Играть"))
    elif cmd == "stop":
        with lock:
            if uid not in state["muted"]:
                state["muted"].append(uid)
        save_state()
        send(chat, "Напоминания выключены. Включить снова: /remind")
    elif cmd == "remind":
        with lock:
            state["muted"] = [x for x in state["muted"] if x != uid]
        save_state()
        send(chat, f"{e('ok')} Напоминания включены. Раз в день, когда бесплатное яйцо готово.")


def on_callback(q):
    data, chat, uid = q.get("data"), q["message"]["chat"]["id"], q["from"]["id"]
    if data and data.startswith("adm_"):
        call("answerCallbackQuery", callback_query_id=q["id"])
        if uid in ADMINS:
            on_admin_callback(q, data)
        return
    call("answerCallbackQuery", callback_query_id=q["id"], **({"text": "Рисуем профиль…"} if data == "profile" else {"text": "Готовим приглашение…"} if data == "invite" else {}))
    if data == "help":
        send(chat, HELP, reply_markup=play_button("Играть"))
    elif data == "profile":
        threading.Thread(target=send_profile, args=(chat, uid, q["from"]), daemon=True).start()
    elif data == "support":
        ask_support(chat, uid)
    elif data == "invite":
        threading.Thread(target=send_invite, args=(chat, uid, q["from"]), daemon=True).start()
    elif data == "support_cancel":
        waiting_support.pop(uid, None)
        try:
            call("deleteMessage", chat_id=chat, message_id=q["message"]["message_id"])
        except Exception:
            pass


# ---------- напоминание о бесплатном яйце ----------
def active_recently():
    if not DB or not os.path.exists(DB):
        return set()
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
        rows = con.execute("SELECT id FROM users WHERE seen > ?", (int(time.time()) - 20 * 3600,)).fetchall()
        con.close()
        return {r[0] for r in rows}
    except Exception as err:
        print("База недоступна для напоминаний:", err, flush=True)
        return set()


def remind_loop():
    while True:
        try:
            now = datetime.now(MSK)
            today = now.strftime("%Y-%m-%d")
            if now.hour == REMIND_HOUR and state.get("reminded") != today:
                state["reminded"] = today
                save_state()
                skip = active_recently() | set(state["muted"])
                sent = gone = 0
                for uid in [u for u in list(state["subs"]) if u not in skip]:
                    try:
                        send(uid, f"{e('party')} Бесплатное утиное яйцо уже ждёт. Внутри от 30 до 300 звёзд.\n\n<i>Выключить напоминания: /stop</i>",
                             reply_markup=play_button("Разбить яйцо", open="egg"))
                        sent += 1
                    except urllib.error.HTTPError as err:
                        if err.code == 403:    # человек заблокировал бота: больше не пишем
                            with lock:
                                state["subs"] = [x for x in state["subs"] if x != uid]
                            gone += 1
                    except Exception:
                        pass
                    time.sleep(0.05)   # не больше 20 сообщений в секунду
                save_state()
                print(f"Напоминания: отправлено {sent}, заблокировали {gone}", flush=True)
        except Exception as err:
            print("Ошибка напоминаний:", err, flush=True)
        time.sleep(300)


def main():
    offset = 0
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        call("setMyCommands", commands=COMMANDS)
        for a in ADMINS:          # админам в меню команд ещё и /admin
            try:
                call("setMyCommands", commands=COMMANDS + [{"command": "admin", "description": "Админка"}], scope={"type": "chat", "chat_id": a})
            except Exception:
                pass
    except Exception as err:
        print("Команды не установлены:", err, flush=True)
    threading.Thread(target=remind_loop, daemon=True).start()
    print("Бот запущен", flush=True)
    while True:
        try:
            updates = call("getUpdates", offset=offset, timeout=50, allowed_updates=["message", "pre_checkout_query", "callback_query"])
        except Exception as err:  # сеть моргнула: ждём и пробуем снова
            print("Ошибка сети:", err, flush=True)
            time.sleep(3)
            continue
        for u in updates:
            offset = u["update_id"] + 1
            try:
                q = u.get("pre_checkout_query")
                if q:
                    ok = q.get("currency") == "XTR" and q.get("invoice_payload", "").startswith("stars_")
                    call("answerPreCheckoutQuery", pre_checkout_query_id=q["id"], ok=ok, **({} if ok else {"error_message": "Счёт не распознан"}))
                    print("Счёт", q["invoice_payload"], "от", q["from"]["id"], "подтверждён" if ok else "отклонён", flush=True)
                if u.get("callback_query"):
                    on_callback(u["callback_query"])
                m = u.get("message") or {}
                if m.get("chat", {}).get("type") not in (None, "private"):
                    continue            # в группах бот молчит
                p = m.get("successful_payment")
                text = m.get("text", "")
                uid = (m.get("from") or {}).get("id")
                if p:
                    line = {"time": int(time.time()), "user": uid, "stars": p["total_amount"], "payload": p["invoice_payload"], "charge": p["telegram_payment_charge_id"]}
                    with open(LOG, "a") as f:
                        f.write(json.dumps(line) + "\n")
                    print("Оплата:", line, flush=True)
                    send(m["chat"]["id"], f"{e('money')} Оплата прошла: <b>+{p['total_amount']} ⭐</b> на балансе.", reply_markup=play_button("Играть"))
                elif uid in ADMINS and m.get("reply_to_message") and from_support(m):
                    pass
                elif uid in ADMINS and admin_wait.get(uid) == "bc" and not text.startswith("/"):
                    on_admin_draft(m)
                elif text.startswith("/start"):
                    on_start(m)
                elif text.startswith("/"):
                    waiting_support.pop(uid, None)
                    on_command(m, text[1:].split()[0].split("@")[0].lower())
                elif uid in waiting_support and m:
                    waiting_support.pop(uid, None)
                    to_support(m)
            except Exception as err:
                print("Ошибка обработки:", err, flush=True)


if __name__ == "__main__":
    main()
