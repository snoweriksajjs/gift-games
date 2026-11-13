"""Бот для оплаты звёздами: подтверждает счета и записывает успешные платежи.

Запуск:  TG_TOKEN=<токен бота> python3 bot_poller.py
Telegram ждёт ответ на pre_checkout_query не дольше 10 секунд, поэтому бот должен работать постоянно.
Токен в код не вписывается, он берётся из переменной окружения.
"""
import json, os, sys, time, urllib.request, urllib.parse

TOKEN = os.environ.get("TG_TOKEN") or sys.exit("Нужна переменная окружения TG_TOKEN")
API = f"https://api.telegram.org/bot{TOKEN}/"
LOG = os.environ.get("PAY_LOG", "payments.log")


def call(method, **params):
    data = urllib.parse.urlencode({k: json.dumps(v) if isinstance(v, (dict, list, bool)) else v for k, v in params.items()}).encode()
    with urllib.request.urlopen(API + method, data=data, timeout=70) as r:
        return json.load(r)["result"]


def main():
    offset = 0
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
                call("sendMessage", chat_id=m["chat"]["id"], text="Игры на подарки. Нажмите «Играть» рядом с полем ввода.")


if __name__ == "__main__":
    main()
