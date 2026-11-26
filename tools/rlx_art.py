"""RLX icon art (Pedro's approved beach-sunset icon, 2026-11-26; PLAN §6f): a beach sunset on a logical pixel grid.

The palette mirrors shared/tokens.js. Used by tools/make-icons.py for the web icons; the same art made the
Android launcher icons in android-app/android/app/src/main/res and docs/play/ic-play-512.png. No lettering.
"""
from PIL import Image

SKY_TOP, SKY_BOTTOM = "#FFF7EC", "#FFCDC0"
CORAL, BLUE, INK = "#F05A68", "#436495", "#30486B"
SAIL, KEEL, GLINT, SUN, CLOUD = "#A0D0E8", "#241E38", "#FFA2CE", "#FFF4D6", "#FFFFFF"
SHADE_TARGET = "#783C5A"
BRICK_ROWS = ["#F05A68", "#F77476", "#FF8C7A", "#FFA38C", "#FF96B2",
              "#F57DA8", "#FFA2CE", "#78B4D8", "#A0D0E8"]
SEA = ["#96D0E6", "#84C4DE", "#74B8D6"]


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    pa, pb = rgb(a), rgb(b)
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(pa, pb))


def shade(c): return mix(c, SHADE_TARGET, 0.38)
def highlight(c): return mix(c, "#FFFFFF", 0.48)
def edge(c): return mix(c, SHADE_TARGET, 0.70)


# Sunset sky: sky tokens then the warm brick rows down to coral at the horizon.
SKY = [SKY_TOP, SKY_BOTTOM, BRICK_ROWS[3], BRICK_ROWS[2], BRICK_ROWS[1], BRICK_ROWS[0]]
SAND = mix(SKY_TOP, BRICK_ROWS[3], 0.55)          # the Putt sand-trap mix
SAND_DOT = mix(SAND, SHADE_TARGET, 0.22)
SUN_GLINT = mix(SUN, SEA[0], 0.15)                 # the app's glint dash colour
FOAM = CLOUD


class Grid:
    """RGBA logical-pixel canvas; colours as hex, None = transparent."""

    def __init__(self, w, h, fill=None):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w, h), (0, 0, 0, 0) if fill is None else rgb(fill) + (255,))
        self.px = self.img.load()

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = (0, 0, 0, 0) if c is None else rgb(c) + (255,)

    def get(self, x, y):
        return self.px[x, y]

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, c)

    def stepped(self, x, y, w, h, c, steps=1):
        n = min(steps, h // 2, w // 2)
        for i in range(n):
            ins = n - i
            self.rect(x + ins, y + i, w - 2 * ins, 1, c)
            self.rect(x + ins, y + h - 1 - i, w - 2 * ins, 1, c)
        self.rect(x, y + n, w, h - 2 * n, c)

    def body(self, x, y, w, h, c, steps=1, rim=None):
        """PLAN §3 rounded 8-bit body: highlight line, shade line, optional 1 px edge all round."""
        if rim:
            self.stepped(x, y, w, h, rim, steps)
            self.body(x + 1, y + 1, w - 2, h - 2, c, max(1, steps - 1))
            return
        self.stepped(x, y, w, h, c, steps)
        s = min(steps, h // 2)
        self.rect(x + s, y + h - 1, w - 2 * s, 1, shade(c))
        if s > 1:
            self.put(x + s - 1, y + h - 2, shade(c)); self.put(x + w - s, y + h - 2, shade(c))
        hi = s + 1
        if w - 2 * hi > 0 and h > 2:
            self.rect(x + hi, y + 1, w - 2 * hi, 1, highlight(c))

    def scaled(self, k):
        return self.img.resize((self.w * k, self.h * k), Image.NEAREST)


def split(total, n):
    edges = [round(i * total / n) for i in range(n + 1)]
    return [edges[i + 1] - edges[i] for i in range(n)]


def geometry(V):
    """Scene layout in viewport units for a viewport of V logical px."""
    return dict(
        horizon=round(0.585 * V),
        sun_r=round(0.31 * V),
        sun_x=round(0.585 * V),
        sand=round(0.80 * V),
    )


def draw_background(g, V, o=0, reflection=True):
    """Sky, sea, foam and sand, full-bleed over the grid; the viewport starts at (o, o)."""
    G = geometry(V)
    hz, sd = G["horizon"] + o, G["sand"] + o
    # sky: 6 bands over the viewport's sky; band 0 runs up to the grid's top
    hs = split(G["horizon"], len(SKY))
    y = o
    for i, (hh, c) in enumerate(zip(hs, SKY)):
        top = 0 if i == 0 else y
        g.rect(0, top, g.w, y + hh - top, c)
        if i:
            for x in range(i % 2, g.w, 2):
                g.put(x, y, SKY[i - 1])
        y += hh
    # sea: 3 bands with dither seams
    ss = split(sd - hz, 3)
    y = hz
    for i, (hh, c) in enumerate(zip(ss, SEA)):
        g.rect(0, y, g.w, hh, c)
        if i:
            for x in range(i % 2, g.w, 2):
                g.put(x, y, SEA[i - 1])
        y += hh
    # the sun's reflection: pale dashes under the sun, narrowing with depth
    if reflection:
        cx = G["sun_x"] + o
        depth = sd - hz
        rows = [(1, 0.85), (round(depth * 0.33), 0.55), (round(depth * 0.6), 0.32), (round(depth * 0.85), 0.14)]
        for ry, f in rows:
            half = max(1, round(G["sun_r"] * f))
            g.rect(cx - half, hz + ry, half * 2, 1, SUN_GLINT)
    # foam line and sand to the grid's bottom
    period = max(6, round(V / 6))
    for x in range(g.w):
        g.put(x, sd, FOAM)
        if (x - o) % period in (0, 1):            # scalloped wash: foam reaches one row up
            g.put(x, sd - 1, FOAM)
    g.rect(0, sd + 1, g.w, g.h - sd - 1, SAND)
    # a few specks of sand
    sp = max(5, round(V / 7))
    for j, yy in enumerate(range(sd + 3, g.h - 1, 3)):
        for x in range((j * 3 + 2) % sp, g.w, sp):
            g.put(x, yy, SAND_DOT)


def sun_pixels(V, o=0):
    G = geometry(V)
    r, cx, hz = G["sun_r"], G["sun_x"] + o, G["horizon"] + o
    pts = []
    for dy in range(1, r + 1):
        half = round(((r * r) - (dy - 0.5) ** 2) ** 0.5)
        for x in range(cx - half, cx + half):
            pts.append((x, hz - dy))
    return pts


def boat_spec(V):
    if V < 56:
        return dict(w=11, above=2, below=2, mast=9, sail=7, sailk=2 / 3, jib=4)
    return dict(w=16, above=3, below=2, mast=12, sail=10, sailk=0.7, jib=6)


def boat_pixels(V, o=0, bx=None, hz=None, spec=None):
    """The Catch sailboat, small: [(x, y, colour)]. Hull rows at and below the horizon are keel."""
    G = geometry(V)
    s = spec or boat_spec(V)
    hz = G["horizon"] + o if hz is None else hz
    if bx is None:
        bx = round(0.085 * V) + o
    deck = hz - s["above"]
    h = s["above"] + s["below"]
    px = {}
    # hull: stepped 1, edge all round, coral fill
    for yy in range(h):
        ins = 1 if yy in (0, h - 1) else 0
        for xx in range(ins, s["w"] - ins):
            border = yy in (0, h - 1) or xx in (0, s["w"] - 1)
            px[(bx + xx, deck + yy)] = edge(CORAL) if border else CORAL
    for (x, y) in list(px):
        if y >= hz:
            px[(x, y)] = KEEL
    mx = bx + round(s["w"] * 0.45)
    top = deck - s["mast"]
    for r in range(s["sail"]):
        w = int(r * s["sailk"]) + 1
        y = top + 1 + r
        for xx in range(mx + 1, mx + w):
            px[(xx, y)] = SAIL
        px[(mx + w, y)] = edge(SAIL)
    for xx in range(mx + 1, mx + int((s["sail"] - 1) * s["sailk"]) + 2):
        px[(xx, top + s["sail"])] = edge(SAIL)
    for r in range(s["jib"]):
        w = r // 2 + 1
        y = top + 3 + r
        for xx in range(mx - w, mx):
            px[(xx, y)] = BRICK_ROWS[5]
        px[(mx - w, y)] = edge(BRICK_ROWS[5])
    for y in range(top, deck):
        px[(mx, y)] = edge(CORAL)
    return [(x, y, c) for (x, y), c in px.items()]


def draw_foreground(g, V, o=0):
    for x, y in sun_pixels(V, o):
        g.put(x, y, SUN)
    for x, y, c in boat_pixels(V, o):
        g.put(x, y, c)


def draw_mono(g, V, o=0, colour="#FFFFFF"):
    boat = {(x, y) for x, y, _ in boat_pixels(V, o)}
    gap = {(x + dx, y + dy) for x, y in boat for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
    for p in sun_pixels(V, o):
        if p not in gap:
            g.put(*p, colour)
    for p in boat:
        g.put(*p, colour)


def full_icon(V):
    g = Grid(V, V)
    draw_background(g, V)
    draw_foreground(g, V)
    return g


# ---- masks on the grid (pixel steps, no antialiasing) ----

def mask_circle(n):
    c, r = n / 2, n / 2
    return lambda x, y: (x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= r * r


def mask_rounded(n, rr):
    def f(x, y):
        cx = min(max(x + 0.5, rr), n - rr)
        cy = min(max(y + 0.5, rr), n - rr)
        return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr
    return f


def mask_squircle(n, p=4):
    c = n / 2
    return lambda x, y: abs((x + 0.5 - c) / c) ** p + abs((y + 0.5 - c) / c) ** p <= 1


def apply_mask(g, inside, rim=None):
    out = Grid(g.w, g.h)
    for y in range(g.h):
        for x in range(g.w):
            if inside(x, y):
                out.px[x, y] = g.px[x, y]
    if rim:
        for y in range(g.h):
            for x in range(g.w):
                if inside(x, y) and any(not (0 <= x + dx < g.w and 0 <= y + dy < g.h) or not inside(x + dx, y + dy)
                                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    out.put(x, y, rim)
    return out
