import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import rlx_art as A
from PIL import Image

from rlx_font import GLYPHS as GL
LOW = {
 'r': ['#.##', '##..', '#...', '#...', '#...'],
 'l': ['##', '.#', '.#', '.#', '.#', '.#', '.#'],
 'x': ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
}
def pad(rows, top=2, bottom=2):
    w = len(rows[0]); e = '.' * w
    return [e] * top + rows + [e] * bottom
SMALL = {  # lowercase, x-height 5, ascender/descender room: 9 rows, top aligned
 'c': pad(['.###', '#...', '#...', '#...', '.###']),
 'o': pad(['.##.', '#..#', '#..#', '#..#', '.##.']),
 'm': pad(['####.', '#.#.#', '#.#.#', '#.#.#', '#.#.#']),
 'i': pad(['#', '.', '#', '#', '#', '#', '#'], 0, 2),
 'n': pad(['####.', '#...#', '#...#', '#...#', '#...#']),
 'g': pad(['.####', '#...#', '#...#', '#...#', '.####', '....#', '.###.'], 2, 0),
 's': pad(['.###', '#...', '.##.', '...#', '###.']),
 ' ': pad(['..', '..', '..', '..', '..']),
}
W, H, S = 135, 180, 8
HZ, SD, R = 120, 146, 11
A.geometry = lambda V: dict(horizon=HZ, sun_r=R, sun_x=88, sand=SD)
g = A.Grid(W, H)
A.draw_background(g, 135, reflection=False)
A.draw_foreground(g, 135)
INK = A.INK

def rows_of(ch, table):
    return table.get(ch) or GL.get(ch.upper()) or GL[' ']
def text_w(t, k, table):
    return sum(len(rows_of(c, table)[0]) * k + k for c in t) - k
def draw_text(t, y, k, colour, table=GL, bottom_align=False):
    x = (W - text_w(t, k, table)) // 2
    for c in t:
        rows = rows_of(c, table)
        off = (7 - len(rows)) * k if bottom_align else 0
        for ry, row in enumerate(rows):
            for rx, v in enumerate(row):
                if v == '#':
                    g.rect(x + rx * k, y + off + ry * k, k, k, colour)
        x += len(rows[0]) * k + k

def brick(x, y, c, w=10, h=4):
    g.rect(x, y, w, h, c)
    g.rect(x, y, w, 1, A.highlight(c))
    g.rect(x, y + h - 1, w, 1, A.shade(c))
    g.rect(x + w - 1, y, 1, h, A.shade(c))
def dot(x, y, c, hi=True):
    g.rect(x, y + 1, 4, 2, c); g.rect(x + 1, y, 2, 4, c)
    if hi: g.put(x + 1, y + 1, "#FFFFFF")

# --- bricks as clouds: stepped rows of bricks, each cloud a different colour row
def cloud(x, y, rows, c, gap=None):
    for r, n in enumerate(rows):
        for i in range(n):
            bx = x + i * 10 + (5 if r % 2 else 0) + (rows[0] - n) * 5 * 0
            if gap and (r, i) in gap: continue
            brick(bx, y + r * 4, c)
cloud(8, 18, [3, 2], A.BRICK_ROWS[0])                      # top left
cloud(80, 30, [3, 3], A.BRICK_ROWS[2], gap={(1, 2)})       # right, one brick knocked out
cloud(2, 58, [2, 1], A.BRICK_ROWS[4])                      # left, small

# ball (blue) with trail rising to the missing brick at (100..109, 50..53)
for i, (tx, ty) in enumerate([(112, 66), (109, 61), (106, 56)][::-1]):
    pass
trail = [(116, 54, 0.78), (112, 49, 0.58), (108, 44, 0.38)]
for tx, ty, t in trail:
    dot(tx, ty, A.mix(A.BLUE, A.SAIL, t), hi=False)
dot(103, 39, A.BLUE)
# brick fragments flying
for fx, fy in [(97, 31), (111, 28), (116, 33)]:
    g.rect(fx, fy, 3, 2, A.BRICK_ROWS[2]); g.rect(fx, fy + 1, 3, 1, A.shade(A.BRICK_ROWS[2]))

# wordmark + tagline (pixel font, all INK)
draw_text("rlx", 50, 5, INK, table=LOW, bottom_align=True)
draw_text("GAMES FOR NO", 90, 1, INK)
draw_text("BRAIN POWER", 99, 1, INK)

# Catch: a piece falling toward the boat, trail above it
for i, ty in enumerate([86, 91, 96]):
    g.rect(28, ty, 2, 2, A.mix(A.SUN, A.SKY[5], 0.7 - i * 0.22))
dot(27, 101, A.SUN)

# whispered, lower case, in the water
draw_text("coming soon", 127, 1, INK, table=SMALL)

# Putt: the ball is rolling toward the hole, trail behind it
HX, HY = 106, 166
for y in range(HY - 14, HY): g.put(HX, y, A.edge(A.CORAL))
for r in range(5): g.rect(HX + 1, HY - 14 + r, 5 - r, 1, A.CORAL)
g.rect(HX - 4, HY, 9, 2, A.KEEL); g.rect(HX - 3, HY - 1, 7, 1, A.KEEL)
pts = [(14, 168), (24, 167), (34, 166), (44, 165), (54, 163)]
for i, (x, y) in enumerate(pts):
    g.rect(x, y, 2, 2, A.mix(A.CORAL, A.SAND, 0.8 - i * 0.14))
dot(63, 159, "#FFFFFF")
g.rect(64, 163, 3, 1, A.edge(A.CORAL))

Image.merge("RGB", g.img.convert("RGB").split()).resize((W * S, H * S), Image.NEAREST).save(str(__import__("pathlib").Path(__file__).resolve().parent.parent / "docs/social/rlx-post-1080x1440.png"))
