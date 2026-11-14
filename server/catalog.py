"""Каталог подарков для сервера: тот же gifts.js, что у сайта (сжатый формат GIFT_DATA).
Цена подарка = минимальная цена коллекции на рынке (в звёздах) × множитель редкости модели, фона и символа."""
import json, os
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
CDN = "https://cdn.changes.tg/gifts"
_cat, _floors = {}, {}


def _load():
    for path in (os.path.join(HERE, "gifts.js"), os.path.join(HERE, "..", "gifts.js")):
        if os.path.exists(path):
            src = open(path, encoding="utf-8").read()
            start = src.index("window.GIFT_DATA = ") + len("window.GIFT_DATA = ")
            return json.loads(src[start:src.index(";\n", start)])
    raise FileNotFoundError("gifts.js")


def catalog():
    """{id: подарок} с полями как на сайте: gift, model, backdrop, symbol, c1, c2, cp, ct, mult, price, img, sym."""
    if not _cat:
        d = _load()
        for ci, (name, floor) in enumerate(d["cols"]):
            _floors.setdefault(name, floor)
        for i, (ci, model, bi, symbol, mult, rare, brare, srare) in enumerate(d["items"]):
            gift, b = d["cols"][ci][0], d["bds"][bi]
            _cat[f"g{i}"] = {"id": f"g{i}", "gift": gift, "model": model, "backdrop": b[0], "symbol": symbol, "mult": mult,
                             "rare": rare, "brare": brare, "srare": srare, "c1": b[1], "c2": b[2], "cp": b[3], "ct": b[4],
                             "img": f"{CDN}/models/{quote(gift)}/png/{quote(model)}.png", "sym": f"{CDN}/patterns/{quote(gift)}/png/{quote(symbol)}.png"}
        set_floors({})
    return _cat


def base_floors():
    catalog()
    return dict(_floors)


def set_floors(floors):
    """Новые минимальные цены коллекций: пересчитать цены всех подарков."""
    base = _floors
    for g in _cat.values():
        f = floors.get(g["gift"]) or base.get(g["gift"]) or 1
        g["price"] = max(1, int(round(f * g["mult"])))
