"""Каталог подарков для сервера: тот же gifts.js, что у сайта. Подарок = коллекция + модель + фон («c12.5.33»),
старые номера g0…g8176 переводятся через таблицу legacy. Узор только для красоты.
Цена = минимальная цена коллекции на рынке (в звёздах) × редкость модели и фона, не больше ×15."""
import json, os, re
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
CDN = "https://cdn.changes.tg/gifts"
D, floors, MM, BM, _cache = {}, [], [], [], {}
ID = re.compile(r"^c(\d+)\.(\d+)\.(\d+)$")


def _load():
    if D:
        return
    for path in (os.path.join(HERE, "gifts.js"), os.path.join(HERE, "..", "gifts.js")):
        if os.path.exists(path):
            src = open(path, encoding="utf-8").read()
            start = src.index("window.GIFT_DATA = ") + len("window.GIFT_DATA = ")
            D.update(json.loads(src[start:src.index(";\n", start)]))
            break
    else:
        raise FileNotFoundError("gifts.js")
    for c in D["cols"]:
        floors.append(c[1])
        mx = max(m[1] for m in c[2])
        MM.append([(mx / max(1, m[1])) ** 0.7 for m in c[2]])
        bx = max(b[1] for b in c[3])
        BM.append([(bx / max(1, b[1])) ** 0.5 * (1.35 if D["bds"][b[0]][0] in ("Black", "Onyx Black") else 1) for b in c[3]])


def _hash(s):
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def parse(gid):
    _load()
    if not isinstance(gid, str):
        return None
    if gid.startswith("g") and gid[1:].isdigit():
        i = int(gid[1:])
        return parse(D["legacy"][i]) if i < len(D["legacy"]) and D["legacy"][i] else None
    m = ID.match(gid)
    if not m:
        return None
    ci, mi, li = map(int, m.groups())
    if ci < len(D["cols"]) and mi < len(D["cols"][ci][2]) and li < len(D["cols"][ci][3]):
        return ci, mi, li
    return None


def mult(ci, mi, li):
    return min(15, MM[ci][mi] * BM[ci][li])


def get(gid):
    g = _cache.get(gid)
    if g:
        return g
    p = parse(gid)
    if not p:
        return None
    ci, mi, li = p
    c = D["cols"][ci]
    m, b = c[2][mi], D["bds"][c[3][li][0]]
    key = D["legacy"][int(gid[1:])] if gid.startswith("g") else gid
    symbol = c[4][_hash(key) % len(c[4])]
    g = {"id": gid, "gift": c[0], "model": m[0], "backdrop": b[0], "symbol": symbol, "ci": ci, "mi": mi, "li": li,
         "rare": m[1] / 10, "brare": c[3][li][1] / 10, "c1": b[1], "c2": b[2], "cp": b[3], "ct": b[4], "mult": mult(ci, mi, li),
         "price": max(1, int(round(floors[ci] * mult(ci, mi, li)))),
         "img": f"{CDN}/models/{quote(c[0])}/png/{quote(m[0])}.png", "sym": f"{CDN}/patterns/{quote(c[0])}/png/{quote(symbol)}.png"}
    _cache[gid] = g
    return g


def top_of(ci):
    """Самый дорогой подарок коллекции."""
    c = D["cols"][ci]
    best = max(((mi, li) for mi in range(len(c[2])) for li in range(len(c[3]))), key=lambda x: mult(ci, *x))
    return get(f"c{ci}.{best[0]}.{best[1]}")


def base_floors():
    _load()
    return {c[0]: c[1] for c in D["cols"]}


def set_floors(f):
    _load()
    for i, c in enumerate(D["cols"]):
        floors[i] = f.get(c[0]) or c[1]
    for g in _cache.values():
        g["price"] = max(1, int(round(floors[g["ci"]] * g["mult"])))


class _Lazy:
    """Похож на словарь {номер: подарок}; values() отдаёт самый дорогой подарок каждой коллекции."""
    def __getitem__(self, k):
        g = get(k)
        if g is None:
            raise KeyError(k)
        return g

    def __contains__(self, k):
        return get(k) is not None

    def get(self, k, default=None):
        return get(k) or default

    def values(self):
        _load()
        return [top_of(ci) for ci in range(len(D["cols"]))]


def catalog():
    _load()
    return _Lazy()
