#!/usr/bin/env python3
"""Draw the RLX app icons in the same pixel style as the app (PLAN §5).

Not part of the shipped runtime. Needs Pillow (pip install pillow).
Reads the glyphs from shared/font.js and the colours below mirror
shared/tokens.js. Writes icons/icon-192.png, icons/icon-512.png and
icons/icon-maskable-512.png. Run from anywhere: python3 tools/make-icons.py
"""
import math
import pathlib
import re

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRID = 64  # icons are drawn on a 64 x 64 pixel grid, then scaled by an integer

SKY_TOP = "#FFF7EC"
SKY_BOTTOM = "#FFCDC0"
CORAL = "#F05A68"
SUN = "#FFF4D6"
CLOUD = "#FFFFFF"
SEA = ["#96D0E6", "#84C4DE", "#74B8D6"]
SHADE_TARGET = "#783C5A"


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    pa, pb = rgb(a), rgb(b)
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(pa, pb))


def shade(c):
    return mix(c, SHADE_TARGET, 0.38)


def load_glyphs():
    src = (ROOT / "shared" / "font.js").read_text()
    glyphs = {}
    for key, body in re.findall(r"'(.)':\s*\[([^\]]*)\]", src):
        glyphs[key] = re.findall(r"'([.#]+)'", body)
    return glyphs


GLYPHS = load_glyphs()


class Canvas:
    def __init__(self, n):
        self.n = n
        self.img = Image.new("RGB", (n, n), rgb(SKY_TOP))
        self.px = self.img.load()

    def rect(self, x, y, w, h, color):
        c = rgb(color)
        for yy in range(max(0, y), min(self.n, y + h)):
            for xx in range(max(0, x), min(self.n, x + w)):
                self.px[xx, yy] = c

    def dither_row(self, y, a, b, phase):
        self.rect(0, y, self.n, 1, a)
        for x in range(phase % 2, self.n, 2):
            self.rect(x, y, 1, 1, b)

    def bands(self, y, heights, colors):
        for i, (h, c) in enumerate(zip(heights, colors)):
            self.rect(0, y, self.n, h, c)
            if i:
                self.dither_row(y, c, colors[i - 1], i)
            y += h

    def text(self, s, x, y, size, color):
        for ch in s:
            rows = GLYPHS.get(ch, GLYPHS[" "])
            for r, row in enumerate(rows):
                for c, v in enumerate(row):
                    if v == "#":
                        self.rect(x + c * size, y + r * size, size, size, color)
            x += (len(rows[0]) + 1) * size

    def measure(self, s, size):
        return (sum(len(GLYPHS.get(ch, GLYPHS[" "])[0]) + 1 for ch in s) - 1) * size


def scene(cv, horizon, sun_x, sun_r, cloud):
    n = cv.n
    bands = 10
    heights, colors = [], []
    for i in range(bands):
        y0 = round(i * horizon / bands)
        y1 = round((i + 1) * horizon / bands)
        heights.append(y1 - y0)
        colors.append(mix(SKY_TOP, SKY_BOTTOM, i / (bands - 1)))
    cv.bands(0, heights, colors)
    if cloud:
        cx, cy = cloud
        for r, row in enumerate(["....####....", "..########..", "############"]):
            a, b = row.index("#"), row.rindex("#")
            cv.rect(cx + a, cy + r, b - a + 1, 1, CLOUD)
    for dy in range(1, sun_r + 1):
        half = round(math.sqrt(sun_r * sun_r - (dy - 0.5) ** 2))
        cv.rect(sun_x - half, horizon - dy, half * 2, 1, SUN)
    sea = n - horizon
    h1 = sea // 3
    h2 = sea // 3
    cv.bands(horizon, [h1, h2, sea - h1 - h2], SEA)
    glint = mix(SUN, SEA[0], 0.15)
    for gx, gy, ln in [(sun_x - 9, 2, 14), (sun_x - 5, 5, 9), (8, 4, 5), (sun_x - 3, 9, 6), (14, 11, 4), (50, 14, 5)]:
        if horizon + gy < n - 1:
            cv.rect(gx, horizon + gy, ln, 1, glint)


def wordmark(cv, size, y):
    w = cv.measure("RLX", size)
    x = (cv.n - w) // 2
    cv.text("RLX", x, y + 1, size, shade(CORAL))
    cv.text("RLX", x, y, size, CORAL)


def build_any():
    cv = Canvas(GRID)
    scene(cv, horizon=46, sun_x=44, sun_r=12, cloud=(6, 36))
    wordmark(cv, 3, 11)
    return cv.img


def build_maskable():
    # Content kept inside the central safe circle (radius 40 percent).
    cv = Canvas(GRID)
    scene(cv, horizon=42, sun_x=40, sun_r=8, cloud=(10, 36))
    wordmark(cv, 2, 18)
    return cv.img


def main():
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    base = build_any()
    # 192 = 64 x 3; 512 = 64 x 8. Integer, nearest-neighbour only.
    base.resize((192, 192), Image.NEAREST).save(out / "icon-192.png", optimize=True)
    base.resize((512, 512), Image.NEAREST).save(out / "icon-512.png", optimize=True)
    build_maskable().resize((512, 512), Image.NEAREST).save(out / "icon-maskable-512.png", optimize=True)
    print("wrote", ", ".join(p.name for p in sorted(out.glob("*.png"))))


if __name__ == "__main__":
    main()
