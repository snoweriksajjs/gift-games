"""Анимированный баннер профиля DuckChance для бота.

Рисует карточку в стиле приглашений в чат: фон и символы подарка с обложки игрока кольцами вокруг аватарки,
рамка редкой коллекции, логотип, баланс, статистика и три самых дорогих подарка.
Кадры рисует Pillow, видео собирает ffmpeg (mp4 без звука, Telegram показывает его как анимацию).

    from profile_card import render
    path = render({...})      # путь к mp4, одинаковые данные берутся из кэша
"""
import hashlib, io, json, math, os, re, subprocess, tempfile, urllib.request
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("CARD_CACHE", os.path.join(HERE, "cache"))
SITE = os.environ.get("SITE", "https://snoweriksajjs.github.io/gift-games/")
FONT_DIR = "/usr/share/fonts/opentype/inter"
W, H, FPS, SECONDS = 1200, 676, 24, 3
os.makedirs(CACHE, exist_ok=True)


def _font(weight, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, f"Inter-{weight}.otf"), size)


def _catalog():
    """Каталог подарков берём из того же gifts.js, что и сайт."""
    if not hasattr(_catalog, "v"):
        src = open(os.path.join(HERE, "gifts.js"), encoding="utf-8").read()
        _catalog.v = {g["id"]: g for g in json.loads(src[src.index("["):src.rindex("]") + 1])}
    return _catalog.v


def _fetch(url):
    """Скачивает картинку один раз и хранит в кэше."""
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest()[:20])
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "DuckChanceBot"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
    return Image.open(path).convert("RGBA")


def _hex(c, default):
    c = c if isinstance(c, str) and re.match(r"^#[0-9a-fA-F]{6}$", c or "") else default
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def _fmt(n):
    return f"{int(round(n)):,}".replace(",", " ")


def _short(n):
    n = int(round(n))
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}".rstrip("0").rstrip(".") + "M"
    if n >= 10_000:
        return f"{round(n / 1000)}K"
    return _fmt(n)


def _radial(size, center, c1, c2, radius):
    """Радиальный градиент: c1 в центре, c2 по краям."""
    w, h = size
    small = Image.new("RGB", (w // 4, h // 4))
    px = small.load()
    cx, cy = center[0] / 4, center[1] / 4
    for y in range(h // 4):
        for x in range(w // 4):
            t = min(1, math.hypot(x - cx, y - cy) / (radius / 4))
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return small.resize(size, Image.BICUBIC).convert("RGBA")


def _tint(img, color, size):
    """Символ узора в нужном цвете: берём только форму (альфу)."""
    img = img.resize((size, size), Image.LANCZOS)
    solid = Image.new("RGBA", img.size, color + (255,))
    solid.putalpha(img.getchannel("A"))
    return solid


def _with_alpha(img, k):
    out = img.copy()
    out.putalpha(img.getchannel("A").point(lambda a: int(a * k)))
    return out


def _circle(img, d):
    img = img.convert("RGBA").resize((d, d), Image.LANCZOS)
    m = Image.new("L", (d * 4, d * 4), 0)
    ImageDraw.Draw(m).ellipse((0, 0, d * 4 - 1, d * 4 - 1), fill=255)
    img.putalpha(m.resize((d, d), Image.LANCZOS))
    return img


def _star(draw, cx, cy, r, fill):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    draw.polygon(pts, fill=fill)


def _tgstar(size):
    """Звезда Telegram Stars (форма и цвета из клиента Telegram Web), картинка img/star.png с сайта."""
    return _fetch(SITE + "img/star.png").resize((size, size), Image.LANCZOS)


def _star_text(layer, draw, cx, cy, text, font, fill, size):
    """Звезда и число рядом, вместе по центру точки (cx, cy)."""
    tw = draw.textlength(text, font=font)
    x = cx - (size + 6 + tw) / 2
    layer.alpha_composite(_tgstar(size), (int(x), int(cy - size / 2)))
    draw.text((x + size + 6, cy), text, font=font, fill=fill, anchor="lm")


def _rounded(size, radius, fill):
    w, h = size
    big = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), radius * 2, fill=fill)
    return big.resize(size, Image.LANCZOS)


def _key(d):
    return hashlib.sha1(json.dumps(d, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def render(d):
    """d: name, handle, photo, look {c1,c2,cp,sym,gift}, balance, gifts [ids], staked."""
    out = os.path.join(CACHE, f"card_{_key(d)}.mp4")
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    cat = _catalog()
    look = d.get("look") or {}
    c1 = _hex(look.get("c1"), "#5ea8ff")
    c2 = _hex(look.get("c2"), "#2f6fe0")
    cp = _hex(look.get("cp"), "#1f55b8")
    gifts = [cat[g] for g in (d.get("gifts") or []) if g in cat]
    gifts.sort(key=lambda g: -g["price"])
    value = sum(g["price"] for g in gifts)
    special = cat.get(look.get("gift") or "")
    top_price = {}
    for g in cat.values():
        top_price[g["gift"]] = max(top_price.get(g["gift"], 0), g["price"])
    if special and top_price.get(special["gift"], 0) < 5000:
        special = None

    AX, AY, AR = 300, 285, 118            # центр и радиус аватарки

    # ---------- неподвижный слой ----------
    base = _radial((W, H), (AX, AY), c1, c2, 900)
    shade = Image.new("RGBA", (W, H))
    sd = ImageDraw.Draw(shade)
    for x in range(560, W):           # справа чуть темнее, чтобы текст читался
        sd.line([(x, 0), (x, H)], fill=(0, 0, 0, int(70 * min(1, (x - 560) / 240))))
    base.alpha_composite(shade)

    # символы узора, по кольцам
    sym = None
    if look.get("sym"):
        try:
            sym = _fetch(look["sym"])
        except Exception:
            sym = None
    rings = []
    if sym:
        for k, (r, n, o, s) in enumerate([(178, 8, .5, 50), (258, 12, .34, 46), (345, 16, .21, 40), (440, 22, .12, 36), (545, 28, .07, 32)]):
            rings.append((r, n, _with_alpha(_tint(sym, cp, s), o), s, 1 if k % 2 else -1, k))

    # аватарка
    try:
        av = _circle(_fetch(d["photo"]), AR * 2) if d.get("photo") else None
    except Exception:
        av = None
    if av is None:
        av = Image.new("RGBA", (AR * 2, AR * 2))
        g2 = _radial((AR * 2, AR * 2), (AR, AR * 0.6), tuple(min(255, int(v * 1.15)) for v in c1), c2, AR * 2)
        av = _circle(g2, AR * 2)
        ImageDraw.Draw(av).text((AR, AR + 4), (d.get("name") or "?").strip()[:1].upper(), font=_font("Bold", 110), fill=(255, 255, 255), anchor="mm")

    # рамка: у редкой коллекции вращается цветное кольцо, у остальных просто белое
    ring_img = None
    RR = AR + 14
    if special:
        size = RR * 2
        ring_img = Image.new("RGBA", (size * 2, size * 2))
        rd = ImageDraw.Draw(ring_img)
        cols = [c1, (255, 255, 255), c2, cp, c1]
        steps = 180
        for i in range(steps):
            t = i / steps * (len(cols) - 1)
            a, b = cols[int(t)], cols[min(len(cols) - 1, int(t) + 1)]
            f = t - int(t)
            col = tuple(int(a[j] + (b[j] - a[j]) * f) for j in range(3)) + (255,)
            rd.pieslice((0, 0, size * 2 - 1, size * 2 - 1), i * 360 / steps, (i + 1) * 360 / steps + 1, fill=col)
        hole = Image.new("L", (size * 2, size * 2), 0)
        ImageDraw.Draw(hole).ellipse((22, 22, size * 2 - 23, size * 2 - 23), fill=255)
        ring_img.putalpha(Image.composite(Image.new("L", hole.size, 0), ring_img.getchannel("A"), hole))   # дырка под аватарку
        ring_img = ring_img.resize((size, size), Image.LANCZOS)

    # текст и логотип
    txt = Image.new("RGBA", (W, H))
    td = ImageDraw.Draw(txt)
    name = (d.get("name") or "Игрок")[:22]
    fs = 52
    while fs > 30 and td.textlength(name, font=_font("Bold", fs)) > 470:
        fs -= 2
    td.text((AX, 470), name, font=_font("Bold", fs), fill=(255, 255, 255), anchor="mm")
    if d.get("handle"):
        td.text((AX, 516), "@" + d["handle"], font=_font("Medium", 30), fill=(255, 255, 255, 200), anchor="mm")
    if special:
        label = special["gift"]
        f = _font("SemiBold", 24)
        w = td.textlength(label, font=f) + 66
        pill = _rounded((int(w), 44), 22, (255, 255, 255, 46))
        x0 = int(AX - w / 2)
        txt.alpha_composite(pill, (x0, 548))
        _star(td, x0 + 26, 570, 11, (255, 255, 255))
        td.text((x0 + 44, 570), label, font=f, fill=(255, 255, 255), anchor="lm")

    L = 610
    try:
        mark = _fetch(SITE + "img/logo-mark.png")
        word = _fetch(SITE + "img/logo-word.png")
        mh = 46
        mark = mark.resize((int(mark.width * mh / mark.height), mh), Image.LANCZOS)
        wh = 30
        word = word.resize((int(word.width * wh / word.height), wh), Image.LANCZOS)
    except Exception:
        mark = word = None
    td.text((L, 168), "БАЛАНС", font=_font("SemiBold", 24), fill=(255, 255, 255, 170))
    bal = _fmt(d.get("balance") or 0)
    bf = 92
    while bf > 50 and td.textlength(bal, font=_font("Bold", bf)) > 470:
        bf -= 4
    txt.alpha_composite(_tgstar(74), (L - 2, 252 - 37))
    td.text((L + 86, 252), bal, font=_font("Bold", bf), fill=(255, 255, 255), anchor="lm")

    stats = [(_fmt(len(gifts)), "подарков"), ("*" + _short(value), "коллекция"), (_fmt(d.get("staked") or 0), "в стейкинге")]
    sw = 172
    for i, (v, lab) in enumerate(stats):
        x = L + i * (sw + 12)
        txt.alpha_composite(_rounded((sw, 92), 20, (0, 0, 0, 70)), (x, 318))
        if v.startswith("*"):
            _star_text(txt, td, x + sw / 2, 352, v[1:], _font("Bold", 34), (255, 255, 255), 32)
        else:
            td.text((x + sw / 2, 352), v, font=_font("Bold", 34), fill=(255, 255, 255), anchor="mm")
        td.text((x + sw / 2, 388), lab, font=_font("Medium", 20), fill=(255, 255, 255, 170), anchor="mm")

    tiles = []
    for i, g in enumerate(gifts[:3]):
        x = L + i * (sw + 12)
        tile = _radial((sw, 150), (sw / 2, 60), _hex(g.get("c1"), "#888888"), _hex(g.get("c2"), "#555555"), 150)
        m = _rounded((sw, 150), 22, (255, 255, 255, 255)).getchannel("A")
        tile.putalpha(m)
        try:
            gi = _fetch(g["img"]).resize((112, 112), Image.LANCZOS)
        except Exception:
            gi = None
        tiles.append((x, tile, gi, i))
        _star_text(txt, td, x + sw / 2, 628, _short(g["price"]), _font("SemiBold", 25), (255, 255, 255), 26)
    if not gifts:
        td.text((L, 470), "Подарков пока нет.\nВыиграйте первый в DuckChance.", font=_font("Medium", 28), fill=(255, 255, 255, 190), spacing=10)

    # блик, который проходит по карточке
    band = Image.new("RGBA", (260, H * 2))
    bd = ImageDraw.Draw(band)
    for x in range(260):
        a = int(46 * math.exp(-((x - 130) / 60) ** 2))
        bd.line([(x, 0), (x, H * 2)], fill=(255, 255, 255, a))
    band = band.rotate(-18, expand=True, resample=Image.BICUBIC)

    # ---------- кадры ----------
    tmp = tempfile.mkdtemp(dir=CACHE)
    n = FPS * SECONDS
    for fi in range(n):
        t = fi / n
        fr = base.copy()
        for r, cnt, img, s, dirn, k in rings:
            off = dirn * t * (2 * math.pi / cnt)       # за цикл кольцо сдвигается ровно на один символ
            for i in range(cnt):
                a = (i + (k % 2) * 0.5) / cnt * 2 * math.pi + off
                fr.alpha_composite(img, (int(AX + math.cos(a) * r - s / 2), int(AY + math.sin(a) * r * 0.82 - s / 2)))
        if ring_img is not None:
            rot = ring_img.rotate(-360 * t, resample=Image.BICUBIC)
            fr.alpha_composite(rot, (AX - RR, AY - RR))
        else:
            halo = Image.new("RGBA", (RR * 2, RR * 2))
            ImageDraw.Draw(halo).ellipse((4, 4, RR * 2 - 5, RR * 2 - 5), outline=(255, 255, 255, 150), width=8)
            fr.alpha_composite(halo, (AX - RR, AY - RR))
        fr.alpha_composite(av, (AX - AR, AY - AR))
        if special:          # маленький подарок на аватарке
            try:
                si = _fetch(special["img"]).resize((92, 92), Image.LANCZOS)
                fr.alpha_composite(si, (AX + 52, AY + 40 + int(4 * math.sin(t * 2 * math.pi))))
            except Exception:
                pass
        for x, tile, gi, i in tiles:
            fr.alpha_composite(tile, (x, 452))
            if gi is not None:
                dy = int(6 * math.sin(t * 2 * math.pi + i * 1.3))
                fr.alpha_composite(gi, (x + (sw - 112) // 2, 470 + dy))
        if mark is not None:
            ang = 6 * math.sin(t * 2 * math.pi)
            mk = mark.rotate(ang, resample=Image.BICUBIC, expand=True)
            fr.alpha_composite(mk, (L, 70 - (mk.height - 46) // 2))
            fr.alpha_composite(word, (L + mark.width + 14, 78))
        fr.alpha_composite(txt)
        # блик идёт в первой половине цикла, потом пауза
        bx = int(-400 + (W + 800) * min(1, t / 0.55))
        fr.alpha_composite(band, (bx, -H // 2))
        fr.convert("RGB").save(os.path.join(tmp, f"f{fi:03d}.png"), compress_level=1)

    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%03d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "veryfast", "-movflags", "+faststart", "-an", out + ".part.mp4"],
                   check=True)
    os.replace(out + ".part.mp4", out)     # в кэш попадает только готовое видео
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    return out


def render_ref(d):
    """Реферальный баннер: «<имя> зовёт тебя», заголовок, кнопка «Забрать бесплатно» и парящие дорогие подарки.
    d: name, photo. Возвращает (mp4, jpg первого кадра)."""
    out = os.path.join(CACHE, f"ref_{_key({'ref': 2, **d})}.mp4")
    thumb = out[:-4] + ".jpg"
    if os.path.exists(out) and os.path.getsize(out) > 0 and os.path.exists(thumb):
        return out, thumb
    cat = list(_catalog().values())
    pick = lambda name: max((g for g in cat if g["gift"] == name), key=lambda g: g["price"], default=None)
    hero = [g for g in (pick("Plush Pepe"), pick("Durov's Cap"), pick("Heart Locket")) if g]

    # фон: тёплая темнота с золотым светом справа
    base = _radial((W, H), (930, 330), (74, 58, 22), (11, 11, 13), 820)
    # звёзды Telegram узором по кругу вокруг подарков
    star = _tgstar(40)
    rings = [(220, 9, .30, 34, 1), (330, 14, .18, 30, -1), (450, 20, .10, 26, 1)]
    ring_imgs = [(r, n, _with_alpha(star.resize((sz, sz), Image.LANCZOS), o), sz, dr) for r, n, o, sz, dr in rings]

    txt = Image.new("RGBA", (W, H))
    td = ImageDraw.Draw(txt)
    L = 70
    try:
        mark = _fetch(SITE + "img/logo-mark.png")
        word = _fetch(SITE + "img/logo-word.png")
        mark = mark.resize((int(mark.width * 40 / mark.height), 40), Image.LANCZOS)
        word = word.resize((int(word.width * 26 / word.height), 26), Image.LANCZOS)
        txt.alpha_composite(mark, (L, 44))
        txt.alpha_composite(word, (L + mark.width + 12, 51))
    except Exception:
        pass
    # плашка «Имя зовёт тебя»
    name = (d.get("name") or "Друг").strip()[:18]
    inv = f"{name} зовёт тебя"
    f = _font("SemiBold", 26)
    pw = int(td.textlength(inv, font=f)) + 92
    txt.alpha_composite(_rounded((pw, 56), 28, (255, 255, 255, 34)), (L, 112))
    try:
        av = _circle(_fetch(d["photo"]), 40) if d.get("photo") else None
    except Exception:
        av = None
    if av is None:
        av = _circle(Image.new("RGBA", (40, 40), (253, 211, 17, 255)), 40)
        ImageDraw.Draw(av).text((20, 21), name[:1].upper(), font=_font("Bold", 22), fill=(20, 20, 20), anchor="mm")
    txt.alpha_composite(av, (L + 8, 120))
    td.text((L + 60, 140), inv, font=f, fill=(255, 255, 255), anchor="lm")
    # заголовок
    hf = _font("ExtraBold", 74)
    td.text((L, 196), "Выбивай", font=hf, fill=(255, 255, 255))
    td.text((L, 278), "NFT-подарки", font=hf, fill=(253, 211, 17))
    td.text((L, 360), "Telegram", font=hf, fill=(255, 255, 255))
    sf = _font("Medium", 30)
    td.text((L, 466), "Каждый день бесплатное яйцо", font=sf, fill=(255, 255, 255, 215))
    td.text((L, 506), "с подарком внутри", font=sf, fill=(255, 255, 255, 215))

    cta_text = "Забрать бесплатно"
    cf = _font("Bold", 32)
    cw = int(td.textlength(cta_text, font=cf)) + 110
    cta = _rounded((cw, 72), 36, (253, 211, 17, 255))
    cd = ImageDraw.Draw(cta)
    cd.text((34, 36), cta_text, font=cf, fill=(17, 17, 17), anchor="lm")
    ax = cw - 50
    cd.line([(ax - 12, 36), (ax + 10, 36)], fill=(17, 17, 17), width=5)
    cd.line([(ax + 1, 26), (ax + 11, 36), (ax + 1, 46)], fill=(17, 17, 17), width=5, joint="curve")

    # подарки на подсвеченных подложках
    spots = [(905, 340, 300), (1092, 150, 150), (1075, 545, 150)]
    tiles = []
    for (cx, cy, sz), g in zip(spots, hero):
        glow = Image.new("RGBA", (sz * 2, sz * 2))
        gc = _hex(g.get("c1"), "#888888")
        gd = ImageDraw.Draw(glow)
        for i in range(30, 0, -1):
            r = sz * i / 30
            gd.ellipse((sz - r, sz - r, sz + r, sz + r), fill=gc + (int(10 * (30 - i) / 30 + 2),))
        disk = _circle(_radial((sz, sz), (sz / 2, sz * .4), gc, _hex(g.get("c2"), "#444444"), sz * .8), sz)
        try:
            gi = _fetch(g["img"]).resize((int(sz * .82), int(sz * .82)), Image.LANCZOS)
        except Exception:
            gi = None
        tiles.append((cx, cy, sz, glow, disk, gi))
    twinkles = [(760, 120, 26, 0), (1180, 330, 22, .3), (820, 600, 24, .6), (990, 70, 20, .15), (760, 450, 18, .45), (1180, 640, 20, .8)]

    band = Image.new("RGBA", (120, 140))
    bd = ImageDraw.Draw(band)
    for x in range(120):
        bd.line([(x, 0), (x, 140)], fill=(255, 255, 255, int(120 * math.exp(-((x - 60) / 24) ** 2))))
    band = band.rotate(-20, expand=True, resample=Image.BICUBIC)

    tmp = tempfile.mkdtemp(dir=CACHE)
    n = FPS * SECONDS
    for fi in range(n):
        t = fi / n
        fr = base.copy()
        for r, cnt, img, sz, dr in ring_imgs:
            off = dr * t * (2 * math.pi / cnt)
            for i in range(cnt):
                a = i / cnt * 2 * math.pi + off
                fr.alpha_composite(img, (int(905 + math.cos(a) * r * 1.1 - sz / 2), int(340 + math.sin(a) * r * .85 - sz / 2)))
        for k, (cx, cy, sz, glow, disk, gi) in enumerate(tiles):
            dy = int((10 if k == 0 else 7) * math.sin(t * 2 * math.pi + k * 2.1))
            fr.alpha_composite(glow, (cx - sz, cy - sz + dy))
            fr.alpha_composite(disk, (cx - sz // 2, cy - sz // 2 + dy))
            if gi is not None:
                ang = 4 * math.sin(t * 2 * math.pi + k)
                gr = gi.rotate(ang, resample=Image.BICUBIC, expand=True)
                fr.alpha_composite(gr, (cx - gr.width // 2, cy - gr.height // 2 + dy))
        for x, y, sz, ph in twinkles:
            k = .55 + .45 * math.sin((t + ph) * 2 * math.pi)
            s2 = max(4, int(sz * (.6 + .4 * k)))
            fr.alpha_composite(_with_alpha(star.resize((s2, s2), Image.LANCZOS), k), (x - s2 // 2, y - s2 // 2))
        fr.alpha_composite(txt)
        # кнопка дышит, по ней пробегает блик
        pulse = 1 + .035 * math.sin(t * 4 * math.pi)
        c2 = cta.resize((int(cw * pulse), int(72 * pulse)), Image.LANCZOS)
        if t < .5:
            c2 = c2.copy()
            sh = Image.new("RGBA", c2.size)
            sh.alpha_composite(band, (int(-160 + (c2.width + 200) * t / .5), -30))
            sh.putalpha(Image.composite(sh.getchannel("A"), Image.new("L", c2.size, 0), c2.getchannel("A").point(lambda a: 255 if a > 128 else 0)))
            c2.alpha_composite(sh)
        fr.alpha_composite(c2, (int(L + cw / 2 - c2.width / 2), int(576 - c2.height / 2 + 4)))
        frame = fr.convert("RGB")
        frame.save(os.path.join(tmp, f"f{fi:03d}.png"), compress_level=1)
        if fi == 0:
            frame.save(thumb, quality=88)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%03d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "veryfast", "-movflags", "+faststart", "-an", out + ".part.mp4"],
                   check=True)
    os.replace(out + ".part.mp4", out)
    for f2 in os.listdir(tmp):
        os.remove(os.path.join(tmp, f2))
    os.rmdir(tmp)
    return out, thumb


if __name__ == "__main__":      # проверка: python3 profile_card.py data.json
    import sys, time
    t0 = time.time()
    d = json.load(open(sys.argv[1]))
    print(render_ref(d) if d.get("ref") else render(d), f"{time.time() - t0:.1f} c")
