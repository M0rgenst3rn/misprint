"""Erzeugt die Showcase-Bilder für die README (docs/images/).

Schrift wird mit Pillow gerendert, der Druck-Effekt kommt aus derselben Engine
wie im Plugin (printer/core.js via tools/print-raw.js).
Aufruf: python3 tools/make-showcase.py
"""
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images")
TMP = tempfile.mkdtemp(prefix="msp-")
FONTS = "/System/Library/Fonts/Supplemental/"
IMPACT = FONTS + "Impact.ttf"
BLACK = FONTS + "Arial Black.ttf"
LABEL = "/System/Library/Fonts/Helvetica.ttc"

PAPER = (244, 241, 233)
os.makedirs(OUT, exist_ok=True)
_n = 0


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def text_alpha(text, font_path, size, pad=40):
    font = ImageFont.truetype(font_path, size)
    l, t, r, b = font.getbbox(text)
    img = Image.new("L", (r - l + pad * 2, b - t + pad * 2), 0)
    ImageDraw.Draw(img).text((pad - l, pad - t), text, font=font, fill=255)
    return img


def rect_alpha(w, h, m=16):
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).rectangle((m, m, w - m, h - m), fill=255)
    return img


def run(alpha_img, params):
    global _n
    _n += 1
    w, h = alpha_img.size
    a = os.path.join(TMP, f"a{_n}.raw")
    pre = os.path.join(TMP, f"o{_n}")
    with open(a, "wb") as f:
        f.write(alpha_img.tobytes())
    subprocess.run(["node", os.path.join(ROOT, "tools", "print-raw.js"), a, str(w), str(h), json.dumps(params), pre], check=True)
    return {k: Image.frombytes("L", (w, h), open(f"{pre}.{k}", "rb").read()) for k in ["mask", "toner", "stray", "misreg", "light"]}


def render(base, alpha_img, params, color, pos=(0, 0)):
    """Setzt Ebene + Effekt-Ebenen wie in Photoshop auf base zusammen."""
    p = dict(params)
    r = run(alpha_img, p)
    w, h = alpha_img.size
    region = base.crop((pos[0], pos[1], pos[0] + w, pos[1] + h))
    ink = hexrgb(p.get("inkColor", "#161616"))
    if p.get("misregEnabled"):
        mis = Image.new("RGB", (w, h), hexrgb(p.get("misregColor", "#00a0e0")))
        region = Image.composite(ImageChops.multiply(region, mis), region, r["misreg"])
    vis = ImageChops.multiply(alpha_img, r["mask"])
    region.paste(Image.new("RGB", (w, h), color), (0, 0), vis)
    toner_vis = ImageChops.multiply(r["toner"], r["mask"])
    region = Image.composite(ImageChops.multiply(region, Image.new("RGB", (w, h), ink)), region, toner_vis)
    region.paste(Image.new("RGB", (w, h), color), (0, 0), r["stray"])
    base.paste(region, pos)


def label(draw, xy, text, size=18, fill=(90, 84, 78), anchor="la"):
    draw.text(xy, text, font=ImageFont.truetype(LABEL, size), fill=fill, anchor=anchor)


def noises():
    return json.loads(subprocess.run(
        ["node", "-e", "console.log(JSON.stringify(require(process.argv[1]).NOISES))",
         os.path.join(ROOT, "printer", "core.js")], capture_output=True, text=True, check=True).stdout)


# ------------------------------------------------------------------ Hero
def hero():
    W, H = 1600, 640
    img = Image.new("RGB", (W, H), PAPER)
    a = text_alpha("MS PRINTER", IMPACT, 250)
    p = {"texture": "riso", "scale": 110, "intensity": 80, "toner": 10, "dropout": 28, "grain": 35, "edgeRoughness": 2,
         "misregEnabled": True, "misregX": 9, "misregY": 6, "misregColor": "#ffd23f", "misregOpacity": 95, "seed": 12,
         "strayAmount": 35, "strayDistance": 22}
    render(img, a, p, (232, 62, 140), ((W - a.size[0]) // 2, 40))
    b = text_alpha("TONER · KOPIERER · RISO · INKJET · RASTER · FAX", BLACK, 40)
    render(img, b, {"texture": "copygrain", "intensity": 70, "toner": 25, "dropout": 18, "grain": 30, "seed": 3}, (30, 30, 34),
           ((W - b.size[0]) // 2, 400))
    d = ImageDraw.Draw(img)
    label(d, (W // 2, H - 50), "Druckerfehler & Kopierer-Look für Photoshop – auf Ebenen oder als Overlay für das ganze Dokument",
          25, (110, 100, 90), "ma")
    img.save(os.path.join(OUT, "hero.png"), optimize=True)


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
    H = gap
    for _, items in groups:
        H += head + ((len(items) + cols - 1) // cols) * (th + cap + gap)
    W = cols * (tw + gap) + gap
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    y = gap
    for gname, items in groups:
        label(d, (gap, y + 8), gname.upper(), 20, (60, 54, 48))
        y += head
        for k, n in enumerate(items):
            x = gap + (k % cols) * (tw + gap)
            yy = y + (k // cols) * (th + cap + gap)
            render(img, rect_alpha(tw, th, 10), {"texture": n["id"], "intensity": 85, "toner": 25, "dropout": 25, "grain": 20, "seed": 5},
                   (40, 44, 52), (x, yy))
            label(d, (x + tw // 2, yy + th + 4), n["name"], 17, (70, 64, 58), "ma")
        y += ((len(items) + cols - 1) // cols) * (th + cap + gap)
    img.save(os.path.join(OUT, "druckfehler.png"), optimize=True)


# ------------------------------------------------------------------ Regler-Demo
def controls():
    a = text_alpha("PRINT", IMPACT, 140, pad=36)
    tw, th = a.size
    base = {"texture": "copygrain", "intensity": 75, "toner": 25, "dropout": 20, "grain": 20, "seed": 21}
    demos = [
        ("Intensität 30 %", {"intensity": 30}),
        ("Intensität 75 %", {}),
        ("Intensität 100 %", {"intensity": 100, "toner": 40, "dropout": 35}),
        ("Nur Toner (dunkel)", {"dropout": 0, "toner": 45}),
        ("Nur Aussetzer (hell)", {"toner": 0, "dropout": 40, "grain": 0}),
        ("Körnung 80 %", {"grain": 80}),
        ("Kantenrauheit 6 px", {"edgeRoughness": 6}),
        ("Streu-Toner", {"strayAmount": 80, "strayDistance": 30}),
        ("Fehldruck-Versatz", {"misregEnabled": True, "misregX": 6, "misregY": 4, "misregColor": "#00a0e0", "misregOpacity": 80}),
        ("Verlauf von unten", {"fadeAmount": 90, "fadeStyle": "bottom", "intensity": 100, "dropout": 45}),
        ("Toner farbig (Riso)", {"inkColor": "#2a3cff", "inkOpacity": 90, "toner": 35}),
        ("+ 2. Druckfehler", {"texture2": "drumstreaks", "texture2Mix": 70, "texture2Mode": "add"}),
    ]
    cols, gap, cap = 3, 24, 34
    rows = (len(demos) + cols - 1) // cols
    W = cols * (tw + gap) + gap
    H = rows * (th + cap + gap) + gap
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    for k, (name, over) in enumerate(demos):
        x = gap + (k % cols) * (tw + gap)
        y = gap + (k // cols) * (th + cap + gap)
        render(img, a, dict(base, **over), (214, 40, 56), (x, y))
        label(d, (x + tw // 2, y + th + 2), name, 19, (70, 64, 58), "ma")
    img.save(os.path.join(OUT, "regler.png"), optimize=True)


# ------------------------------------------------------------------ Dokument-Modus
def document_mode():
    W, H = 1400, 520
    clean = Image.new("RGB", (W // 2 - 10, H), PAPER)
    d = ImageDraw.Draw(clean)
    d.rectangle((40, 40, clean.size[0] - 40, 260), fill=(26, 26, 30))
    d.text((70, 90), "FLYER", font=ImageFont.truetype(IMPACT, 130), fill=PAPER)
    d.ellipse((60, 300, 260, 500), fill=(214, 40, 56))
    d.text((290, 320), "Sa. 21 Uhr\nKellerclub\nEintritt frei", font=ImageFont.truetype(BLACK, 40), fill=(26, 26, 30))
    printed = clean.copy()
    w, h = printed.size
    full = Image.new("L", (w, h), 255)
    r = run(full, {"target": "document", "texture": "copy3", "scale": 120, "intensity": 85, "toner": 18, "dropout": 22, "grain": 40, "seed": 9})
    printed = Image.composite(Image.new("RGB", (w, h), (20, 20, 22)), printed, r["toner"])
    printed = Image.composite(Image.new("RGB", (w, h), PAPER), printed, r["light"])
    out = Image.new("RGB", (W, H + 40), (232, 228, 220))
    out.paste(clean, (0, 0))
    out.paste(printed, (W // 2 + 10, 0))
    dd = ImageDraw.Draw(out)
    label(dd, (W // 4, H + 8), "Original", 20, (70, 64, 58), "ma")
    label(dd, (3 * W // 4, H + 8), "Ziel „Ganzes Dokument“ · Kopie 3. Gen.", 20, (70, 64, 58), "ma")
    out.save(os.path.join(OUT, "dokument.png"), optimize=True)


if __name__ == "__main__":
    hero()
    gallery()
    controls()
    document_mode()
    print("Bilder geschrieben:", ", ".join(sorted(os.listdir(OUT))))
