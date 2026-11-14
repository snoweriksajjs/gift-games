"""Бот DuckChance: подтверждает оплату звёздами и считает приглашения.

Запуск:  TG_TOKEN=<токен бота> python3 bot_poller.py
Telegram ждёт ответ на pre_checkout_query не дольше 10 секунд, поэтому бот должен работать постоянно.
Токен в код не вписывается, он берётся из переменной окружения.

Приглашения: игрок делится ссылкой t.me/<бот>?start=ref_<его id>. Когда по ней впервые
приходит новый человек, бот присылает пригласившему кнопку с подписанным кодом бонуса.
Приложение проверяет подпись и начисляет звёзды.
"""
import hashlib, hmac, json, os, sys, time, urllib.request, urllib.parse

TOKEN = os.environ.get("TG_TOKEN") or sys.exit("Нужна переменная окружения TG_TOKEN")
API = f"https://api.telegram.org/bot{TOKEN}/"
SITE = os.environ.get("SITE", "https://snoweriksajjs.github.io/gift-games/")
CODE_KEY = os.environ.get("CODE_KEY", "duckchance-codes-v1")   # тот же ключ, что в js/core.js
REF_BONUS = int(os.environ.get("REF_BONUS", "100"))
VER = os.environ.get("APP_VER", "11")
LOG = os.environ.get("PAY_LOG", "payments.log")
SEEN = os.environ.get("SEEN_FILE", "seen_users.json")


def call(method, **params):
    data = urllib.parse.urlencode({k: json.dumps(v) if isinstance(v, (dict, list, bool)) else v for k, v in params.items()}).encode()
    with urllib.request.urlopen(API + method, data=data, timeout=70) as r:
        return json.load(r)["result"]


def make_code(kind, amount, nonce):
    sig = hmac.new(CODE_KEY.encode(), f"{kind}:{amount}:{nonce}".encode(), hashlib.sha256).hexdigest()[:10]
    return f"{kind}-{amount}-{nonce}-{sig}"


def play_button(text, **query):
    q = urllib.parse.urlencode({"v": VER, **query})
    return {"inline_keyboard": [[{"text": text, "web_app": {"url": f"{SITE}?{q}"}}]]}


def load_seen():
    try:
        return set(json.load(open(SEEN)))
    except Exception:
        return set()


def on_start(m, seen):
    uid, arg = m["from"]["id"], (m.get("text", "").split(" ", 1) + [""])[1].strip()
    is_new = uid not in seen
    seen.add(uid)
    json.dump(sorted(seen), open(SEEN, "w"))
    ref = arg[4:] if arg.startswith("ref_") and arg[4:].isdigit() else ""
    call("sendMessage", chat_id=m["chat"]["id"], text="DuckChance: игры на подарки за звёзды. Жмите «Играть».",
         reply_markup=play_button("Играть", **({"ref": ref} if ref else {})))
    # бонус пригласившему: только за нового человека и не за самого себя
    if ref and is_new and int(ref) != uid:
        code = make_code("R", REF_BONUS, str(uid))
        name = m["from"].get("first_name", "Друг")
        try:
            call("sendMessage", chat_id=int(ref), text=f"{name} пришёл по вашей ссылке. Заберите {REF_BONUS} звёзд.",
                 reply_markup=play_button(f"Забрать {REF_BONUS} звёзд", code=code))
            print("Приглашение:", ref, "<-", uid, flush=True)
        except Exception as e:  # пригласивший мог не запускать бота или заблокировать его
            print("Не удалось написать пригласившему", ref, e, flush=True)


def main():
    offset, seen = 0, load_seen()
    print("Бот запущен", flush=True)
    while True:
        try:
            updates = call("getUpdates", offset=offset, timeout=50, allowed_updates=["message", "pre_checkout_query"])
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
                m = u.get("message") or {}
                p = m.get("successful_payment")
                if p:
                    line = {"time": int(time.time()), "user": m["from"]["id"], "stars": p["total_amount"], "payload": p["invoice_payload"], "charge": p["telegram_payment_charge_id"]}
                    with open(LOG, "a") as f:
                        f.write(json.dumps(line) + "\n")
                    print("Оплата:", line, flush=True)
                elif m.get("text", "").startswith("/start"):
                    on_start(m, seen)
            except Exception as e:
                print("Ошибка обработки:", e, flush=True)


if __name__ == "__main__":
    main()
