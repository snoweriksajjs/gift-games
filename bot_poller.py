"""Бот DuckChance: приветствие и меню, команды, оплата звёздами, приглашения, напоминания о бесплатном яйце.

Запуск:  TG_TOKEN=<токен бота> python3 bot_poller.py
Telegram ждёт ответ на pre_checkout_query не дольше 10 секунд, поэтому бот должен работать постоянно.
Токен в код не вписывается, он берётся из переменной окружения.

Приглашения: игрок делится ссылкой t.me/<бот>?start=ref_<его id>. Когда по ней впервые
приходит новый человек, бот присылает пригласившему кнопку с подписанным кодом бонуса.
Приложение проверяет подпись и начисляет звёзды.

Напоминания: раз в день в 12:00 по Москве бот пишет тем, кто запускал его и не заходил в приложение
больше 20 часов, что бесплатное яйцо готово. Отключить: /stop, включить снова: /remind.
"""
import hashlib, hmac, json, os, sqlite3, sys, threading, time, urllib.error, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone

TOKEN = os.environ.get("TG_TOKEN") or sys.exit("Нужна переменная окружения TG_TOKEN")
API = f"https://api.telegram.org/bot{TOKEN}/"
SITE = os.environ.get("SITE", "https://snoweriksajjs.github.io/gift-games/")
BANNER = os.environ.get("BANNER", "https://snoweriksajjs.github.io/gift-games/img/logo-banner.jpg")
CODE_KEY = os.environ.get("CODE_KEY", "duckchance-codes-v1")   # тот же ключ, что в js/core.js
REF_BONUS = int(os.environ.get("REF_BONUS", "100"))
VER = os.environ.get("APP_VER", "16")
LOG = os.environ.get("PAY_LOG", "payments.log")
SEEN = os.environ.get("SEEN_FILE", "seen_users.json")
STATE = os.environ.get("BOT_STATE", os.path.join(os.path.dirname(os.path.abspath(SEEN)), "bot_state.json"))
DB = os.environ.get("DB", "")          # база сервера: из неё видно, кто давно не заходил
MSK = timezone(timedelta(hours=3))
REMIND_HOUR = 12

COMMANDS = [
    {"command": "play", "description": "Открыть DuckChance"},
    {"command": "egg", "description": "Бесплатное яйцо дня"},
    {"command": "chats", "description": "Чаты, группы и каналы"},
    {"command": "invite", "description": "Пригласить друга и получить звёзды"},
    {"command": "help", "description": "Как играть"},
    {"command": "stop", "description": "Выключить напоминания"},
]

WELCOME = ("<b>DuckChance</b>: игры на подарки Telegram за звёзды.\n\n"
           "Апгрейд, серия, контракт, арена, краш и утиные яйца. Каждый день одно яйцо бесплатно, "
           "а каждый раунд можно проверить на честность.\n\n"
           "В чатах можно переписываться с игроками, создавать группы и каналы и дарить друг другу подарки.")

HELP = ("<b>Как играть</b>\n\n"
        "<b>Апгрейд.</b> Ставите подарок или звёзды, выбираете подарок дороже. Чем больше разница, тем меньше шанс.\n"
        "<b>Серия.</b> Одна ставка, круг крутится сам. Каждая победа удваивает приз, первый промах заканчивает игру.\n"
        "<b>Контракт.</b> Отдаёте от 3 до 10 подарков и получаете один, дешевле или дороже их суммы.\n"
        "<b>Арена.</b> Игроки ставят в общий банк, мяч скачет по полю. Чья территория, тот забирает всё.\n"
        "<b>Краш.</b> Множитель растёт, пока ракета летит. Заберите выигрыш до взрыва.\n"
        "<b>Яйцо.</b> Разбиваете тремя тапами, внутри подарок. Одно яйцо в день бесплатно.\n\n"
        "Подарки можно продать за звёзды, передать другу или отправить в стейкинг. "
        "Звёзды выводить нельзя, только подарки.")

lock = threading.Lock()


def call(method, **params):
    data = urllib.parse.urlencode({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list, bool)) else v for k, v in params.items()}).encode()
    with urllib.request.urlopen(API + method, data=data, timeout=70) as r:
        return json.load(r)["result"]


def make_code(kind, amount, nonce):
    sig = hmac.new(CODE_KEY.encode(), f"{kind}:{amount}:{nonce}".encode(), hashlib.sha256).hexdigest()[:10]
    return f"{kind}-{amount}-{nonce}-{sig}"


def app_url(**query):
    return f"{SITE}?{urllib.parse.urlencode({'v': VER, **query})}"


def app_btn(text, **query):
    return {"text": text, "web_app": {"url": app_url(**query)}}


def play_button(text, **query):
    return {"inline_keyboard": [[app_btn(text, **query)]]}


def bot_name():
    if not hasattr(bot_name, "v"):
        bot_name.v = call("getMe")["username"]
    return bot_name.v


def share_url(uid):
    link = f"https://t.me/{bot_name()}?start=ref_{uid}"
    return "https://t.me/share/url?" + urllib.parse.urlencode({"url": link, "text": "Залетай в DuckChance: игры на подарки Telegram за звёзды"})


def main_menu(uid, ref=""):
    return {"inline_keyboard": [
        [app_btn("Играть", **({"ref": ref} if ref else {}))],
        [app_btn("Бесплатное яйцо", open="egg"), app_btn("Чаты", open="chats")],
        [{"text": f"Пригласить друга (+{REF_BONUS} звёзд)", "url": share_url(uid)}],
        [{"text": "Как играть", "callback_data": "help"}],
    ]}


# ---------- хранение: кто запускал бота, кто выключил напоминания ----------
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
state = load_json(STATE, {"subs": [], "muted": [], "reminded": ""})


def save_state():
    with lock:
        save_json(STATE, state)


def send(chat, text, **kw):
    return call("sendMessage", chat_id=chat, text=text, parse_mode="HTML", **kw)


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
        send(m["chat"]["id"], "Вас пригласили в чат DuckChance. Откройте, чтобы вступить.", reply_markup=play_button("Открыть чат", chat=chat))
        return
    try:
        call("sendPhoto", chat_id=m["chat"]["id"], photo=BANNER, caption=WELCOME, parse_mode="HTML", reply_markup=main_menu(uid, ref))
    except Exception as e:   # картинка не загрузилась: присылаем текстом
        print("Баннер не отправился:", e, flush=True)
        send(m["chat"]["id"], WELCOME, reply_markup=main_menu(uid, ref))
    # бонус пригласившему: только за нового человека и не за самого себя
    if ref and is_new and int(ref) != uid:
        code = make_code("R", REF_BONUS, str(uid))
        name = m["from"].get("first_name", "Друг")
        try:
            send(int(ref), f"{name} пришёл по вашей ссылке. Заберите {REF_BONUS} звёзд.",
                 reply_markup=play_button(f"Забрать {REF_BONUS} звёзд", code=code))
            print("Приглашение:", ref, "<-", uid, flush=True)
        except Exception as e:  # пригласивший мог не запускать бота или заблокировать его
            print("Не удалось написать пригласившему", ref, e, flush=True)


def on_command(m, cmd):
    uid, chat = m["from"]["id"], m["chat"]["id"]
    if cmd == "play":
        send(chat, "Открыть DuckChance:", reply_markup=play_button("Играть"))
    elif cmd == "egg":
        send(chat, "Каждый день одно яйцо бесплатно, внутри от 30 до 300 звёзд. Разбейте его тремя тапами.",
             reply_markup=play_button("Разбить яйцо", open="egg"))
    elif cmd == "chats":
        send(chat, "Личные сообщения, группы и каналы игроков. Там же можно подарить подарок.",
             reply_markup=play_button("Открыть чаты", open="chats"))
    elif cmd == "invite":
        link = f"https://t.me/{bot_name()}?start=ref_{uid}"
        send(chat, f"Ваша ссылка:\n{link}\n\nЗа каждого друга, который запустит бота по ней, вы получите {REF_BONUS} звёзд.",
             reply_markup={"inline_keyboard": [[{"text": "Отправить другу", "url": share_url(uid)}]]}, disable_web_page_preview=True)
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
        send(chat, "Напоминания включены. Раз в день, когда бесплатное яйцо готово.")


def on_callback(q):
    call("answerCallbackQuery", callback_query_id=q["id"])
    if q.get("data") == "help":
        send(q["message"]["chat"]["id"], HELP, reply_markup=play_button("Играть"))


# ---------- напоминание о бесплатном яйце ----------
def active_recently():
    """Кто заходил в приложение за последние 20 часов (по базе сервера)."""
    if not DB or not os.path.exists(DB):
        return set()
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
        rows = con.execute("SELECT id FROM users WHERE seen > ?", (int(time.time()) - 20 * 3600,)).fetchall()
        con.close()
        return {r[0] for r in rows}
    except Exception as e:
        print("База недоступна для напоминаний:", e, flush=True)
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
                targets = [u for u in list(state["subs"]) if u not in skip]
                sent = gone = 0
                for uid in targets:
                    try:
                        send(uid, "Бесплатное утиное яйцо уже ждёт. Внутри от 30 до 300 звёзд.\n\n<i>Выключить напоминания: /stop</i>",
                             reply_markup=play_button("Разбить яйцо", open="egg"), disable_notification=False)
                        sent += 1
                    except urllib.error.HTTPError as e:
                        if e.code == 403:    # человек заблокировал бота: больше не пишем
                            with lock:
                                state["subs"] = [x for x in state["subs"] if x != uid]
                            gone += 1
                    except Exception:
                        pass
                    time.sleep(0.05)   # не больше 20 сообщений в секунду
                save_state()
                print(f"Напоминания: отправлено {sent}, заблокировали {gone}", flush=True)
        except Exception as e:
            print("Ошибка напоминаний:", e, flush=True)
        time.sleep(300)


def main():
    offset = 0
    try:
        call("setMyCommands", commands=COMMANDS)
    except Exception as e:
        print("Команды не установлены:", e, flush=True)
    threading.Thread(target=remind_loop, daemon=True).start()
    print("Бот запущен", flush=True)
    while True:
        try:
            updates = call("getUpdates", offset=offset, timeout=50, allowed_updates=["message", "pre_checkout_query", "callback_query"])
        except Exception as e:  # сеть моргнула: ждём и пробуем снова
            print("Ошибка сети:", e, flush=True)
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
                if p:
                    line = {"time": int(time.time()), "user": m["from"]["id"], "stars": p["total_amount"], "payload": p["invoice_payload"], "charge": p["telegram_payment_charge_id"]}
                    with open(LOG, "a") as f:
                        f.write(json.dumps(line) + "\n")
                    print("Оплата:", line, flush=True)
                    send(m["chat"]["id"], f"Оплата прошла: +{p['total_amount']} звёзд на балансе.", reply_markup=play_button("Играть"))
                elif text.startswith("/start"):
                    on_start(m)
                elif text.startswith("/"):
                    on_command(m, text[1:].split()[0].split("@")[0].lower())
            except Exception as e:
                print("Ошибка обработки:", e, flush=True)


if __name__ == "__main__":
    main()
