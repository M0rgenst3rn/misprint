"""Erzeugt die Showcase-Bilder für die README (docs/images/).

Die Motive werden mit Pillow gezeichnet, der Druck-Look kommt aus derselben Engine
wie im Plugin (printer/core.js via tools/print-raw.js) – inklusive Gesamt-Deckkraft.
Aufruf: python3 tools/make-showcase.py
"""
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images")
TMP = tempfile.mkdtemp(prefix="msp-")
FONTS = "/System/Library/Fonts/Supplemental/"
IMPACT = FONTS + "Impact.ttf"
BLACK = FONTS + "Arial Black.ttf"
LABEL = "/System/Library/Fonts/Helvetica.ttc"
PAPER = (246, 243, 236)
INK = (22, 22, 26)
RED = (214, 40, 56)
BG = (226, 222, 214)
os.makedirs(OUT, exist_ok=True)
_n = 0


def font(path, size):
    return ImageFont.truetype(path, size)


def printed(img, params):
    """Wendet MS Printer (ganzes Dokument) auf ein RGB-Bild an."""
    global _n
    _n += 1
    a = os.path.join(TMP, f"a{_n}.rgb")
    o = os.path.join(TMP, f"o{_n}.rgb")
    with open(a, "wb") as f:
        f.write(img.convert("RGB").tobytes())
    subprocess.run(["node", os.path.join(ROOT, "tools", "print-raw.js"), a, str(img.width), str(img.height), json.dumps(params), o], check=True)
    return Image.frombytes("RGB", img.size, open(o, "rb").read())


def label(draw, xy, text, size=18, fill=(70, 64, 58), anchor="la"):
    draw.text(xy, text, font=font(LABEL, size), fill=fill, anchor=anchor)


def noises():
    return json.loads(subprocess.run(
        ["node", "-e", "console.log(JSON.stringify(require(process.argv[1]).NOISES))",
         os.path.join(ROOT, "printer", "core.js")], capture_output=True, text=True, check=True).stdout)


def flyer(w, h, dark=False):
    bg, fg = ((16, 16, 18), (240, 236, 228)) if dark else (PAPER, INK)
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    s = w / 420
    d.text((24 * s, 18 * s), "NIGHT" if dark else "FLYER", font=font(IMPACT, int(110 * s)), fill=fg)
    d.ellipse((24 * s, 160 * s, 144 * s, 280 * s), fill=RED)
    d.text((170 * s, 175 * s), "Sa. 21 Uhr\nKellerclub", font=font(BLACK, int(30 * s)), fill=fg)
    return im


def mini(w, h):
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    d.rectangle((14, 14, w * 0.58, h * 0.5), fill=INK)
    d.ellipse((w * 0.66, 14, w * 0.66 + h * 0.5, 14 + h * 0.5), fill=RED)
    d.rectangle((14, h * 0.64, w - 14, h * 0.8), fill=(40, 90, 200))
    return im


# ------------------------------------------------------------------ Hero
def hero():
    W, H = 1600, 640
    art = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(art)
    f = font(IMPACT, 250)
    l, t, r, b = f.getbbox("MS PRINTER")
    d.text(((W - (r - l)) // 2 - l, 40 - t), "MS PRINTER", font=f, fill=(232, 62, 140))
    f2 = font(BLACK, 40)
    txt = "TONER · KOPIERER · RISO · INKJET · RASTER · FAX"
    l, t, r, b = f2.getbbox(txt)
    d.text(((W - (r - l)) // 2 - l, 380), txt, font=f2, fill=INK)
    out = printed(art, {"texture": "riso", "scale": 110, "toner": 22, "dropout": 30, "grain": 35, "paperGrain": 35, "paperTone": 25, "strength": 70, "seed": 12})
    dd = ImageDraw.Draw(out)
    label(dd, (W // 2, H - 60), "Lässt das ganze Dokument aussehen wie gedruckt – ohne PNG-Texturen, abgestimmt auf dein Motiv", 26, (110, 100, 90), "ma")
    out.save(os.path.join(OUT, "hero.png"), optimize=True)


# ------------------------------------------------------------------ Vorher / Nachher (hell + dunkel)
def before_after():
    w, h = 640, 457
    rows = [
        (flyer(w, h), {"texture": "copy3", "scale": 110}, "Helles Motiv"),
        (flyer(w, h, True), {"texture": "copy3", "scale": 110}, "Dunkles Motiv – Auto-Anpassung zeigt helle Fehlstellen"),
    ]
    W, H = 2 * w + 3 * 20, len(rows) * (h + 50) + 20
    out = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(out)
    for k, (art, p, name) in enumerate(rows):
        y = 20 + k * (h + 50)
        out.paste(art, (20, y))
        out.paste(printed(art, p), (40 + w, y))
        label(d, (20 + w // 2, y + h + 8), f"{name} · Original", 19, anchor="ma")
        label(d, (40 + w + w // 2, y + h + 8), "MS Printer · Kopie 3. Gen. · Standard (35 %)", 19, anchor="ma")
    out.save(os.path.join(OUT, "vorher-nachher.png"), optimize=True)


# ------------------------------------------------------------------ Gesamt-Deckkraft
def strength():
    w, h = 300, 214
    art = flyer(w, h)
    vals = [15, 35, 60, 100]
    W = len(vals) * (w + 16) + 16
    out = Image.new("RGB", (W, h + 56), BG)
    d = ImageDraw.Draw(out)
    for k, v in enumerate(vals):
        x = 16 + k * (w + 16)
        out.paste(printed(art, {"texture": "copygrain", "strength": v}), (x, 16))
        label(d, (x + w // 2, h + 24), f"Gesamt-Deckkraft {v} %" + (" (Standard)" if v == 35 else ""), 17, anchor="ma")
    out.save(os.path.join(OUT, "deckkraft.png"), optimize=True)


# ------------------------------------------------------------------ Galerie aller Druckfehler
def gallery():
    ns = noises()
    cols, tw, th, gap, cap = 6, 230, 150, 16, 28
    groups = []
    for n in ns:
        if not groups or groups[-1][0] != n["group"]:
            groups.append((n["group"], []))
        groups[-1][1].append(n)
    head = 40
    H = gap + sum(head + ((len(i) + cols - 1) // cols) * (th + cap + gap) for _, i in groups)
    W = cols * (tw + gap) + gap
    out = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(out)
    art = mini(tw, th)
    y = gap
    for gname, items in groups:
        label(d, (gap, y + 8), gname.upper(), 20, (60, 54, 48))
        y += head
        for k, n in enumerate(items):
            x = gap + (k % cols) * (tw + gap)
            yy = y + (k // cols) * (th + cap + gap)
            out.paste(printed(art, {"texture": n["id"], "strength": 75, "seed": 5}), (x, yy))
            label(d, (x + tw // 2, yy + th + 4), n["name"], 17, anchor="ma")
        y += ((len(items) + cols - 1) // cols) * (th + cap + gap)
    out.save(os.path.join(OUT, "druckfehler.png"), optimize=True)


# ------------------------------------------------------------------ Regler-Demo
def controls():
    w, h = 300, 214
    art = flyer(w, h)
    base = {"texture": "copygrain", "strength": 60, "seed": 21}
    demos = [
        ("Standard", {}),
        ("Nur Toner", {"dropoutEnabled": False}),
        ("Nur Aussetzer", {"tonerEnabled": False}),
        ("Schmutz auf Papier 100 %", {"paperDirt": 100, "toner": 40}),
        ("Papierton + Struktur", {"paperTone": 60, "paperGrain": 70, "paperToneColor": "#e8d9b5"}),
        ("Toner farbig (Riso)", {"inkColor": "#2a3cff", "toner": 35}),
        ("Körnung 80 %", {"grain": 80}),
        ("Verlauf: Rahmen", {"fadeAmount": 90, "fadeStyle": "frame", "toner": 45, "dropout": 35}),
        ("+ 2. Druckfehler", {"texture2": "drumstreaks", "texture2Mix": 70, "texture2Mode": "add"}),
    ]
    cols, gap, cap = 3, 18, 30
    rows = (len(demos) + cols - 1) // cols
    W = cols * (w + gap) + gap
    H = rows * (h + cap + gap) + gap
    out = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(out)
    for k, (name, over) in enumerate(demos):
        x = gap + (k % cols) * (w + gap)
        y = gap + (k // cols) * (h + cap + gap)
        out.paste(printed(art, dict(base, **over)), (x, y))
        label(d, (x + w // 2, y + h + 4), name, 18, anchor="ma")
    out.save(os.path.join(OUT, "regler.png"), optimize=True)


if __name__ == "__main__":
    for f in ["dokument.png"]:
        p = os.path.join(OUT, f)
        if os.path.exists(p):
            os.remove(p)
    hero()
    before_after()
    strength()
    gallery()
    controls()
    print("Bilder geschrieben:", ", ".join(sorted(os.listdir(OUT))))
