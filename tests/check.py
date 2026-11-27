#!/usr/bin/env python3
"""RLX checks (v2: the hub, Bricks and Pool) in headless Chromium and Node. Not needed to run the app.

Needs Python Playwright with Chromium (pip install playwright;
python -m playwright install chromium). Run: python3 tests/check.py
Serves the repo under /4rk4d3/ (the GitHub Pages project subpath), then checks
both phone widths: pixels crisp, no scroll, the hub's two cards (Bricks left, Pool right, one row) and nothing
else, no text drawn, each game opened over the hub by its card and closed by the back gesture (history back),
old rlx.* keys cleared at start, the manifest fullscreen, the service worker offline, cache version bump, no
console errors, no requests to another host. Throughout: no text, number or button on any game screen, storage
empty after play, touches within 24 CSS px of a side edge ignored, a fresh game on every opening, haptics always
on, the in-memory session clock (Bricks and the hub; Pool does not use it), a game opened by its card allowed to
vibrate at once. Bricks: tests/bricks-sim.mjs and Bricks in the browser (pause, resume, relative drag, haptics,
reduced motion, the clock, the scene phase, dusk). Contrast: the hub's card frames and the pieces in each card at
sunset and all 10 steps, and the drawn colours of the hub and Bricks (see tests/contrast.mjs). Pool:
tests/pool-sim.mjs and Pool with real touch events (a pull shoots, a touch while a ball moves is ignored, a game
played with shots planned by the page's own sim.js ends in a new rack, nothing stored, no text, light and dark,
contrast of balls, cue ball and pocket ring on the sand). Android app: static checks. Screenshots go to tests/out/.
"""
import functools
import http.server
import json
import math
import pathlib
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "out"
DPR = 2.625
# Full suite on the two target widths; layout checks on short, small and landscape windows.
FULL = [(360, 800, DPR), (412, 915, DPR)]
LAYOUT_ONLY = [(360, 640, DPR), (360, 560, 3), (800, 360, DPR)]
MAX_AGE = None  # set by --max-age N: serve with Cache-Control: max-age=N (GitHub Pages uses 600)
SW_VERSION = __import__("re").search(r"const VERSION = '(rlx-v\d+)';", (ROOT / "sw.js").read_text()).group(1)
SHIPPED_EXCLUDE = {"docs", "tools", "tests", ".git", "README.md", ".gitignore", ".nojekyll",
                   "android-app", ".github", "privacy-policy.html"}  # row P3: the app, its CI and the Pages-only policy page
FAILS = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", f"max-age={MAX_AGE}" if MAX_AGE is not None else "no-cache")
        super().end_headers()


def serve(site_root):
    """Serve site_root at http://127.0.0.1:PORT/4rk4d3/."""
    base = pathlib.Path(tempfile.mkdtemp(prefix="rlx-serve-"))
    (base / "4rk4d3").symlink_to(site_root)
    handler = functools.partial(Quiet, directory=str(base))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/4rk4d3/"


VIBRATE_STUB = """
window.__vib = [];
window.__vibAt = [];
Object.defineProperty(Navigator.prototype, 'vibrate', {
  configurable: true,
  value: function (p) { window.__vib.push(p); window.__vibAt.push(performance.now()); return true; },
});
window.__text = 0;
for (const k of ['fillText', 'strokeText']) {
  const real = CanvasRenderingContext2D.prototype[k];
  CanvasRenderingContext2D.prototype[k] = function (...a) { window.__text++; return real.apply(this, a); };
}
window.__raf = 0;
const __rafReal = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => { window.__raf++; return __rafReal(cb); };
"""


def new_context(browser, w, h, dpr=DPR, scheme="light", motion=False):
    # Row D1: the phone's colour scheme (prefers-color-scheme); every existing check runs in light, as before.
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=dpr,
        is_mobile=True,
        has_touch=True,
        service_workers="allow",
        color_scheme=scheme,
        # The hub moves (hub/life.js); every existing check reads the still picture. run_hub_life turns motion on.
        reduced_motion="no-preference" if motion else "reduce",
    )
    ctx.add_init_script(VIBRATE_STUB)
    return ctx


def hits(page):
    page.wait_for_function("document.getElementById('screen').dataset.hits")
    return json.loads(page.eval_on_selector("#screen", "c => c.dataset.hits"))


def layout_of(page):
    hits(page)
    return json.loads(page.eval_on_selector("#screen", "c => c.dataset.layout"))


# Row H2 layout values (PLAN §5a), restated here so a change in hub/cards.js fails a check. v2: 2 columns by 1 row,
# and where a row of full-size cards does not fit, the sky gives way first (down to H2_SKY_FLOOR), then the cards shrink.
H2_GAP, H2_SEA_CLEAR, H2_RATIO, H2_SKY_MIN, H2_ROWS, H2_SKY_FLOOR = 5, 8, 1.3, 40, 1, 0


# Card sizes (w, h) by CSS width and device scale, at logical heights 300 and 400 (row H2; row A1: at 240 three rows
# do not fit and the cards are shorter, run_hub_grid).
H2_CARD_SIZE = {(360, 2.625): (56, 72), (360, 3): (56, 72), (412, 2.625): (57, 74), (412, 3): (58, 75)}


def h2_bottom_margin(H):
    return max(8, round(H * 0.05))


def h2_card_size(W, H, safe, edge):
    """The card size by the layout rule (PLAN §5a, §6i), restated: as wide as the margins allow, 1.3 x that tall,
    smaller only where three rows do not fit once the sky has given way."""
    side = max(4, edge, safe["left"] + 2, safe["right"] + 2)
    cw = (W - side * 2 - H2_GAP) // 2
    bottom = H - safe["bottom"] - h2_bottom_margin(H)
    fit = (bottom - (safe["top"] + H2_SKY_FLOOR + H2_SEA_CLEAR) - H2_GAP * (H2_ROWS - 1)) // H2_ROWS
    return cw, max(40, min(fit, int(cw * H2_RATIO)))


def mix_hex(a, b, t):
    """shared/tokens.js mix(): a flat mix of two #RRGGBB colours."""
    pa, pb = [[int(c[i:i + 2], 16) for i in (1, 3, 5)] for c in (a, b)]
    return "#" + "".join("%02X" % math.floor(x + (y - x) * t + 0.5) for x, y in zip(pa, pb))


def h2_sun_radius(sky):
    """hub/cards.js sunRadiusFor, restated: 0.3 of the sky from 24 to 40, at least 8 below the top inset; none under 6."""
    r = min(max(24, min(40, round(sky * 0.3))), sky - 8)
    return r if r >= 6 else 0


def hub_layout_checks(page, tag, h):
    """Row H2, v2: two equal cards side by side in one row (Bricks left, Pool right), each at least 40 logical px each
    way, 5 px gap, centred, inside the safe area and clear of the 24 CSS px side band, low in the thumb's reach (the
    row's bottom a fixed margin above the bottom inset), 1.3 x as tall as wide where that fits, the horizon 8 px above
    the row with the sky above it; the cards and nothing else; no text drawn."""
    lay = layout_of(page)
    g = json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))
    H, W, r = lay["H"], lay["W"], lay["rects"]
    safe = g["safe"]
    check(sorted(r) == sorted(GAMES) and sorted(hits(page)) == sorted(GAMES) and len(GAMES) == 2,
          f"[{tag}] the hub has one card per built game, two, and nothing else {sorted(hits(page))}")
    b, c = (r[k] for k in GAMES)
    sizes = {(q["w"], q["h"]) for q in r.values()}
    check(len(sizes) == 1, f"[{tag}] the two cards are the same size {sizes}")
    w, hh = b["w"], b["h"]
    check(w >= 40 and hh >= 40, f"[{tag}] every card is a tap target of at least 40 logical px each way ({w}x{hh})")
    gx = c["x"] - (b["x"] + w)
    check(b["y"] == c["y"] and gx == H2_GAP and b["x"] < c["x"],
          f"[{tag}] one row, Bricks left and Pool right, a 5 px gap ({gx})")
    check("open" not in g, f"[{tag}] no open cell: two cards and nothing else")
    left, right, top, bottom = b["x"], c["x"] + w, b["y"], b["y"] + hh
    check(left >= safe["left"] and W - right >= safe["right"] and top >= safe["top"] and bottom <= H - safe["bottom"],
          f"[{tag}] the row ({left}..{right} x {top}..{bottom}) is inside the safe area {safe}")
    side = max(4, g["edge"], safe["left"] + 2, safe["right"] + 2)
    check(left >= g["edge"] and W - right >= g["edge"] and abs(left - (W - right)) <= 1 and w == (W - 2 * side - H2_GAP) // 2,
          f"[{tag}] the row is centred, clear of the side band where touches are ignored, the cards as wide as the margins allow "
          f"({left}, {W - right}, band {g['edge']}, width {w})")
    want_bottom = H - safe["bottom"] - h2_bottom_margin(H)
    check(bottom == want_bottom, f"[{tag}] the row sits low, in the thumb's reach: it ends {bottom}, want {want_bottom} "
          f"(H {H} - bottom inset {safe['bottom']} - {h2_bottom_margin(H)})")
    want = h2_card_size(W, H, safe, g["edge"])
    horizon = g["horizon"]
    sky = horizon - safe["top"]
    check((w, hh) == want, f"[{tag}] the cards are {H2_RATIO} x as tall as wide where that fits ({w}x{hh}, want {want})")
    check(horizon == top - H2_SEA_CLEAR and g["seaHeight"] == H - horizon and sky >= H2_SKY_FLOOR,
          f"[{tag}] the horizon {horizon} is {H2_SEA_CLEAR} px above the row (top {top}): the cards sit on the sea, the sky above is {sky} px")
    check(page.eval_on_selector("#screen", "c => c.dataset.labels || null") is None and page.evaluate("window.__text") == 0,
          f"[{tag}] the hub draws no text (no labels, no fillText or strokeText)")
    return lay


def hub_scene_checks(page, shot, tag):
    """Row H2 at sunset: the whole sun on the raised horizon in the open sky above the cards, sized to the sky,
    clear of every card; the sea from the horizon down behind the cards. Row A1: a sky too short for a sun has none,
    and only the clouds and stars that fit whole in the sky are drawn."""
    g = json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))
    tok = page.evaluate(HUB_TOKENS_JS)
    C, pal = tok["C"], tok["pals"][0]
    hz, safe = g["horizon"], g["safe"]
    sky = hz - safe["top"]
    rad = h2_sun_radius(sky)
    sx = g["sunX"]
    H = g["horizon"] + g["seaHeight"]
    if rad:
        got = logical_pixels(page, shot, [(sx, hz - 1), (sx, hz - rad), (sx, hz - rad - 1), (1, hz), (1, hz - 1),
                                          (4, g["y0"] + g["ch"]), (2, g["bottom"] + 1), (sx - rad, hz - 1), (sx + rad - 1, hz - 1),
                                          (sx + rad, hz - 1)])
        check(got[0] == C["sun"] and got[1] == C["sun"] and got[2] != C["sun"] and got[3] == pal["sea"][0] and got[4] in pal["sky"]
              and got[5] in pal["sea"] and got[6] in pal["sea"] and got[7] == C["sun"] and got[8] == C["sun"] and got[9] != C["sun"]
              and g["sunRadius"] == rad and hz - rad >= safe["top"] + 8 and hz < g["y0"],
              f"[{tag}] sunset: the whole sun (radius {rad}, x {sx}) on the horizon {hz} in the open sky, clear of the cards (top {g['y0']}); "
              f"the sea from the horizon down behind and below the cards ({got})")
        check(sx <= 96 and sx + rad <= 135 - 4 and sx - rad >= 4,
              f"[{tag}] the whole sun shows with a margin: x {sx} radius {rad} spans {sx - rad}..{sx + rad - 1} of 0..134 (at least 4 px clear of each edge)")
    else:
        row = logical_pixels(page, shot, [(x, y) for y in range(max(0, hz - 1), hz + 1) for x in range(135)])
        check(g["sunRadius"] == 0 and C["sun"] not in row,
              f"[{tag}] the sky ({sky} px) has no room for a whole sun: none is drawn (radius {g['sunRadius']})")
    # The clouds: each whole in the sky and clear of the sun; where the sky has room for them (as in row H2), 3, or 4 over 300.
    boxes = [(20, 6), (16, 5), (14, 5)]
    def clear_of_sun(cx, cy, bw, bh):
        nx, ny = max(cx, min(sx, cx + bw)), max(cy, min(hz, cy + bh))
        return not rad or math.hypot(nx - sx, ny - hz) > rad + 1
    fit = all(cy >= safe["top"] + 1 and cy + boxes[i % 3][1] <= hz - 2 and clear_of_sun(cx, cy, *boxes[i % 3])
              for i, (cx, cy) in enumerate(g["clouds"]))
    full = 4 if H > 300 else 3
    check(fit and (len(g["clouds"]) == full or sky < H2_SKY_MIN),
          f"[{tag}] {len(g['clouds'])} clouds, each whole in the sky ({sky} px) and clear of the sun (a fourth over 300 where the sky has room)")
    # The hub's extra sea glints: on the sea, round the cards, each at least 2 px clear of every card.
    gl = g["glints"]
    clear = all(gy >= hz and gy < H and gx >= 0 and gx + ln <= 135 and all(
        gx + ln <= c["x"] - 2 or gx >= c["x"] + c["w"] + 2 or gy <= c["y"] - 2 or gy >= c["y"] + c["h"] + 1
        for c in g["cards"].values()) for gx, gy, ln in gl)
    glint_c = mix_hex(C["sun"], pal["sea"][0], 0.15)
    drawn = logical_pixels(page, shot, [(gx, gy) for gx, gy, _ in gl])
    check(len(gl) >= 2 and clear and all(d == glint_c for d in drawn),
          f"[{tag}] {len(gl)} glints on the sea round the cards, each 2 px clear of every card, drawn in the glint colour ({gl}, {drawn})")


def logical_to_css(page, x, y):
    """CSS px of a logical point on the hub."""
    v = view_of(page)
    k = page.evaluate("document.getElementById('screen').getBoundingClientRect().width / document.getElementById('screen').width")
    return (v["ox"] + x * v["scale"]) * k, (v["oy"] + y * v["scale"]) * k


def tap(page, name):
    p = hits(page)[name]
    page.touchscreen.tap(p["x"], p["y"])


def crisp(page, shot_path, scale=None):
    """Every logical pixel must be a uniform scale x scale block in the screenshot (scale: given, or the page's view)."""
    from PIL import Image

    info = page.evaluate("""() => {
      const c = document.getElementById('screen');
      return { cw: c.width, ch: c.height, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio,
               sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
    }""")
    img = Image.open(shot_path).convert("RGB")
    s = scale or view_of(page)["scale"]
    ox = (info["cw"] - 135 * s) // 2
    H = info["ch"] // s
    oy = (info["ch"] - H * s) // 2
    px = img.load()
    bad = 0
    total = 0
    colours = set()
    for ly in range(0, H):
        for lx in range(0, 135):
            x0, y0 = ox + lx * s, oy + ly * s
            if x0 + s > img.width or y0 + s > img.height:
                continue
            c = px[x0, y0]
            colours.add(c)
            total += 1
            if px[x0 + s - 1, y0] != c or px[x0, y0 + s - 1] != c or px[x0 + s - 1, y0 + s - 1] != c:
                bad += 1
    return info, s, H, bad, total, len(colours), img.size


def run_viewport(browser, base, w, h):
    tag = f"{w}x{h}"
    ctx = new_context(browser, w, h)
    page = ctx.new_page()
    errors, foreign = [], []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    origin = base.split("/4rk4d3/")[0]
    ctx.on("request", lambda r: (not r.url.startswith(origin) and not r.url.startswith("data:")) and foreign.append(r.url))

    page.goto(base)
    hits(page)
    # Row X1: an earlier build's keys are cleared at start; another app's key on the same origin is kept.
    page.evaluate(STALE_KEYS_JS)
    page.reload()
    hits(page)
    st = page.evaluate(STORAGE_JS)
    check(st["local"] == {"other-app": "kept"} and st["session"] == {},
          f"[{tag}] at start every stored rlx.* key is cleared (localStorage and sessionStorage), other keys kept {st}")
    page.evaluate("localStorage.removeItem('other-app')")
    page.wait_for_timeout(300)
    shot = OUT / f"hub-{tag}.png"
    page.screenshot(path=str(shot))
    info, s, H, bad, total, ncol, size = crisp(page, shot)
    print(f"  [{tag}] canvas {info['cw']}x{info['ch']} device px, screenshot {size}, scale {s}, logical 135x{H}, colours {ncol}")
    check(info["cw"] == size[0] and abs(info["ch"] - size[1]) <= 1, f"[{tag}] canvas backing store matches device pixels 1:1")
    check(bad == 0, f"[{tag}] crisp: {total - bad}/{total} logical pixels are uniform {s}x{s} blocks")
    check(info["sw"] <= info["iw"] and info["sh"] <= info["ih"], f"[{tag}] no scrolling or sideways overflow (scroll {info['sw']}x{info['sh']} vs {info['iw']}x{info['ih']})")
    check(H >= 240, f"[{tag}] logical height {H} >= 240")
    hub_layout_checks(page, tag, h)
    hub_dom = page.evaluate("() => ({ text: document.body.innerText.trim(), controls: document.querySelectorAll('button, a, input, select, [role=button]').length })")
    check(hub_dom == {"text": "", "controls": 0}, f"[{tag}] the hub has no switch, setting or other control in the DOM {hub_dom}")
    fonts = page.evaluate("performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /font/.test(n))")
    check(fonts == [], f"[{tag}] the hub loads no font {fonts}")

    # Navigation: each card opens its game over the hub; the back gesture (history back) returns.
    hlen = page.evaluate("history.length")
    for game in GAMES:
        g = open_tile(page, game)
        page.wait_for_timeout(150)
        page.screenshot(path=str(OUT / f"{game}-{tag}.png"))
        shown = page.evaluate("(() => { const f = document.querySelector('iframe.game'); const r = f.getBoundingClientRect(); "
                              "return { shown: f.classList.contains('shown'), w: r.width, h: r.height, n: document.querySelectorAll('iframe').length }; })()")
        src = page.evaluate("document.querySelector('iframe.game').getAttribute('src')")
        check(page.url == base and shown == {"shown": True, "w": w, "h": h, "n": 1} and src == f"games/{game}/index.html",
              f"[{tag}] tap the {game} card opens {game} ({src}) full screen over the hub (the page stays the hub) {shown}")
        no_hud(g, tag, game)
        back_to_hub(page)
        check(page.url == base and page.evaluate("document.querySelectorAll('iframe').length") == 0,
              f"[{tag}] back gesture (history back) returns from {game} to the hub, the game gone")
    check(page.evaluate("history.length") == hlen + 1, f"[{tag}] going in and out of games leaves one history entry above the hub")

    # Only cards open games: a tap on the open sky above the grid opens nothing.
    lay = layout_of(page)
    sky_x, sky_y = logical_to_css(page, 40, json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))["horizon"] / 2)
    page.touchscreen.tap(sky_x, sky_y)
    page.wait_for_timeout(300)
    check(page.url == base and page.evaluate("document.querySelectorAll('iframe').length") == 0,
          f"[{tag}] a tap on the hub's open sky ({sky_y:.0f} CSS px) opens nothing")
    # A touch that starts on a card and slides off it opens nothing (the frame made on touch is dropped).
    p0 = hits(page)["bricks"]
    cdp = ctx.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": p0["x"], "y": p0["y"]}]})
    page.wait_for_timeout(60)
    made = page.evaluate("document.querySelectorAll('iframe').length")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": p0["x"], "y": sky_y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(200)
    check(made == 1 and page.evaluate("document.querySelectorAll('iframe').length") == 0 and not page.evaluate("document.body.dataset.game || ''"),
          f"[{tag}] a touch that slides off its card opens nothing")
    # Reloading on a game's history entry (Chrome reopening the app) shows the hub.
    open_tile(page, "bricks")
    page.reload()
    hits(page)
    check(page.url == base and page.evaluate("document.querySelectorAll('iframe').length") == 0 and page.evaluate("history.state") is None,
          f"[{tag}] reloaded while a game was open: it opens at the hub")

    # Service worker and offline.
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    hits(page)
    controlled = page.evaluate("!!navigator.serviceWorker.controller")
    keys = page.evaluate("caches.keys()")
    check(controlled, f"[{tag}] service worker controls the page")
    check(keys == [SW_VERSION], f"[{tag}] one versioned cache {keys}")
    manifest = page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())")
    check(manifest["display"] == "fullscreen" and manifest["orientation"] == "portrait", f"[{tag}] manifest fullscreen, portrait")
    try:
        inst = cdp.send("Page.getInstallabilityErrors")
        errs = inst.get("installabilityErrors", [])
        check(errs == [], f"[{tag}] Chrome installability errors: {errs}")
    except Exception as e:  # noqa: BLE001
        print(f"  note: installability check unavailable: {e}")
    ctx.set_offline(True)
    page.reload()
    hits(page)
    page.screenshot(path=str(OUT / f"hub-offline-{tag}.png"))
    check(page.url == base, f"[{tag}] hub loads offline")
    for game in GAMES:
        g = open_tile(page, game)
        check(g.evaluate(GAME_READY[game]) is not None, f"[{tag}] {game} opens and draws offline")
        back_to_hub(page)
    # Slash-less folder URL, offline then online, with the worker in control (a game page opened on its own).
    for mode in ("offline", "online"):
        ctx.set_offline(mode == "offline")
        for game in GAMES:
            page.goto(base + "games/" + game)
            page.wait_for_url(f"**/games/{game}/")
            page.wait_for_function(GAME_READY[game], timeout=20000)
            check(page.url == base + f"games/{game}/", f"[{tag}] slash-less games/{game} redirects and draws ({mode})")
        page.goto(base)
        hits(page)
    ctx.set_offline(False)

    check(not errors, f"[{tag}] no console errors {errors}")
    check(not foreign, f"[{tag}] no requests to another host {foreign}")
    ctx.close()


def run_layout_only(browser, base, w, h, dpr):
    tag = f"{w}x{h}@{dpr}"
    ctx = new_context(browser, w, h, dpr)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base)
    hits(page)
    page.wait_for_timeout(200)
    shot = OUT / f"hub-{w}x{h}.png"
    page.screenshot(path=str(shot))
    info, s, H, bad, total, ncol, size = crisp(page, shot)
    print(f"  [{tag}] canvas {info['cw']}x{info['ch']}, scale {s}, logical 135x{H}")
    check(H >= 240, f"[{tag}] logical height {H} >= 240 (scale stepped down if needed)")
    check(bad == 0, f"[{tag}] crisp: {total - bad}/{total} uniform blocks")
    check(info["sw"] <= info["iw"] and info["sh"] <= info["ih"], f"[{tag}] no scrolling or overflow")
    hub_layout_checks(page, tag, h)
    page.goto(base + "games/bricks/")
    page.wait_for_function(GAME_READY["bricks"])
    page.wait_for_timeout(150)
    shot = OUT / f"bricks-{w}x{h}.png"
    page.screenshot(path=str(shot))
    info, s, H, bad, total, ncol, size = crisp(page, shot)
    geo = page.evaluate("window.__bricks.snapshot().game")["geo"]
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"] and geo["top"] == 5 and geo["horizon"] == H - 42,
          f"[{tag}] Bricks: crisp, no overflow, the field from 5 px below the top (no HUD) to the horizon (H {H})")
    page.goto(base + "games/pool/")
    page.wait_for_function(GAME_READY["pool"])
    page.wait_for_timeout(150)
    shot = OUT / f"pool-{w}x{h}.png"
    page.screenshot(path=str(shot))
    ps = page.evaluate("window.__pool.snapshot()")
    info, s, H, bad, total, ncol, size = crisp(page, shot, ps["geo"]["scale"])
    t = ps["table"]
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"] and ps["geo"]["H"] == H
          and t["outer"]["y0"] == ps["geo"]["safe"]["top"] and t["outer"]["y1"] == H - ps["geo"]["safe"]["bottom"],
          f"[{tag}] Pool: crisp, no overflow, the table the whole screen less the safe-area insets (H {H})")
    check(not errors, f"[{tag}] no console errors {errors}")
    ctx.close()


SAFE_INSETS_JS = """(pad) => new MutationObserver((m, o) => {
  if (!document.head) return;
  const s = document.createElement('style');
  s.textContent = `.safe-probe { padding: ${pad} !important; }`;
  document.head.appendChild(s);
  o.disconnect();
}).observe(document, { childList: true, subtree: true })"""


def css_height_for(w, dpr, H):
    """The CSS height that gives a logical height of H at width w and device scale dpr."""
    scale = round(w * dpr) // 135
    h = int(H * scale / dpr)
    while (round(h * dpr) // scale) < H:
        h += 1
    return h


def run_hub_grid(browser, base):
    """Row H2: the card grid at logical heights 240, 300 and 400, widths 360 and 412 CSS px, device scale 2.625 and 3,
    with no insets and with safe-area insets (a display cutout and a gesture bar; side insets as in landscape split
    screen): the layout rules, crisp pixels, each card opening its own game, a touch in the side band opening nothing."""
    for w in (360, 412):
        for dpr in (2.625, 3):
            for H in (240, 300, 400):
                for inset in ("", "32px 10px 16px 10px"):
                    h = css_height_for(w, dpr, H)
                    tag = f"grid {w}x{h}@{dpr} H{H}" + (f" insets {inset}" if inset else "")
                    ctx = new_context(browser, w, h, dpr)
                    if inset:
                        ctx.add_init_script(f"({SAFE_INSETS_JS})({json.dumps(inset)})")
                    page = ctx.new_page()
                    errors = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    page.goto(base)
                    lay = hub_layout_checks(page, tag, h)
                    g = json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))
                    want = {"top": 0, "right": 0, "bottom": 0, "left": 0}
                    if inset:
                        conv = lambda v: -(-v * dpr // lay["scale"])  # noqa: E731  (ceil, as pixel.js)
                        want = {"top": conv(32), "right": conv(10), "bottom": conv(16), "left": conv(10)}
                    check(lay["H"] == H and all(abs(g["safe"][k] - want[k]) <= 1 for k in want), f"[{tag}] logical height {lay['H']}, insets read {g['safe']} (want {want})")
                    shot = OUT / f"hub-grid-{w}x{h}-{dpr}{'-insets' if inset else ''}.png"
                    page.screenshot(path=str(shot))
                    info, sc, HH, bad, total, _, _ = crisp(page, shot)
                    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"],
                          f"[{tag}] crisp ({total - bad}/{total}), no scrolling; cards {lay['rects']['bricks']['w']}x{lay['rects']['bricks']['h']}")
                    # The card size, stated per view: full size (1.3 x the width) at every logical height from 240 (one row fits).
                    size = (lay["rects"]["bricks"]["w"], lay["rects"]["bricks"]["h"])
                    full = H2_CARD_SIZE[(w, dpr)]
                    want = full
                    check(size == want, f"[{tag}] H{H}: cards {size[0]}x{size[1]}, want {want}")
                    hub_scene_checks(page, shot, tag)
                    # Each card opens its own game; the back gesture returns.
                    for game in GAMES:
                        tap(page, game)
                        page.wait_for_function("document.body.dataset.game", timeout=10000)
                        got = page.evaluate("[document.body.dataset.game, document.querySelector('iframe.game').getAttribute('src')]")
                        check(got == [game, f"games/{game}/index.html"], f"[{tag}] the {game} card opens {game} {got}")
                        back_to_hub(page)
                    # A touch that begins in the side band (the back gesture) opens nothing, even level with a card.
                    y = hits(page)["bricks"]["y"]
                    for x in (20, w - 20):
                        page.touchscreen.tap(x, y)
                        page.wait_for_timeout(120)
                        check(page.evaluate("document.querySelectorAll('iframe').length") == 0 and not page.evaluate("document.body.dataset.game || ''"),
                              f"[{tag}] a touch beginning at x {x} CSS px, inside the 24 CSS px side band, opens nothing")
                    pieces_fit(page, tag)
                    check(not errors, f"[{tag}] no page errors {errors}")
                    ctx.close()


def run_resize(browser, base):
    """A live window resize, portrait to landscape and back, re-lays out cleanly."""
    ctx = new_context(browser, 360, 800)
    page = ctx.new_page()
    page.goto(base)
    first = layout_of(page)
    page.set_viewport_size({"width": 800, "height": 360})
    page.wait_for_timeout(300)
    wide = layout_of(page)
    page.screenshot(path=str(OUT / "hub-resized-800x360.png"))
    shot = OUT / "hub-resized-800x360.png"
    info, s, H, bad, total, _, _ = crisp(page, shot)
    check(wide["H"] >= 240 and bad == 0 and wide["scale"] < first["scale"],
          f"resize to 800x360: scale {first['scale']} -> {wide['scale']}, H {wide['H']}, crisp {total - bad}/{total}")
    hub_layout_checks(page, "resized 800x360", 360)
    open_tile(page, "bricks")
    check(page.evaluate("document.body.dataset.game") == "bricks", "resize: BRICKS still opens from the new layout")
    back_to_hub(page)
    page.set_viewport_size({"width": 360, "height": 800})
    page.wait_for_timeout(300)
    check(layout_of(page) == first, "resize back restores the original layout")
    ctx.close()


# Row D1 review: the full CSS named-colour list (CSS Color Module Level 4, 148 names) and transparent.
CSS_NAMED_COLOURS = (
    "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond", "blue",
    "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk",
    "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki",
    "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
    "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
    "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro",
    "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred",
    "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral",
    "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
    "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime",
    "limegreen", "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple",
    "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue",
    "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
    "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff",
    "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown",
    "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray",
    "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet",
    "wheat", "white", "whitesmoke", "yellow", "yellowgreen", "transparent",
)


def static_checks():
    import re

    # sw.js FILES must list every shipped file, and nothing else.
    sw = (ROOT / "sw.js").read_text()
    listed = set(re.findall(r"'\./([^']*)'", sw[sw.index("const FILES"):sw.index("];")]))
    shipped = set()
    for p in ROOT.rglob("*"):
        rel = p.relative_to(ROOT)
        if p.is_file() and rel.parts[0] not in SHIPPED_EXCLUDE and rel.name != "sw.js":
            shipped.add(rel.as_posix())
    folders = {f for f in listed if f == "" or f.endswith("/")}
    files = listed - folders
    check(files == shipped, f"sw.js FILES matches shipped files (missing {sorted(shipped - files)}, extra {sorted(files - shipped)})")
    check(all((ROOT / f / "index.html").is_file() for f in folders), f"sw.js folder entries have an index.html {sorted(folders)}")

    # Row X35: shared/font.js is gone and nothing names it. The lettering of the social teaser images
    # (tools/social-teaser-*.py, not shipped) lives in tools/rlx_font.py: one rounding rule for every glyph.
    named = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*")
                   if p.is_file() and p.suffix in {".js", ".mjs", ".html", ".py", ".sh", ".yml", ".json"}
                   and not {"node_modules", ".git", "out"} & set(p.relative_to(ROOT).parts)
                   and p.relative_to(ROOT).as_posix() != "tests/check.py" and "shared/font.js" in p.read_text(errors="ignore"))
    check(not (ROOT / "shared" / "font.js").exists() and not named, f"shared/font.js is gone and no file names it (row X35) {named}")
    src = (ROOT / "tools" / "rlx_font.py").read_text()
    body = src[src.index("GLYPHS = {"):]
    bad = []
    for key, rows in re.findall(r"'(.)':\s*\[([^\]]*)\]", body):
        g = re.findall(r"'([.#]+)'", rows)
        ink = lambda r, c: 0 <= r < len(g) and 0 <= c < len(g[0]) and g[r][c] == "#"  # noqa: E731
        for r in range(len(g)):
            for c in range(len(g[0])):
                if ink(r, c) and ink(r, c - 1) + ink(r, c + 1) == 1 and ink(r - 1, c) + ink(r + 1, c) == 1:
                    bad.append((key, r, c))
    check(not bad, f"tools/rlx_font.py: every outer corner is cut {bad}")
    # Row P3: the web icons are the approved beach-sunset art, no lettering; icon-512 is the Play icon pixel for pixel.
    from PIL import Image, ImageChops
    a = Image.open(ROOT / "icons" / "icon-512.png").convert("RGBA")
    b = Image.open(ROOT / "docs" / "play" / "ic-play-512.png").convert("RGBA")
    check(a.size == b.size == (512, 512) and ImageChops.difference(a, b).getbbox() is None,
          "icons/icon-512.png equals docs/play/ic-play-512.png (the approved icon, tools/make-icons.py)")
    mk = (ROOT / "tools" / "make-icons.py").read_text()
    check("rlx_art" in mk and "font" not in mk, "tools/make-icons.py draws from tools/rlx_art.py and no font (no lettering)")

    # Row X1: no settings, no storage module, fullscreen. Row H2: no page draws text, the hub included.
    check(not (ROOT / "shared" / "settings.js").exists() and not (ROOT / "shared" / "store.js").exists(),
          "shared/settings.js and shared/store.js are gone (row X1)")
    manifest = json.loads((ROOT / "manifest.webmanifest").read_text())
    check(manifest["display"] == "fullscreen", f"manifest display is fullscreen ({manifest['display']})")
    shipped_js = [p for p in list((ROOT / "shared").glob("*.js")) + list((ROOT / "games").rglob("*.js")) + list((ROOT / "hub").glob("*.js"))
                  + [ROOT / "index.html"]]
    uses = {p.relative_to(ROOT).as_posix() for p in shipped_js
            if re.search(r"localStorage|sessionStorage|indexedDB|document\.cookie|settings\.js|store\.js|hapticsOn|setHaptics",
                         re.sub(r"//.*", "", p.read_text()))}
    check(uses == {"shared/pixel.js"}, f"only pixel.js touches storage (to clear old rlx.* keys); nothing else reads a setting {sorted(uses)}")
    texty = {p.relative_to(ROOT).as_posix() for p in shipped_js if re.search(r"font\.js|drawFitted|drawText|fillText", re.sub(r"//.*", "", p.read_text()))}
    check(not texty, f"no page draws text or imports a font, the hub included (rows H2, X35) {sorted(texty)}")
    hub = (ROOT / "index.html").read_text() + (ROOT / "hub" / "cards.js").read_text()
    check(not re.search(r"SOON|HAPTICS|haptics|TOGGLE|TAG_", hub), "the hub has no SOON tile code and no haptics switch (row X1)")

    # Row D1: every colour is a token. No colour literal (hex, rgb(), hsl() or a CSS colour name) is drawn
    # or set anywhere in the shipped hub and games outside shared/tokens.js and its mirror shared/theme.css;
    # the only others are the pages' theme-color metas, which must be the light and dark sky-top tokens,
    # and the manifest's colours, which stay the light sky-top (a manifest cannot switch).
    sets = json.loads(subprocess.run(["node", "--input-type=module", "-e",
                                      "import * as T from './shared/tokens.js'; console.log(JSON.stringify({ light: T.LIGHT.COLORS.skyTop, dark: T.DARK.COLORS.skyTop }))"],
                                     cwd=ROOT, capture_output=True, text=True).stdout)
    named = r"\b(?:white|black|red|green|blue|yellow|orange|pink|purple|gray|grey|navy|teal|cyan|magenta|silver|gold|brown|violet|indigo|maroon|olive|lime|aqua|fuchsia|beige|coral|salmon|crimson|transparent)\b"
    literal = re.compile(r"#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(\s*[\d.]")  # rgb(20, ...), not a function named rgb
    exact_name = re.compile(r"(['\"`])\s*(" + "|".join(CSS_NAMED_COLOURS) + r")\s*\1", re.I)
    # The only genuine false positives in the tree: Catch's LOOK table names its sprites' colours by token key, and
    # two keys of COLORS are also CSS colour names. catch.js colourOf() resolves them as COLORS[name] (a token), so
    # 'coral' (an item, the fish and the treat canopy: COLORS.coral) and 'blue' (the nasties: COLORS.blue) are
    # token names, not colours.
    NAME_ALLOW = {"games/catch/sim.js": ("coral", "blue")}
    offenders, metas_ok = [], True
    for f in sorted(files):
        if not f.endswith((".js", ".html", ".css")) or f in ("shared/tokens.js", "shared/theme.css"):
            continue
        text = (ROOT / f).read_text()
        if f.endswith(".html"):
            metas = re.findall(r'<meta name="theme-color" content="([^"]+)" media="\(prefers-color-scheme: (light|dark)\)">', text)
            metas_ok &= sorted(metas) == sorted([(sets["light"], "light"), (sets["dark"], "dark")]) and '<meta name="color-scheme" content="light dark">' in text
            text = re.sub(r'<meta name="theme-color"[^>]*>', "", text)
        code = re.sub(r"//[^\n]*|/\*.*?\*/", "", text, flags=re.S)
        hits_ = literal.findall(code)
        # A CSS colour name used as a value: fillStyle/strokeStyle/color/background strings in quotes.
        hits_ += re.findall(r"(?:fillStyle|strokeStyle|color|background)\s*[:=]\s*['\"]" + named, code)
        if f.endswith(".css"):
            hits_ += re.findall(r":\s*" + named, code)
        # D1 review: a CSS colour name kept in a variable first (const X = 'navy') escapes the check above, so any
        # string literal that is exactly a CSS colour name (the full named-colour list) is flagged as well,
        # unless the allow-list below names it for this file.
        hits_ += [m.group(2) for m in exact_name.finditer(code) if m.group(2).lower() not in NAME_ALLOW.get(f, ())]
        if hits_:
            offenders.append((f, hits_[:3]))
    check(not offenders, f"no colour literal in the shipped hub, games or shared code outside tokens.js and theme.css (row D1) {offenders}")
    check(metas_ok, f"every page's theme-color follows the theme: light {sets['light']} and dark {sets['dark']} by media query, color-scheme light dark")
    check(manifest["background_color"] == manifest["theme_color"] == sets["light"], "the manifest's colours stay the light sky-top (a manifest cannot switch)")
    scheme = {p.relative_to(ROOT).as_posix() for p in shipped_js if "prefers-color-scheme" in re.sub(r"//.*", "", p.read_text())
              and p.suffix == ".js"}
    check(scheme == {"shared/tokens.js"}, f"the theme is read in one place, shared/tokens.js, from prefers-color-scheme (no setting, no toggle) {sorted(scheme)}")


def snap(page):
    return page.evaluate("window.__bricks.snapshot()")


def sea_point(page):
    """A point in the sea (the thumb zone), in CSS px, and the scale and CSS px per device px."""
    v = view_of(page)
    info = page.evaluate("() => { const r = document.getElementById('screen').getBoundingClientRect(); "
                         "const c = document.getElementById('screen'); return { l: r.left, t: r.top, k: r.width / c.width }; }")
    s, H = v["scale"], v["H"]
    x = info["l"] + (v["ox"] + 67.5 * s) * info["k"]
    y = info["t"] + (v["oy"] + (H - 20) * s) * info["k"]
    return x, y, s, info["k"]


def open_bricks(ctx, base):
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "games/bricks/")
    page.wait_for_function(GAME_READY["bricks"])
    page.wait_for_timeout(150)
    return page, errors


def reopen(page, base):
    """Open Bricks again (a fresh field: nothing is saved)."""
    page.goto(base + "games/bricks/")
    page.wait_for_function(GAME_READY["bricks"])
    page.wait_for_timeout(150)


def track(page, ms, x, y, scale, k):
    """Hold a finger at (x, y) and follow the ball with relative drags, then lift."""
    width = page.viewport_size["width"]
    cur = x
    sens = snap(page)["sensitivity"]
    page.mouse.move(cur, y)
    page.mouse.down()
    end = time.time() + ms / 1000
    while time.time() < end:
        q = snap(page)["game"]
        if q["ball"]:
            d = q["ball"]["x"] + 2.5 - (q["paddleX"] + 15)
            nxt = max(30, min(width - 30, cur + max(-12, min(12, d / sens * scale * k))))
            if abs(nxt - cur) > 0.01:
                page.mouse.move(nxt, y)
                cur = nxt
        page.wait_for_timeout(15)
    page.mouse.up()


def two_touches(ctx, page, tag):
    """Only the first finger down drives the paddle; the next takes over when it lifts.
    CDP cannot lift one of two touches, so this dispatches touch PointerEvents
    (ids 11 and 12) on the canvas, the events bricks.js listens to."""
    x, y, scale, k = sea_point(page)
    ax, bx = x - 60, x + 60

    def ev(kind, pid, px):
        page.evaluate("""([kind, pid, px, py]) => document.getElementById('screen').dispatchEvent(new PointerEvent(kind,
            { pointerId: pid, pointerType: 'touch', clientX: px, clientY: py, bubbles: true, cancelable: true, isPrimary: pid === 11 }))""",
                      [kind, pid, px, y])

    # Drag toward the middle so the paddle is never at a clamp.
    q = snap(page)
    sign = 1 if q["game"]["paddleX"] < 52.5 else -1
    ev("pointerdown", 11, ax)
    page.wait_for_timeout(350)
    p0 = snap(page)["game"]["paddleX"]
    ev("pointerdown", 12, bx)
    ev("pointermove", 12, bx + 30 * sign)
    q = snap(page)
    check(q["fingers"] == 2 and q["mode"] == "running" and q["game"]["paddleX"] == p0,
          f"[{tag}] two fingers: the second finger does not move the paddle ({q['game']['paddleX'] - p0:.2f})")
    ev("pointermove", 11, ax + 10 * sign)
    p1 = snap(page)["game"]["paddleX"]
    want = 10 * sign / k / scale * snap(page)["sensitivity"]
    check(abs((p1 - p0) - want) < 1e-6, f"[{tag}] two fingers: the first finger drives it ({p1 - p0:.2f} for {want:.2f})")
    ev("pointerup", 11, ax + 10 * sign)
    q = snap(page)
    check(q["fingers"] == 1 and q["mode"] == "running", f"[{tag}] two fingers: lifting the first keeps playing")
    ev("pointermove", 12, bx + 40 * sign)
    p2 = snap(page)["game"]["paddleX"]
    check(abs((p2 - p1) - want) < 1e-6, f"[{tag}] two fingers: the remaining finger takes over from where it is ({p2 - p1:.2f} for {want:.2f})")
    ev("pointerup", 12, bx + 40 * sign)
    q = snap(page)
    check(q["fingers"] == 0 and q["mode"] == "paused", f"[{tag}] two fingers: lifting the last one pauses")


def run_bricks(browser, base):
    """Rows B1, B2 and X1: Bricks in the browser at 360x800."""
    tag = "bricks 360x800"
    ctx = new_context(browser, 360, 800, motion=True)
    foreign = []
    origin = base.split("/4rk4d3/")[0]
    ctx.on("request", lambda r: (not r.url.startswith(origin) and not r.url.startswith("data:")) and foreign.append(r.url))
    page, errors = open_bricks(ctx, base)
    page.evaluate("localStorage.clear(); sessionStorage.clear()")
    page.reload()
    page.wait_for_function(GAME_READY["bricks"])
    page.wait_for_timeout(200)

    s0 = snap(page)
    g0 = s0["game"]
    check(s0["mode"] == "paused" and s0["count"] == 63 and "score" not in g0 and "v" not in g0,
          f"[{tag}] opening: 9 full rows, paused, no score in the state ({s0['mode']}, {s0['count']})")
    check([r["c"] for r in g0["rows"][:9]] == list(range(9)), f"[{tag}] rows coloured by the brick tokens top to bottom")
    shot = OUT / "bricks-game-paused.png"
    page.screenshot(path=str(shot))
    no_pause_marker(page, shot, tag, "__bricks", "Bricks opening")
    info, s, H, bad, total, ncol, size = crisp(page, shot)
    check(bad == 0, f"[{tag}] crisp: {total - bad}/{total} uniform {s}x{s} blocks")
    check(info["sw"] <= info["iw"] and info["sh"] <= info["ih"], f"[{tag}] no scrolling or overflow")
    geo = g0["geo"]
    check(geo["horizon"] == H - 42 and geo["paddleY"] + 6 == geo["horizon"] - 16, f"[{tag}] paddle 16 px above the horizon")
    check(geo["top"] == 5, f"[{tag}] no HUD line: the field starts 5 px below the top ({geo['top']})")
    no_hud(page, tag, "Bricks")

    # Paused: nothing moves and no animation loop runs.
    r0 = page.evaluate("window.__raf")
    page.wait_for_timeout(500)
    s1 = snap(page)
    check(s1["game"] == g0 and page.evaluate("window.__raf") == r0 and not s1["raf"],
          f"[{tag}] paused: state frozen and no frame requested ({page.evaluate('window.__raf') - r0} rAF calls)")

    # Row X1: a touch that begins within 24 CSS px of either side edge (the back gesture) moves nothing.
    x, y, scale, k = sea_point(page)
    for ex, to in ((5, 120), (23, 120), (337, 240), (355, 240)):
        page.mouse.move(ex, y)
        page.mouse.down()
        page.mouse.move(to, y, steps=4)
        page.wait_for_timeout(320)
        page.mouse.up()
    q = snap(page)
    check(q["mode"] == "paused" and q["game"] == g0 and q["fingers"] == 0,
          f"[{tag}] touches that begin within 24 CSS px of the left or right edge are ignored: no resume, the paddle still")

    # Finger down in the sea (25 px in counts): resumes after 250 ms.
    page.mouse.move(x, y)
    nvib = page.evaluate("window.__vib.length")
    page.mouse.down()
    # Dragging during the resume delay moves the paddle only: no bounce, no tick.
    page.mouse.move(x + 6, y, steps=2)
    page.mouse.move(x, y, steps=2)
    page.wait_for_timeout(60)
    s2 = snap(page)
    check(s2["mode"] == "resuming" and s2["game"]["ball"] == g0["ball"], f"[{tag}] finger down: waits before resuming ({s2['mode']})")
    check(page.evaluate("window.__vib.length") == nvib and abs(s2["game"]["paddleX"] - g0["paddleX"]) < 1e-9,
          f"[{tag}] while resuming a drag moves the paddle but nothing bounces or ticks")
    page.wait_for_timeout(300)
    s3 = snap(page)
    check(s3["mode"] == "running" and s3["game"]["ball"]["y"] < g0["ball"]["y"], f"[{tag}] after 250 ms the ball flies")

    # Relative drag: paddle moves by finger dx x the thumb-travel sensitivity, never jumps to the finger.
    sens = snap(page)["sensitivity"]
    devw = page.evaluate("innerWidth * devicePixelRatio")
    check(abs(sens - (135 - 30) / (0.28 * devw / scale)) < 0.01, f"[{tag}] Bricks drag sensitivity {sens:.3f} puts 28 percent of the screen width end to end")
    p0 = snap(page)["game"]["paddleX"]
    page.mouse.move(x + 20, y, steps=4)
    p1 = snap(page)["game"]["paddleX"]
    want = 20 / k / scale * sens
    check(abs((p1 - p0) - want) < 0.05, f"[{tag}] relative drag: paddle moved {p1 - p0:.2f} for {want:.2f} expected")
    page.mouse.move(x, y, steps=4)
    p2 = snap(page)["game"]["paddleX"]
    check(abs(p2 - p0) < 0.05, f"[{tag}] dragging back returns the paddle ({p2:.2f} vs {p0:.2f})")
    page.mouse.move(x + 600, y, steps=8)
    check(abs(snap(page)["game"]["paddleX"] - (135 - 30)) < 1e-9, f"[{tag}] paddle clamped to the field")
    page.mouse.up()
    # Centre the paddle again: far left (clamped at 0), then right by 52.5 / sens.
    page.mouse.move(330, y)
    page.mouse.down()
    page.mouse.move(30, y, steps=8)
    check(snap(page)["game"]["paddleX"] == 0, f"[{tag}] paddle clamped at the left edge")
    page.mouse.move(30 + (52.5 / sens) * scale * k, y, steps=8)
    page.mouse.up()
    # A thumb that follows the ball, so both bricks and the paddle get hit: haptics always on.
    track(page, 5000, x, y, scale, k)
    vib = page.evaluate("window.__vib")
    check(8 in vib and 16 in vib and set(vib) <= {8, 16},
          f"[{tag}] haptics always on: brick 8 ms and paddle 16 ms ticks only ({vib})")

    # Lift: frozen within one frame, no marker drawn (X33).
    page.mouse.up()
    a = snap(page)
    page.wait_for_timeout(300)
    b = snap(page)
    check(a["mode"] == "paused" and a["game"]["ball"] == b["game"]["ball"] and a["game"]["time"] == b["game"]["time"],
          f"[{tag}] lifting the thumb freezes play at once")
    r1 = page.evaluate("window.__raf")
    page.wait_for_timeout(400)
    check(page.evaluate("window.__raf") == r1, f"[{tag}] no animation loop while paused")
    shot = OUT / "bricks-game-lifted.png"
    page.screenshot(path=str(shot))
    no_pause_marker(page, shot, tag, "__bricks", "Bricks after the lift")
    no_hud(page, tag, "Bricks after play")
    # Session clock (row B2, X1): play advanced it in memory, the pause does not.
    page.wait_for_timeout(1000)
    c2 = snap(page)
    check(4 < b["clock"]["active"] < 30 and c2["clock"] == b["clock"],
          f"[{tag}] session clock: {b['clock']['active']:.2f} s of play counted, unchanged after 1.3 s paused")
    st = page.evaluate(STORAGE_JS)
    check(st == {"local": {}, "session": {}, "idb": [], "cookie": ""}, f"[{tag}] after play storage is empty {st}")

    # Hidden mid-flight: pause, stop the loop.
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(700)
    set_hidden(page, True)
    h = snap(page)
    r2 = page.evaluate("window.__raf")
    page.wait_for_timeout(400)
    check(h["mode"] == "paused" and not h["raf"] and snap(page)["game"] == h["game"]
          and page.evaluate("window.__raf") == r2, f"[{tag}] hidden: paused, no loop")
    set_hidden(page, False)
    page.mouse.up()
    page.mouse.down()
    page.wait_for_timeout(900)
    mid = snap(page)["game"]
    check(mid["ball"] is not None and mid["time"] > h["game"]["time"], f"[{tag}] plays on after coming back")
    # Hidden for 3 s with the finger up: the clock does not move.
    page.mouse.up()
    before_clock = snap(page)["clock"]
    set_hidden(page, True)
    page.wait_for_timeout(3000)
    set_hidden(page, False)
    page.wait_for_timeout(500)
    shown = snap(page)
    check(shown["clock"]["active"] == before_clock["active"] and shown["clock"]["resets"] == 0 and shown["mode"] == "paused",
          f"[{tag}] hidden 3 s with the finger up, then shown: the clock stays the same ({before_clock['active']:.2f} s)")
    page.mouse.down()
    page.wait_for_timeout(900)

    # Kill mid-flight (pagehide, no lift) and reopen: a fresh field, paused; nothing was stored.
    page.evaluate("dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))")
    st = page.evaluate(STORAGE_JS)
    page.close()
    page, errors2 = open_bricks(ctx, base)
    r = snap(page)
    check(st == {"local": {}, "session": {}, "idb": [], "cookie": ""} and r["mode"] == "paused" and r["count"] == 63
          and r["game"]["pace"] == 90 and r["clock"]["active"] == 0,
          f"[{tag}] killed mid-flight: nothing stored; reopened: a fresh field at pace 90, paused, the clock at 0")
    errors += errors2
    two_touches(ctx, page, tag)

    # Motion: particles and trail appear; with reduced motion, never. Fresh field each time.
    reopen(page, base)
    seen = {"particles": 0, "trail": 0}
    x, y, scale, k = sea_point(page)
    page.mouse.move(x, y)
    page.mouse.down()
    for _ in range(30):
        page.wait_for_timeout(100)
        q = snap(page)
        seen["particles"] = max(seen["particles"], q["particles"])
        seen["trail"] = max(seen["trail"], q["trail"])
        if seen["particles"] and seen["trail"]:
            break
    page.screenshot(path=str(OUT / "bricks-game-play.png"))
    page.mouse.up()
    check(seen["particles"] > 0 and seen["trail"] > 0, f"[{tag}] brick pop particles and ball trail shown {seen}")
    page.emulate_media(reduced_motion="reduce")
    reopen(page, base)
    seen = {"particles": 0, "trail": 0}
    page.evaluate("window.__vib = []")
    page.mouse.move(x, y)
    page.mouse.down()
    for _ in range(30):
        page.wait_for_timeout(100)
        q = snap(page)
        seen["particles"] = max(seen["particles"], q["particles"])
        seen["trail"] = max(seen["trail"], q["trail"])
    page.mouse.up()
    pops = page.evaluate("window.__vib").count(8)
    check(seen == {"particles": 0, "trail": 0} and pops > 0, f"[{tag}] reduced motion: no particles, no trail over {pops} pop ticks {seen}")
    page.emulate_media(reduced_motion="no-preference")

    check(not errors and not errors2, f"[{tag}] no console errors {errors + errors2}")
    check(not foreign, f"[{tag}] no requests to another host {foreign}")
    ctx.close()


def logical_pixels(page, shot, points):
    """Colours (#RRGGBB) of logical pixels in a screenshot."""
    from PIL import Image

    img = Image.open(shot).convert("RGB")
    v = view_of(page)
    s = v["scale"]
    return ["#%02X%02X%02X" % img.getpixel((v["ox"] + x * s + s // 2, v["oy"] + y * s + s // 2)) for x, y in points]


# Row X33: no pause marker. The scene as shared/pixel.js drawScene paints it for the page's
# phase, rows from 4 below the horizon to the bottom (the sea, where the ring used to be).
SCENE_SEA_JS = """async (hook) => {
  const base = location.href.split('/games/')[0] + '/shared/';
  const px = await import(base + 'pixel.js');
  const se = await import(base + 'session.js');
  const q = window[hook].snapshot();
  const W = q.view.W, H = q.view.H, y0 = H - px.SEA_HEIGHT + 4;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { alpha: false });
  px.drawScene(g, W, H, { phase: se.phaseOf(q.clock.active) });
  const d = g.getImageData(0, y0, W, H - y0).data;
  const out = [];
  for (let i = 0; i < d.length; i += 4) out.push('#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase());
  return { W, H, y0, px: out };
}"""


def no_pause_marker(page, shot, tag, hook, what):
    """Row X33: in a frame drawn while paused, the sea below the boat or paddle is the bare scene, pixel for pixel."""
    want = page.evaluate(SCENE_SEA_JS, hook)
    W, y0 = want["W"], want["y0"]
    pts = [(x, y) for y in range(y0, want["H"]) for x in range(W)]
    got = logical_pixels(page, shot, pts)
    diff = [pts[i] for i in range(len(pts)) if got[i] != want["px"][i]]
    check(page.evaluate(f"window.{hook}.snapshot().mode") == "paused" and len(pts) > 0 and not diff,
          f"[{tag}] {what}: paused, and no pause marker drawn: the sea is the bare scene ({len(pts)} px, {len(diff)} differ {diff[:3]})")


def delta_e(a, b):
    """CIE76 colour difference in CIELAB (D65), as in tests/bricks-sim.mjs."""
    def lab(h):
        def lin(c):
            c /= 255
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        r, g, b_ = (lin(int(h[i:i + 2], 16)) for i in (1, 3, 5))
        f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116  # noqa: E731
        X = f((0.4124 * r + 0.3576 * g + 0.1805 * b_) / 0.95047)
        Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b_)
        Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b_) / 1.08883)
        return (116 * Y - 16, 500 * (X - Y), 200 * (Y - Z))
    p, q = lab(a), lab(b)
    return sum((x - y) ** 2 for x, y in zip(p, q)) ** 0.5


def contrast(a, b):
    """WCAG 2 contrast ratio, as in tests/contrast.mjs."""
    def lum(h):
        def lin(c):
            c /= 255
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        r, g, b_ = (lin(int(h[i:i + 2], 16)) for i in (1, 3, 5))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b_
    x, y = lum(a), lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


# B4 standard (tests/contrast.mjs): controls and large lettering 3, small lettering 4.5, shapes delta E 20.
MIN_CR, MIN_CR_SMALL, MIN_DE = 3, 4.5, 20


def run_scene(browser, base):
    """Rows B2 and X1: the hub draws the phase of the one in-memory clock; Bricks at full dusk; the reset after 5 minutes hidden."""
    tag = "scene 360x800"
    ctx = new_context(browser, 360, 800)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base)
    hits(page)
    tok = page.evaluate("""async () => { const T = await import(new URL('shared/tokens.js', document.baseURI).href);
      return { pals: Array.from({ length: 11 }, (_, k) => T.scenePalette(k / 10)), bricks: T.BRICK_ROWS,
        c: { ...T.COLORS, ink: T.COLORS.ink || T.COLORS.blue } }; }""")
    pals, C = tok["pals"], tok["c"]

    def hub(name, active=None):
        if active is not None:
            page.evaluate(SET_CLOCK_JS, active)
        page.wait_for_timeout(150)
        shot = OUT / f"hub-scene-{name}.png"
        page.screenshot(path=str(shot))
        lay = layout_of(page)
        hz = json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))["horizon"]  # the hub's raised horizon (H2)
        step = int(page.eval_on_selector("#screen", "c => c.dataset.scene"))
        return step, shot, lay, hz

    step, shot, lay, hz = hub("none")
    top, sea = logical_pixels(page, shot, [(1, 1), (1, hz + 2)])
    check(step == 0 and top == pals[0]["sky"][0] and sea == pals[0]["sea"][0] and page.evaluate("window.__rlxSession.active") == 0,
          f"[{tag}] hub at app start: the clock at 0, sunset (step {step}, {top}, {sea})")
    step, shot, lay, hz = hub("step5", 300)
    top, sea = logical_pixels(page, shot, [(1, 1), (1, hz + 2)])
    check(step == 5 and top == pals[5]["sky"][0] and sea == pals[5]["sea"][0],
          f"[{tag}] hub after 5 minutes of play: step 5 drawn ({step}, sky {top}, sea {sea})")
    page.wait_for_timeout(1200)
    check(page.evaluate("window.__rlxSession.active") == 300 and page.eval_on_selector("#screen", "c => c.dataset.scene") == "5",
          f"[{tag}] a hub left open does not advance the clock")
    step, shot, lay, hz = hub("dusk", 720)
    info, s, H, bad, total, _, _ = crisp(page, shot)
    r = lay["rects"]
    s0, s1 = json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))["stars"]
    star = (22, round(s0 + 0.05 * (s1 - s0)))
    top, sea, sun, st, tile = logical_pixels(page, shot, [(1, 1), (1, hz + 2), (96, hz - 1), star, (r["bricks"]["x"] + 2, r["bricks"]["y"] + 20)])
    check(step == 10 and top == "#CDB8E0" and sea == "#6FA3C4" and bad == 0,
          f"[{tag}] hub after 12 minutes of play: full dusk, crisp ({step}, sky {top}, sea {sea}, {total - bad}/{total})")
    check(sun != C["sun"] and st == "#FFFFFF" and tile == C["coral"],
          f"[{tag}] hub at dusk: sun below the horizon ({sun}), a white star ({st}), the Bricks card's frame keeps its colour ({tile})")
    # Hidden just under 5 minutes: the clock carries on; 5 minutes or more: it starts again, and the hub shows sunset.
    set_hidden(page, True)
    page.evaluate("window.__rlxSession.hiddenAt = Date.now() - (5 * 60 * 1000 - 5000)")
    set_hidden(page, False)
    step, *_ = hub("hidden-4m55")
    check(step == 10 and page.evaluate("window.__rlxSession.active") == 720, f"[{tag}] hidden 4 min 55 s: the clock carries on (step {step})")
    set_hidden(page, True)
    page.evaluate("window.__rlxSession.hiddenAt = Date.now() - 5 * 60 * 1000")
    set_hidden(page, False)
    step, shot, *_ = hub("after-gap")
    top, = logical_pixels(page, shot, [(1, 1)])
    check(step == 0 and top == "#FFF7EC" and page.evaluate("window.__rlxSession.active") == 0,
          f"[{tag}] hidden 5 minutes: the clock starts again, the hub at sunset ({step}, {top})")
    page.evaluate(SET_CLOCK_JS, 300)
    page.reload()
    hits(page)
    check(page.evaluate("window.__rlxSession.active") == 0 and page.eval_on_selector("#screen", "c => c.dataset.scene") == "0",
          f"[{tag}] the clock resets when the app starts (a reload of the hub)")

    # Bricks opened from the hub at 12 minutes: it reads the hub's clock (one clock), full dusk, every colour kept.
    page.evaluate(SET_CLOCK_JS, 720)
    g_ = open_tile(page, "bricks")
    page.wait_for_timeout(200)
    q = snap(g_)
    g = q["game"]
    geo = g["geo"]
    shot = OUT / "bricks-dusk.png"
    page.screenshot(path=str(shot))
    info, s, H, bad, total, _, _ = crisp(g_, shot)
    check(q["step"] == 10 and q["clock"]["active"] == 720 and bad == 0, f"[{tag}] Bricks opened from the hub at 12 minutes: the hub's clock, full dusk, crisp ({q['step']})")
    pts = []
    for row in range(9):
        y = geo["top"] + row * 9 + 3
        pts += [(geo["left"] + 7, y), (geo["left"] - 4, y)]
    bx, by = round(g["ball"]["x"]), round(g["ball"]["y"])
    px, py = round(g["paddleX"]), geo["paddleY"]
    pts += [(px + 15, py + 3), (px - 3, py + 3), (bx + 2, by + 2), (bx - 3, by + 2)]
    got = logical_pixels(g_, shot, pts)
    sky = {c for p_ in pals for c in p_["sky"]}
    rows_ok = all(got[2 * i] == tok["bricks"][g["rows"][i]["c"]] for i in range(9))
    pairs = [(f"brick row {i + 1}", got[2 * i], got[2 * i + 1]) for i in range(9)]
    pairs += [("paddle", got[18], got[19]), ("ball", got[20], got[21])]
    kept = rows_ok and got[18] == C["coral"] and got[20] == C["blue"]
    check(kept and all(bg in sky for _, _, bg in pairs),
          f"[{tag}] at dusk bricks, paddle and ball keep their token colours over dusk sky bands")
    need = {"ball": ("cr", MIN_CR), "paddle": None}
    under = []
    for what, fg, bg in pairs:
        rule = need.get(what, ("de", MIN_DE))
        if rule is None:
            continue
        v = contrast(fg, bg) if rule[0] == "cr" else delta_e(fg, bg)
        if v < rule[1]:
            under.append((what, fg, bg, round(v, 2)))
    check(not under, f"[{tag}] at dusk the drawn bricks (dE >= 20) and ball (3:1) meet the B4 standard against the sky beside them {under}")

    # Hidden 5 minutes while in Bricks: the clock starts again, and so does the pace at the next play; the ball keeps its speed.
    g_.evaluate("() => { const s = window.__bricks.live(); s.pace = 80; s.speed = 80; }")
    set_hidden(page, True)
    set_hidden(g_.frame, True)
    page.evaluate("window.__rlxSession.hiddenAt = Date.now() - 5 * 60 * 1000")
    set_hidden(g_.frame, False)  # the game's page may see it first: the reset is in place before the game looks
    set_hidden(page, False)
    page.wait_for_timeout(200)
    q = snap(g_)
    check(q["clock"]["active"] == 0 and q["step"] == 0 and q["game"]["pace"] == 80,
          f"[{tag}] Bricks hidden 5 minutes: shown again at sunset, the clock at 0; the pace waits for play ({q['game']['pace']})")
    x, y, scale, k = sea_point(g_)
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(320)
    q = snap(g_)
    page.mouse.up()
    check(q["mode"] == "running" and q["game"]["pace"] == 90 and q["game"]["speed"] == 80,
          f"[{tag}] play starts again: pace 90, the ball keeps 80 until its next bounce ({q['game']['pace']}, {q['game']['speed']})")
    back_to_hub(page)
    check(page.evaluate("window.__rlxSession.active") > 0 and page.eval_on_selector("#screen", "c => c.dataset.scene") == "0",
          f"[{tag}] back at the hub: the play just made is on the hub's clock")
    check(not errors, f"[{tag}] no console errors {errors}")
    ctx.close()


# Row D1 review: the moon's runs as shared/pixel.js sunRuns draws them (night, and the day disc for its unlit part).
MOON_RUNS_JS = """async ({ sunX, horizon, r, sink }) => {
  const px = await import(new URL('shared/pixel.js', document.baseURI).href);
  return { night: px.sunRuns(sunX, horizon, r, sink, -Infinity, true), disc: px.sunRuns(sunX, horizon, r, sink, -Infinity, false) };
}"""


def run_scene_dark(browser, base):
    """Row D1 review: the exit ramp in the dark theme on the hub (360x800), at steps 0, 5, 8 and 10: the scene
    palette is the dark sunset-to-dusk mix of shared/tokens.js, the crescent moon sinks and is gone at step 10,
    and the stars are out from step 0 (4) and 6 from step 8 on (shared/pixel.js starsAt)."""
    import re

    tag = "scene dark 360x800"
    ctx = new_context(browser, 360, 800, scheme="dark")
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base)
    hits(page)
    tok = page.evaluate("""async () => { const T = await import(new URL('shared/tokens.js', document.baseURI).href);
      const px = await import(new URL('shared/pixel.js', document.baseURI).href);
      return { active: T.tokens().name, pals: Array.from({ length: 11 }, (_, k) => T.scenePalette(k / 10)),
        C: T.DARK.COLORS, D: T.DARK.DUSK, sea: [...T.DARK.SEA_BANDS], bands: T.SKY_BANDS,
        stars: Array.from({ length: 11 }, (_, k) => px.starsAt(k)) }; }""")
    C, D = tok["C"], tok["D"]
    check(tok["active"] == "dark", f"[{tag}] the dark token set is active ({tok['active']})")
    # The stars as the build defines them (shared/pixel.js STARS, read from the source): [x, fraction of the open sky].
    src = (ROOT / "shared" / "pixel.js").read_text()
    i0 = src.index("const STARS")
    star_list = [(int(x), float(f)) for x, f in re.findall(r"\[(\d+),\s*([\d.]+)\]", src[i0:src.index("];", i0)])]
    prev_lit, prev_top = None, None
    for k, active in ((0, 0), (5, 300), (8, 480), (10, 600)):
        t = k / 10
        page.evaluate(SET_CLOCK_JS, active)
        page.wait_for_timeout(150)
        shot = OUT / f"hub-scene-dark-step{k}.png"
        page.screenshot(path=str(shot))
        step = int(page.eval_on_selector("#screen", "c => c.dataset.scene"))
        g = json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))
        hz, sun_x, r = g["horizon"], g["sunX"], g["sunRadius"]
        # Palette: every value a flat mix between its dark sunset and dark dusk token (tokens.js scenePalette).
        top_c, bot_c = mix_hex(C["skyTop"], D["skyTop"], t), mix_hex(C["skyBottom"], D["skyBottom"], t)
        want = {"sky": [mix_hex(top_c, bot_c, i / (tok["bands"] - 1)) for i in range(tok["bands"])],
                "sea": [mix_hex(c, D["seaBands"][i], t) for i, c in enumerate(tok["sea"])]}
        if k == 10:
            check(want["sky"][0] == D["skyTop"] and want["sky"][-1] == D["skyBottom"] and want["sea"] == list(D["seaBands"]),
                  f"[{tag}] step 10 is the dark DUSK tokens ({want['sky'][0]}, {want['sea']})")
        sky0, sea0 = logical_pixels(page, shot, [(1, 1), (1, hz + 2)])
        check(step == k and tok["pals"][k] == want and sky0 == want["sky"][0] and sea0 == want["sea"][0],
              f"[{tag} step {k}] the dark palette at step {k}: tokens.js scenePalette equals the dark sunset-to-dusk mix, "
              f"and the hub draws it (step {step}, sky {sky0} want {want['sky'][0]}, sea {sea0} want {want['sea'][0]})")
        # The crescent moon: every pixel of its runs drawn in the moon colour, the rest of the day disc not.
        sink = round(t * r)
        runs = page.evaluate(MOON_RUNS_JS, {"sunX": sun_x, "horizon": hz, "r": r, "sink": sink})
        lit = [(x + i, y) for x, y, w in runs["night"] for i in range(w)]
        disc = [(x + i, y) for x, y, w in runs["disc"] for i in range(w)]
        dark_part = sorted(set(disc) - set(lit))
        got_lit = logical_pixels(page, shot, lit) if lit else []
        got_dark = logical_pixels(page, shot, dark_part) if dark_part else []
        box = [(x, y) for x in range(sun_x - r, sun_x + r + 1) for y in range(max(0, hz - r), hz)]
        moon_in_box = sum(c == C["sun"] for c in logical_pixels(page, shot, box))
        top_y = min((y for _, y in lit), default=None)
        if k < 10:
            sank = prev_lit is None or (len(lit) < prev_lit and top_y > prev_top)
            check(lit and all(c == C["sun"] for c in got_lit) and dark_part and not any(c == C["sun"] for c in got_dark)
                  and moon_in_box == len(lit) and sank,
                  f"[{tag} step {k}] a crescent moon, sunk {sink} px: its {len(lit)} lit pixels in {C['sun']}, the {len(dark_part)} "
                  f"of the disc's unlit part not, top row y {top_y}" + ("" if prev_lit is None else f" (was {prev_lit} px, top {prev_top}): it sinks"))
            prev_lit, prev_top = len(lit), top_y
        else:
            check(not runs["night"] and moon_in_box == 0,
                  f"[{tag} step 10] the moon is gone below the horizon ({len(runs['night'])} runs, {moon_in_box} moon pixels in the sky round x {sun_x})")
        # Stars: shared/pixel.js starsAt gives 4 from step 0 (NIGHT_STARS) and 6 from step 8 (the two of step 8 on top).
        n = tok["stars"][k]
        s0, s1 = g["stars"]
        centres = [(x, round(s0 + f * (s1 - s0))) for x, f in star_list]
        # At 360x800 every star drawn is in open sky (none sits under a cloud or the moon), so all n show:
        # each one's plus (centre and four arms) is in the star colour, and the stars not yet out are not drawn.
        shown = [all(c == C["star"] for c in logical_pixels(page, shot, [(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]))
                 for x, y in centres]
        check(n == (4 if k < 8 else 6) and shown[:n] == [True] * n and not any(shown[n:]),
              f"[{tag} step {k}] {n} stars out (starsAt; 4 from step 0, 6 from step 8), {sum(shown)} drawn in {C['star']} {shown}")
    check(not errors, f"[{tag}] no console errors {errors}")
    ctx.close()


def csnap(page):
    return page.evaluate("window.__catch.snapshot()")


class Touch:
    """Real touch input over CDP (Input.dispatchTouchEvent): Chrome turns it into
    touch pointer events, as on the phone. One finger. On a Hosted game the
    touches go to the hub's page, over which the game's frame lies."""

    def __init__(self, ctx, page):
        self.cdp = ctx.new_cdp_session(getattr(page, "page", page))
        self.x = self.y = 0

    def down(self, x, y):
        self.x, self.y = x, y
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})

    def move(self, x, y):
        self.x, self.y = x, y
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})

    def up(self):
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def tap(self, x, y, hold_ms=30):
        self.down(x, y)
        time.sleep(hold_ms / 1000)
        self.up()


HUB_TOKENS_JS = """async () => {
  const T = await import(new URL('shared/tokens.js', document.baseURI).href);
  // Tokens before B4 had no ink, card, sail or edge: fall back, so old tokens fail cleanly.
  const C = { ...T.COLORS, ink: T.COLORS.ink || T.COLORS.blue, card: T.COLORS.card || '#A0D0E8', sail: T.COLORS.sail || T.COLORS.sun };
  const edge = T.edge || T.shade;
  return {
    pals: Array.from({ length: 11 }, (_, k) => T.scenePalette(k / 10)), C, bands: T.SKY_BANDS,
    edgeCoral: edge(C.coral), lineCoral: (T.line || edge)(C.coral), theme: T.tokens ? T.tokens().name : 'light', soonFill: T.mix(C.skyBottom, C.cloud, 0.45),
    // B4 review: keel, glint and ink cloud (absent before it: null, so old tokens fail cleanly).
    keel: C.keel || null, glint: C.glint || null,
    inked: Array.from({ length: 11 }, (_, k) => T.scenePalette(k / 10).sea.map((c) => T.mix(c, C.inkCloud || T.shade(C.blue), T.INK_CLOUD_AMOUNT || 0.35))),
  };
}"""

# Logical heights 240, 300 and 400 at 360 CSS px wide, DPR 3 (scale 8).
CONTRAST_VIEWS = [(360, 640, "H240"), (360, 800, "H300"), (360, 1067, "H400")]


HUB_PARTS_JS = """async (step) => {
  const M = await import(new URL('hub/cards.js', document.baseURI).href);
  const g = JSON.parse(document.getElementById('screen').dataset.grid);
  const parts = {};
  for (const c of M.CARDS) {
    parts[c.id] = M.cardParts(c.id, g.windows[c.id], step).map((p) => ({
      what: p.what, bg: !!p.bg, measure: p.measure !== false, colour: p.colour || null, rule: p.rule || null, fill: p.fill || null,
      edge: p.edge || null, exempt: p.exempt || null, x: p.x, y: p.y, w: p.w, h: p.h, colours: p.colours || [] }));
  }
  return { parts, frame: M.frameColours(), windows: g.windows };
}"""

# Row H2: the colours of the bare hub scene under each card (and the 1 px ring round it) at a step.
HUB_UNDER_JS = """async (step) => {
  const M = await import(new URL('hub/cards.js', document.baseURI).href);
  const PX = await import(new URL('shared/pixel.js', document.baseURI).href);
  const S = await import(new URL('shared/session.js', document.baseURI).href);
  const g = JSON.parse(document.getElementById('screen').dataset.grid);
  const L = JSON.parse(document.getElementById('screen').dataset.layout);
  const c = document.createElement('canvas');
  c.width = L.W; c.height = L.H;
  const x = c.getContext('2d', { alpha: false });
  PX.drawScene(x, L.W, L.H, { ...M.hubScene(g, g.safe), phase: step / S.SESSION.sceneSteps });
  const hex = (d, i) => '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const out = {};
  for (const id of Object.keys(g.cards)) {
    const r = g.cards[id];
    const d = x.getImageData(r.x - 1, r.y - 1, r.w + 2, r.h + 2).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4) set.add(hex(d, i));
    out[id] = [...set];
  }
  return out;
}"""

# Logical heights 240, 300 and 400 at 360 and 412 CSS px wide, device scale 3 and 2.625.
CONTRAST_HUB_VIEWS = [(360, 640, 3, "360 H240"), (360, 800, 3, "360 H300"), (360, 1067, 3, "360 H400"),
                      (412, 732, 2.625, "412 H240"), (412, 915, 2.625, "412 H300"), (412, 1220, 2.625, "412 H400")]


def overlaps(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def pieces_fit(page, tag):
    """Row H2, nothing cramped."""
    # Nothing cramped: no two pieces in a card overlap, except the parts of one thing (the boat; the hole and its flag)
    # and the windows' edges (every piece inside its window).
    group = lambda w_: "boat" if w_.startswith("boat") else "hole" if w_ in ("hole", "flag pole", "flag") else w_  # noqa: E731
    look = page.evaluate(HUB_PARTS_JS, 0)
    clash, outside = [], []
    for t in GAMES:
        win = look["windows"][t]
        ps = [q for q in look["parts"][t] if not q["bg"]]
        for i, a in enumerate(ps):
            if not (a["x"] >= win["x"] and a["y"] >= win["y"] and a["x"] + a["w"] <= win["x"] + win["w"] and a["y"] + a["h"] <= win["y"] + win["h"]):
                outside.append((t, a["what"]))
            for b in ps[i + 1:]:
                if group(a["what"]) != group(b["what"]) and overlaps(a, b):
                    clash.append((t, a["what"], b["what"]))
    check(not clash and not outside, f"[{tag}] in every card the pieces sit inside the window and none overlaps another (overlaps {clash[:4]}, outside {outside[:4]})")


def run_contrast_hub(browser, base, scheme="light"):
    """Rows B4 and H2: each card's frame against the scene, and every piece in a card against the window colours
    behind it, at sunset and all 10 steps; the colours drawn in each window at sunset, step 5 and dusk."""
    for w, h, dpr, vtag in CONTRAST_HUB_VIEWS:
        vtag = vtag if scheme == "light" else f"{scheme} {vtag}"
        tag = f"contrast hub {vtag}"
        ctx = new_context(browser, w, h, dpr, scheme)
        page = ctx.new_page()
        page.goto(base)
        lay = layout_of(page)
        tok = page.evaluate(HUB_TOKENS_JS)
        C, H, r = tok["C"], lay["H"], lay["rects"]

        rows, exempt, lonely = [], set(), []
        for k in range(11):
            # Row H2: what is behind each card is read from the hub's own scene (hub/cards.js hubScene through
            # shared/pixel.js drawScene) at this step: every colour under the card and in the 1 px ring round it.
            under = page.evaluate(HUB_UNDER_JS, k)
            for t in GAMES:
                for bg in under[t]:
                    rows.append((f"{t} card frame", MIN_CR, max(contrast(C["coral"], bg), contrast(tok["keel"], bg)), "scene", bg, k))
            look = page.evaluate(HUB_PARTS_JS, k)
            for t in GAMES:
                parts = look["parts"][t]
                backs = [q for q in parts if q["bg"] and q["measure"]]
                for q in parts:
                    if q["bg"]:
                        continue
                    if q["exempt"]:
                        exempt.add(f"{t}: {q['what']} ({q['exempt']})")
                        continue
                    behind = [b for b in backs if overlaps(q, b)]
                    if not behind:
                        lonely.append((t, q["what"], k))
                    m = contrast if q["rule"] == "cr" else delta_e
                    need = MIN_CR if q["rule"] == "cr" else MIN_DE
                    for b in behind:
                        v = max(m(q["fill"], b["colour"]), m(q["edge"], b["colour"]) if q["edge"] else 0)
                        rows.append((f"{t} card: {q['what']}", need, v, b["what"], b["colour"], k))
        pieces_fit(page, tag)
        under = [x for x in rows if x[2] < x[1]]
        worst = min(rows, key=lambda x: x[2] / x[1])
        check(rows and not under and not lonely,
              f"[{tag}] sunset and all 10 steps: card frames (fill or edge) on the scene and every piece in each card (fill or edge) "
              f"on the window colours behind it meet the B4 standard ({len(rows)} pairs; weakest {worst[0]} on {worst[3]} {worst[4]} "
              f"step {worst[5]}: {worst[2]:.2f}; {len(under)} under {under[:3]}; unmeasured {lonely[:3]})")
        if exempt:
            print(f"  [{tag}] left outside the standard, as in the game: {sorted(exempt)}")
        # The colours drawn in each window: only the window's own colours and its pieces', and every measured piece drawn.
        for k, active in ((0, 0), (5, 300), (10, 720)):
            page.evaluate(SET_CLOCK_JS, active)
            page.wait_for_timeout(150)
            shot = OUT / f"h2-hub-{vtag.replace(' ', '-')}-{k}.png"
            page.screenshot(path=str(shot))
            look = page.evaluate(HUB_PARTS_JS, k)
            for t in GAMES:
                win = look["windows"][t]
                pts = [(x, y) for y in range(win["y"], win["y"] + win["h"]) for x in range(win["x"], win["x"] + win["w"])]
                drawn = set(logical_pixels(page, shot, pts))
                parts = look["parts"][t]
                allowed = {tok["edgeCoral"]}  # the window's cut corners
                for q in parts:
                    allowed |= set([q["colour"]] if q["bg"] else q["colours"])
                missing = [q["what"] for q in parts if not q["bg"] and not q["exempt"] and q["fill"] not in drawn]
                check(drawn <= allowed and not missing,
                      f"[{tag} step {k}] the {t} card draws only its window's and its pieces' colours, and every piece shows "
                      f"(stray {sorted(drawn - allowed)[:4]}, not drawn {missing})")
        ctx.close()


def run_contrast_pages(browser, base, scheme="light"):
    """Row B4: the drawn colours of the hub and Bricks at sunset, step 5 and step 10 (games opened from the hub)."""
    for w, h, vtag in CONTRAST_VIEWS:
        vtag = vtag if scheme == "light" else f"{scheme}-{vtag}"
        ctx = new_context(browser, w, h, 3, scheme)
        page = ctx.new_page()
        page.goto(base)
        hits(page)
        tok = page.evaluate(HUB_TOKENS_JS)
        C = tok["C"]
        for k, active in ((0, 0), (5, 300), (10, 720)):
            tag = f"contrast {vtag} step {k}"
            page.goto(base)
            hits(page)
            page.evaluate(SET_CLOCK_JS, active)
            lay = layout_of(page)
            page.wait_for_timeout(150)
            shot = OUT / f"b4-hub-{vtag}-{k}.png"
            page.screenshot(path=str(shot))
            r = lay["rects"]
            got = []
            for t in GAMES:
                bt = r[t]
                got += logical_pixels(page, shot, [(bt["x"], bt["y"] + 20), (bt["x"] + 2, bt["y"] + 20), (bt["x"] + 3, bt["y"] + 20),
                                                   (bt["x"] + 3, bt["y"]), (bt["x"] + bt["w"] // 2, bt["y"] + bt["h"] - 1)])
            check(page.eval_on_selector("#screen", "c => c.dataset.scene") == str(k)
                  and got == [tok["keel"], C["coral"], tok["edgeCoral"], tok["keel"], tok["keel"]] * len(GAMES),
                  f"[{tag}] hub: every card's frame coral in its 1 px keel edge all round (the cards sit on the sea), "
                  f"the window inside its coral edge ({got[:5]})")
            # Bricks: paddle edge and fill; no pause marker at any step (X33).
            g_ = open_tile(page, "bricks")
            page.wait_for_timeout(150)
            q = snap(g_)
            g = q["game"]
            geo = g["geo"]
            shot = OUT / f"b4-bricks-{vtag}-{k}.png"
            page.screenshot(path=str(shot))
            px, py = round(g["paddleX"]), geo["paddleY"]
            got = logical_pixels(g_, shot, [(px + 15, py), (px + 15, py + 3)])
            check(q["step"] == k and q["mode"] == "paused" and got == [tok["edgeCoral"], C["coral"]],
                  f"[{tag}] Bricks: paddle coral in its edge ({got})")
            no_pause_marker(g_, shot, tag, "__bricks", "Bricks from the hub")
            back_to_hub(page)
        ctx.close()


def run_node_sim():
    """tests/bricks-sim.mjs: physics.js and the session clock in Node (10- and 15-minute runs and more)."""
    res = subprocess.run(["node", str(ROOT / "tests" / "bricks-sim.mjs")], capture_output=True, text=True)
    out = res.stdout.strip().splitlines()
    for line in out:
        if line.startswith("FAIL"):
            print("  sim " + line)
    summary = out[-1] if out else res.stderr.strip()
    check(res.returncode == 0, f"node tests/bricks-sim.mjs: {summary}")


STORAGE_JS = """async () => ({
  local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
  session: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])),
  idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
  cookie: document.cookie,
})"""


def run_pool_sim():
    """tests/pool-sim.mjs: games/pool/sim.js in Node (docs/V2.md §6)."""
    res = subprocess.run(["node", str(ROOT / "tests" / "pool-sim.mjs")], capture_output=True, text=True)
    out = res.stdout.strip().splitlines()
    for line in out:
        if line.startswith("FAIL"):
            print("  " + line)
    summary = out[-1] if out else res.stderr.strip()
    check(res.returncode == 0, f"node tests/pool-sim.mjs: {summary}")


POOL_PLAN_JS = """async () => {
  // The page's own sim.js: try 360 full-power shots on a copy of the table as it stands, keep the one that pots most.
  const S = await import(new URL('./sim.js', location.href).href);
  const q = window.__pool.snapshot();
  const cfg = q.config;
  const w = S.createWorld(S.makeTable(q.geo.W, q.geo.H, q.geo.safe, cfg), cfg);
  for (const b of q.balls) Object.assign(w.balls[b.id], b);
  let best = null;
  for (let k = 0; k < 360; k++) {
    const a = (k * Math.PI) / 180;
    const c = S.cloneWorld(w);
    S.shoot(c, Math.cos(a), Math.sin(a), cfg.launchSpeed);
    let pots = 0;
    let cue = false;
    for (let n = 0; n < 120 * 20 && S.anyMoving(c); n++) for (const e of S.step(c)) if (e.k === 'pot') { if (e.id === 0) cue = true; else pots++; }
    const score = pots * 10 - (cue ? 5 : 0);
    if (!best || score > best.score) best = { score, a, pots };
  }
  return best;
}"""

POOL_TOKENS_JS = """async () => {
  const T = await import(new URL('../../shared/tokens.js', location.href).href);
  const out = {};
  for (const set of [T.LIGHT, T.DARK]) {
    const C = set.COLORS;
    const balls = [0, 2, 4, 5, 6, 7, 8].map((i) => set.BRICK_ROWS[i]).concat([C.blue]).map((f) => ({ fill: f, edge: T.line(f, set) }));
    out[set.name] = { sand: C.sand, balls, cue: { fill: C.foam, edge: T.line(C.coral, set) }, ring: C.poolRing };
  }
  return out;
}"""


def pool_touch(cdp, page, pts):
    """A real touch through the points (client px): down on the first, moves, up on the last."""
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": pts[0][0], "y": pts[0][1]}]})
    for x, y in pts[1:]:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def run_hub_life(browser, base):
    """The hub moves (hub/life.js): frames differ over time, the card hit rects stay put, a game open pauses the loop, reduced motion is still, no errors."""
    ctx = new_context(browser, 360, 780, motion=True)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "index.html")
    page.wait_for_function("document.getElementById('screen').dataset.grid")
    h0 = hits(page)
    a = page.screenshot()
    page.wait_for_timeout(1500)
    b = page.screenshot()
    tm1 = float(page.eval_on_selector("#screen", "c => c.dataset.tm"))
    check(a != b and tm1 > 0.5, f"[life] the hub's frames differ over time (tm {tm1})")
    check(hits(page) == h0, "[life] the card hit areas do not move with the swell")
    page.touchscreen.tap(h0["pool"]["x"], h0["pool"]["y"])
    page.wait_for_selector("iframe.game.shown")
    t2 = float(page.eval_on_selector("#screen", "c => c.dataset.tm"))
    page.wait_for_timeout(600)
    t3 = float(page.eval_on_selector("#screen", "c => c.dataset.tm"))
    check(t3 == t2, f"[life] the loop pauses while a game is open ({t2} {t3})")
    page.emulate_media(reduced_motion="reduce")
    page.go_back()
    page.wait_for_timeout(300)
    page.wait_for_function("document.getElementById('screen').dataset.tm === '0.00'")
    check(True, "[life] reduced motion: the hub is the still picture (tm 0)")
    check(not errors, f"[life] no console errors {errors}")
    ctx.close()


def run_pool(browser, base):
    """Pool in the browser (docs/V2.md §6): opens from its card and closes on back; a real touch pull shoots; a full
    game played by the test ends in a new rack; storage stays empty; no text; light and dark screenshots; no console errors."""
    # Opens from its card, closes on back (hub).
    ctx = new_context(browser, 360, 800)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(base)
    hits(page)
    g = open_tile(page, "pool")
    check(page.evaluate("document.body.dataset.game") == "pool" and g.evaluate("window.__pool.snapshot().balls.length") == 11,
          "[pool] opens from its hub card: a fresh rack of ten and the cue ball")
    back_to_hub(page)
    check(page.url == base and page.evaluate("document.querySelectorAll('iframe').length") == 0, "[pool] the back gesture returns to the hub, Pool gone")
    ctx.close()
    # The game on its own, in light and dark.
    for scheme in ("light", "dark"):
        ctx = new_context(browser, 360, 800, scheme=scheme)
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(base + "games/pool/")
        page.wait_for_function(GAME_READY["pool"], timeout=20000)
        page.wait_for_timeout(300)
        tag = f"pool-{scheme}"
        page.screenshot(path=str(OUT / f"pool-{scheme}-360x800.png"))
        no_hud(page, tag, "Pool")
        snap = page.evaluate("window.__pool.snapshot()")
        check(snap["geo"]["W"] == 135 and not snap["moving"] and not snap["raf"], f"[{tag}] fresh and still on opening: no loop running")
        cdp = ctx.new_cdp_session(page)
        # a touch beginning within 24 CSS px of a side edge is ignored
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 10, "y": 400}]})
        edge_aim = page.evaluate("window.__pool.snapshot().aiming")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        check(edge_aim is False, f"[{tag}] a touch within 24 CSS px of the side edge is ignored")
        a = page.evaluate("window.__pool.toClient(67, 150)")
        # a short pull (4 px or less) is no shot
        pool_touch(cdp, page, [(a["x"], a["y"]), (a["x"], a["y"] + 8)])
        page.wait_for_timeout(150)
        check(not page.evaluate("window.__pool.snapshot().moving"), f"[{tag}] a pull of 4 px or less is released as no shot")
        # the aim guide and the pull ring while pulling
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": a["x"], "y": a["y"]}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": a["x"] + 20, "y": a["y"] + 90}]})
        page.wait_for_timeout(150)
        page.screenshot(path=str(OUT / f"pool-{scheme}-aim-360x800.png"))
        check(page.evaluate("window.__pool.snapshot().aiming"), f"[{tag}] a touch anywhere starts an aim")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_function("window.__pool.snapshot().moving", timeout=2000)
        vib = page.evaluate("window.__vib")
        check(10 in vib, f"[{tag}] a real touch pull shoots, with the 10 ms release tick {vib[:3]}")
        # a touch while any ball moves is ignored
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": a["x"], "y": a["y"]}]})
        moving_aim = page.evaluate("window.__pool.snapshot().aiming")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        check(moving_aim is False, f"[{tag}] a touch while a ball moves is ignored")
        page.wait_for_function("!window.__pool.snapshot().moving && window.__pool.snapshot().cueAt < 0", timeout=30000)
        if scheme == "light":
            # A full game: planned shots with the page's own sim.js, thrown with real touches, until a new rack appears.
            all_potted = False
            new_rack = False
            shots = 0
            for _ in range(60):
                q = page.evaluate("window.__pool.snapshot()")
                objs = [b for b in q["balls"] if b["id"] != 0]
                if all(b["potted"] for b in objs):
                    all_potted = True
                if all_potted and all(not b["potted"] for b in objs) and q["rackAt"] < 0:
                    new_rack = True
                    break
                if q["rackAt"] >= 0:
                    page.wait_for_function("window.__pool.snapshot().rackAt < 0", timeout=10000)
                    continue
                if q["moving"] or q["cueAt"] >= 0 or q["balls"][0]["potted"]:
                    page.wait_for_function("!window.__pool.snapshot().moving && window.__pool.snapshot().cueAt < 0", timeout=30000)
                    continue
                best = page.evaluate(POOL_PLAN_JS)
                import math as _m
                dx, dy = _m.cos(best["a"]), _m.sin(best["a"])
                ax, ay = 67, q["geo"]["H"] / 2
                p0 = page.evaluate(f"window.__pool.toClient({ax}, {ay})")
                p1 = page.evaluate(f"window.__pool.toClient({ax - dx * 40}, {ay - dy * 40})")
                pool_touch(cdp, page, [(p0["x"], p0["y"]), ((p0["x"] + p1["x"]) / 2, (p0["y"] + p1["y"]) / 2), (p1["x"], p1["y"])])
                shots += 1
                page.wait_for_function("window.__pool.snapshot().moving || window.__pool.snapshot().rackAt >= 0", timeout=3000)
                page.wait_for_function("!window.__pool.snapshot().moving && window.__pool.snapshot().cueAt < 0", timeout=30000)
            if not new_rack:
                q = page.evaluate("window.__pool.snapshot()")
                new_rack = all(not b["potted"] for b in q["balls"]) and all_potted
            check(all_potted and new_rack, f"[{tag}] a full game ends in a new rack with no message or tap ({shots} shots)")
            q = page.evaluate("window.__pool.snapshot()")
            check(all(not b["potted"] for b in q["balls"]) and not q["moving"], f"[{tag}] after the new rack all eleven balls are on the table, at rest")
        if scheme == "light":
            # the phone switches to dark with Pool open: the table turns dark within a frame
            page.emulate_media(color_scheme="dark")
            page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
            sw = OUT / "pool-switch-dark-360x800.png"
            page.screenshot(path=str(sw))
            band = logical_pixels(page, sw, [(67, 1)])
            page.emulate_media(color_scheme="light")
            page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
            sw1 = OUT / "pool-switch-light-360x800.png"
            page.screenshot(path=str(sw1))
            band1 = logical_pixels(page, sw1, [(67, 1)])
            tk = page.evaluate("async () => { const T = await import(new URL('../../shared/tokens.js', location.href).href); return [T.DARK.COLORS.sandWall, T.LIGHT.COLORS.sandWall]; }")
            check(band == [tk[0]] and band1 == [tk[1]], f"[{tag}] the phone switching to dark and back: the cushion turns {band} then {band1}, live")
        st = page.evaluate(STORAGE_JS)
        check(st["local"] == {} and st["session"] == {} and st["idb"] == [] and st["cookie"] == "", f"[{tag}] nothing is stored {st}")
        no_hud(page, tag, "Pool after play")
        page.screenshot(path=str(OUT / f"pool-{scheme}-after-360x800.png"))
        check(errs == [], f"[{tag}] no console errors {errs}")
        # Contrast: every ball's fill or edge reaches 3:1 on the sand, the cue ball's edge, the pocket ring.
        if scheme == "light":
            tok = page.evaluate(POOL_TOKENS_JS)
            for theme, t in tok.items():
                worst_ball = min(max(contrast(b["fill"], t["sand"]), contrast(b["edge"], t["sand"])) for b in t["balls"])
                check(worst_ball >= 3, f"[pool {theme}] every object ball's fill or edge reaches 3:1 on the sand (worst {worst_ball:.2f})")
                check(contrast(t["cue"]["edge"], t["sand"]) >= 3, f"[pool {theme}] the cue ball's edge reaches 3:1 on the sand ({contrast(t['cue']['edge'], t['sand']):.2f})")
                check(contrast(t["ring"], t["sand"]) >= 3, f"[pool {theme}] the pocket ring reaches 3:1 on the sand ({contrast(t['ring'], t['sand']):.2f})")
        ctx.close()


def run_haptics_native():
    """tests/haptics-native.mjs: shared/haptics.js with a fake native plugin (row P3)."""
    res = subprocess.run(["node", str(ROOT / "tests" / "haptics-native.mjs")], capture_output=True, text=True)
    out = res.stdout.strip().splitlines()
    for line in out:
        if line.startswith("FAIL"):
            print("  " + line)
    summary = out[-1] if out else res.stderr.strip()
    check(res.returncode == 0, f"node tests/haptics-native.mjs: {summary}")


def android_checks():
    """Row P3 (PLAN §6f), static: the Android project, the web copy, no secrets in git, the store docs."""
    import re
    from PIL import Image
    app = ROOT / "android-app"
    cfg = json.loads((app / "capacitor.config.json").read_text())
    check(cfg["appId"] == "io.github.apcanario.rlx" and cfg["appName"] == "rlx" and cfg["webDir"] == "www",
          f"capacitor.config.json: package io.github.apcanario.rlx, name rlx, webDir www ({cfg['appId']}, {cfg['appName']})")
    srv = cfg.get("server", {})
    check(srv.get("androidScheme") == "https" and srv.get("html5mode") is False and "url" not in srv and not srv.get("cleartext"),
          f"the app serves its bundled files over https://localhost, html5mode off, no live server URL, no cleartext {srv}")
    check(cfg.get("android", {}).get("allowMixedContent") is False and cfg.get("android", {}).get("webContentsDebuggingEnabled") is False,
          "no mixed content, no WebView debugging in the app")
    pkg = json.loads((app / "package.json").read_text())
    vers = {k: v for k, v in pkg["dependencies"].items() if k.startswith("@capacitor/")}
    check(set(vers) == {"@capacitor/core", "@capacitor/cli", "@capacitor/android"} and len(set(vers.values())) == 1
          and re.fullmatch(r"\d+\.\d+\.\d+", next(iter(vers.values()))) is not None,
          f"Capacitor packages pinned to one exact version {vers}")
    check((app / "package-lock.json").is_file(), "android-app/package-lock.json is kept (npm ci in CI)")
    var = (app / "android" / "variables.gradle").read_text()
    sdk = {k: int(v) for k, v in re.findall(r"(minSdkVersion|compileSdkVersion|targetSdkVersion) = (\d+)", var)}
    check(sdk == {"minSdkVersion": 24, "compileSdkVersion": 36, "targetSdkVersion": 36}, f"targetSdk 36, compileSdk 36, minSdk 24 {sdk}")
    gradle = (app / "android" / "app" / "build.gradle").read_text()
    check('applicationId "io.github.apcanario.rlx"' in gradle and 'namespace = "io.github.apcanario.rlx"' in gradle
          and "rootProject.ext.targetSdkVersion" in gradle, "app/build.gradle: application id and namespace io.github.apcanario.rlx")
    check(not re.search(r"storePassword\s+['\"]|keyPassword\s+['\"]", gradle) and 'System.getenv("RLX_KEYSTORE_PATH")' in gradle,
          "release signing reads the environment only; no password in build.gradle")
    check('versionCode(((System.getenv("RLX_VERSION_CODE") ?: "1") as Integer) + 101)' in gradle,
          "versionCode is the CI run number + 101 (v2)")
    man = (app / "android" / "app" / "src" / "main" / "AndroidManifest.xml").read_text()
    perms = re.findall(r"<uses-permission\s+android:name=\"([^\"]+)\"([^>]*)/>", man)
    kept = [n for n, rest in perms if 'tools:node="remove"' not in rest]
    removed = [n for n, rest in perms if 'tools:node="remove"' in rest]
    check(kept == ["android.permission.VIBRATE"] and "android.permission.INTERNET" in removed,
          f"the manifest asks for VIBRATE only and removes INTERNET (kept {kept}, removed {removed})")
    check('android:usesCleartextTraffic="false"' in man and "networkSecurityConfig" not in man, "no cleartext traffic")
    check('android:screenOrientation="portrait"' in man and man.count("<activity") == 1, "one activity, portrait")
    check('android:allowBackup="false"' in man and "<provider" not in man, "no backup, no FileProvider")
    styles = (app / "android" / "app" / "src" / "main" / "res" / "values" / "styles.xml").read_text()
    check("shortEdges" in styles and "rlx_blank" in styles and "@color/rlx_sky" in styles,
          "theme: content into the cutout (shortEdges), splash with no icon on the sky colour")
    colors = (app / "android" / "app" / "src" / "main" / "res" / "values" / "colors.xml").read_text()
    check("#FFF7EC" in colors, "the launch colour is sky-top #FFF7EC")
    # Row D1 (PLAN §6g): the app's theme follows the phone's night mode (DayNight, so the WebView reports it as
    # prefers-color-scheme), the launch, splash and window colour has a night value (the dark sky-top), the
    # WebView never darkens a page by itself, and a switch while open rebases the theme without recreating the
    # activity (uiMode handled, so a game keeps its state). Static only: the build and the phone are not run here.
    night = app / "android" / "app" / "src" / "main" / "res" / "values-night" / "colors.xml"
    dark_top = json.loads(subprocess.run(["node", "--input-type=module", "-e",
                                          "import * as T from './shared/tokens.js'; console.log(JSON.stringify(T.DARK.COLORS.skyTop))"],
                                         cwd=ROOT, capture_output=True, text=True).stdout)
    check(night.is_file() and f'<color name="rlx_sky">{dark_top}</color>' in night.read_text() and '<color name="rlx_sky">#FFF7EC</color>' in colors,
          f"rlx_sky: #FFF7EC by day, the dark sky-top {dark_top} at night (values-night)")
    check('<style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">' in styles
          and styles.count("@color/rlx_sky") >= 3 and "forceDark" not in styles,
          "the app theme is DayNight (follows the system night mode); window, launch window and splash use rlx_sky")
    check("uiMode" in man, "uiMode is handled by the activity: a night-mode switch does not recreate it (the game keeps its state)")
    main_src = (app / "android" / "app" / "src" / "main" / "java" / "io" / "github" / "apcanario" / "rlx" / "MainActivity.java").read_text()
    check("setAlgorithmicDarkeningAllowed(web.getSettings(), false)" in main_src and "WebViewFeature.ALGORITHMIC_DARKENING" in main_src
          and "public void onConfigurationChanged(Configuration newConfig)" in main_src and "getTheme().rebase()" in main_src
          and "setBackgroundColor(sky)" in main_src and 'androidx.webkit:webkit:$androidxWebkitVersion' in gradle,
          "MainActivity: no algorithmic darkening, the theme rebased on a night-mode switch, the window and WebView background follow")
    java = app / "android" / "app" / "src" / "main" / "java" / "io" / "github" / "apcanario" / "rlx"
    plug = (java / "RlxHapticsPlugin.java").read_text()
    main_ = (java / "MainActivity.java").read_text()
    check('@CapacitorPlugin(name = "RlxHaptics")' in plug and "VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)" in plug
          and "public void vibrate(PluginCall call)" in plug, "native plugin RlxHaptics.vibrate({ ms }): a one-shot at the default amplitude")
    check("registerPlugin(RlxHapticsPlugin.class)" in main_ and main_.index("registerPlugin") < main_.index("super.onCreate")
          and "canGoBack()" in main_ and "goBack()" in main_ and "BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE" in main_
          and "hide(WindowInsetsCompat.Type.systemBars())" in main_,
          "MainActivity: the plugin registered, back goes back in the WebView or leaves at the hub, immersive with transient bars")
    res = app / "android" / "app" / "src" / "main" / "res"
    adaptive = (res / "mipmap-anydpi-v26" / "ic_launcher.xml").read_text()
    pngs = sorted(p.relative_to(res).as_posix() for p in res.rglob("*.png"))
    check("ic_launcher_monochrome" in adaptive and all((res / d / "ic_launcher.png").is_file() for d in
          ("mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"))
          and not any("splash" in p or "drawable" in p for p in pngs),
          f"the approved launcher icons (legacy, round, adaptive with monochrome); none of the template's splash or icon images")
    # One source of truth: the app's web copy is exactly sw.js FILES (folders skipped), and sw.js is not in it.
    with tempfile.TemporaryDirectory() as tmp:
        res_ = subprocess.run(["node", str(ROOT / "tools" / "build-www.mjs"), tmp], capture_output=True, text=True)
        copied = {p.relative_to(tmp).as_posix() for p in pathlib.Path(tmp).rglob("*") if p.is_file()}
        same = all((pathlib.Path(tmp) / f).read_bytes() == (ROOT / f).read_bytes() for f in copied)
    sw = (ROOT / "sw.js").read_text()
    listed = set(re.findall(r"'\./([^']*)'", sw[sw.index("const FILES"):sw.index("];")]))
    files = {f for f in listed if f and not f.endswith("/")}
    check(res_.returncode == 0 and copied == files and same and "sw.js" not in copied and "privacy-policy.html" not in copied,
          f"tools/build-www.mjs copies exactly sw.js FILES, byte for byte, without sw.js ({len(copied)} files)")
    www = app / "www"
    if www.is_dir():
        have = {p.relative_to(www).as_posix() for p in www.rglob("*") if p.is_file()}
        check(have == files, "android-app/www (if built) holds exactly sw.js FILES")
    # Nothing secret in git.
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    keyish = [f for f in tracked if re.search(r"\.(jks|keystore|p12|pem|pk8)$|key\.properties$|google-services\.json$|\.b64$", f)]
    check(not keyish, f"no keystore, key or secret file in git {keyish}")
    leaks = [f for f in tracked if f.endswith((".gradle", ".json", ".yml", ".java", ".xml", ".properties", ".js", ".mjs", ".md"))
             and re.search(r"BEGIN (RSA |EC )?PRIVATE KEY|storePassword\s*=\s*['\"]", (ROOT / f).read_text(errors="ignore"))]
    check(not leaks, f"no private key or password in a tracked file {leaks}")
    gi = (ROOT / ".gitignore").read_text()
    check("*.jks" in gi and "*.keystore" in gi and "android-app/www/" in gi and "android-app/node_modules/" in gi,
          ".gitignore refuses keystores, the web copy and node_modules")
    wf = (ROOT / ".github" / "workflows" / "android.yml").read_text()
    check(all(k in wf for k in ("RLX_KEYSTORE_B64", "RLX_KEYSTORE_PASSWORD", "RLX_KEY_ALIAS", "RLX_KEY_PASSWORD", "assembleDebug", "bundleRelease"))
          and "java-version: 21" in wf, "the workflow builds the debug APK and, with the four secrets, the release bundle (JDK 21)")
    # Row X36: every action pinned by its full commit SHA (the tag in a comment), the Gradle wrapper validated
    # before the first Gradle run, the manual smoke run on API 35 (back key) and API 36 (back gesture).
    uses = re.findall(r"^\s*(?:-\s+)?uses:\s*(.+?)\s*$", wf, re.M)
    unpinned = [u for u in uses if not u.startswith("./") and not re.fullmatch(r"[\w.-]+/[\w.-]+(?:/[\w./-]+)?@[0-9a-f]{40} # v\d+(?:\.\d+)*", u)]
    check(uses and not unpinned, f"every action in android.yml is pinned by a full commit SHA with its tag ({len(uses)} uses) {unpinned}")
    wv = wf.find("gradle/actions/wrapper-validation@")
    check(0 < wv < wf.find("./gradlew") and wv < wf.find("\n  smoke:"), "the Gradle wrapper is validated (gradle/actions/wrapper-validation) before the first Gradle run")
    smoke_sh = (ROOT / "tools" / "android-smoke.sh").read_text()
    try:
        import yaml
    except ImportError:
        yaml = None
        print("INFO PyYAML not installed: android.yml not parsed (the text checks above still ran)")
    if yaml:
        doc = yaml.safe_load(wf)
        mx = doc["jobs"]["smoke"]["strategy"]["matrix"]["include"]
        steps = doc["jobs"]["smoke"]["steps"]
        run = [s for s in steps if "android-emulator-runner" in s.get("uses", "")]
        check(set(doc["jobs"]) == {"build", "smoke"} and {(m["api-level"], m["back"]) for m in mx} == {(35, "key"), (36, "gesture")}
              and len(run) == 1 and run[0]["with"]["api-level"] == "${{ matrix.api-level }}" and run[0]["with"]["script"].endswith("${{ matrix.back }}"),
              f"android.yml parses; the smoke job runs API 35 with the back key and API 36 with the back gesture {mx}")
    check('BACK=${3:-key}' in smoke_sh and "navbar.gestural" in smoke_sh and "input swipe 2 " in smoke_sh
          and smoke_sh.count("\nback\n") == 3 and "KEYCODE_BACK; fi" in smoke_sh,
          "tools/android-smoke.sh takes the back mode: the key, or gesture navigation and an edge swipe, for all three backs")
    # Store docs.
    play = ROOT / "docs" / "play"
    listing = (play / "listing.md").read_text()
    short = re.search(r"## Short description[^\n]*\n\n    (.+)\n", listing).group(1)
    check(len(short) <= 80, f"short description {len(short)} characters (at most 80): {short!r}")
    check((ROOT / "privacy-policy.html").read_bytes() == (play / "privacy-policy.html").read_bytes(),
          "privacy-policy.html (served by Pages) and docs/play/privacy-policy.html are the same")
    pp = (ROOT / "privacy-policy.html").read_text()
    check("<script" not in pp and "http" not in pp.replace("http-equiv", ""), "the privacy policy page loads nothing and has no script")
    icon = Image.open(play / "ic-play-512.png")
    fg = Image.open(play / "feature-graphic-1024x500.jpg")
    check(icon.size == (512, 512) and icon.mode in ("RGBA", "RGB") and fg.size == (1024, 500) and fg.format == "JPEG",
          f"Play icon 512x512 PNG ({icon.mode}), feature graphic 1024x500 JPEG")
    shots = sorted((play / "screenshots").glob("*.png"))
    # Play: 2 to 8 phone screenshots, the long side at most twice the short side; ours are 9:16.
    ok = [p.name for p in shots if Image.open(p).size == (1080, 1920) and Image.open(p).mode == "RGB"
          and max(Image.open(p).size) <= 2 * min(Image.open(p).size)]
    check(2 <= len(shots) <= 8 and len(ok) == len(shots), f"2 to 8 phone screenshots, 1080x1920 (9:16) RGB PNG, no alpha {ok}")


THEME_STATE_JS = {
    "bricks": "(() => { const g = window.__bricks.snapshot().game; return JSON.stringify({ rows: g.rows, ball: g.ball, paddleX: g.paddleX, speed: g.speed, pace: g.pace }); })()",
}

THEME_TOKENS_JS = """async () => {
  const T = await import(new URL('shared/tokens.js', document.baseURI).href);
  const pal = (s) => T.scenePalette(0, s);
  return { light: { sky: pal(T.LIGHT).sky[0], sea: pal(T.LIGHT).sea[0], sand: T.puttGround('sand', 0, T.LIGHT).ground },
           dark: { sky: pal(T.DARK).sky[0], sea: pal(T.DARK).sea[0], sand: T.puttGround('sand', 0, T.DARK).ground },
           active: T.tokens().name, lightTop: T.LIGHT.COLORS.skyTop, darkTop: T.DARK.COLORS.skyTop };
}"""

PAGE_CHROME_JS = """() => {
  const metas = [...document.querySelectorAll('meta[name=theme-color]')].map((m) => ({ media: m.media, content: m.content, on: !m.media || matchMedia(m.media).matches }));
  const bg = getComputedStyle(document.body).backgroundColor;
  return { metas, bg, scheme: document.querySelector('meta[name=color-scheme]').content,
           stored: localStorage.length + sessionStorage.length, cookie: document.cookie };
}"""


def rgb_css(hex_):
    return "rgb(%d, %d, %d)" % tuple(int(hex_[i:i + 2], 16) for i in (1, 3, 5))


def corner(page, shot_name):
    """The colour of the screen's top-left device pixel area (logical pixel 0, 0): the sky (Putt: the sea)."""
    from PIL import Image
    shot = OUT / shot_name
    page.screenshot(path=str(shot))
    return "#%02X%02X%02X" % Image.open(shot).convert("RGB").getpixel((2, 2))


def game_corner(page, g_, name, shot_name):
    """corner() for a game; for Putt (row U2: no sea round the course, pieces may sit in a corner) the sand
    ground in the bottom row under the tee, which the 12 px clearance round the tee keeps bare."""
    if name == "glide":  # row A1: the top is the sea strip; the sand by the left wall, low on the table, bare of pieces and decor
        shot = OUT / shot_name
        page.screenshot(path=str(shot))
        q = g_.evaluate("window.__glide.snapshot()")
        return logical_pixels(g_, shot, [(5, q["geo"]["yB"] - 12)])[0]
    if name != "putt":
        return corner(page, shot_name)
    shot = OUT / shot_name
    page.screenshot(path=str(shot))
    q = g_.evaluate("window.__putt.snapshot()")
    return logical_pixels(g_, shot, [(int(q["level"]["tee"]["x"]), q["geo"]["H"] - 1)])[0]


def run_theme(browser, base):
    """Row D1: dark mode on the phone opens the hub and every game dark; light as before; a switch while a game
    is open shows within a frame and moves nothing; the page chrome follows; nothing is stored."""
    for scheme in ("light", "dark"):
        tag = f"theme {scheme} 360x800"
        ctx = new_context(browser, 360, 800, DPR, scheme)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base)
        hits(page)
        tok = page.evaluate(THEME_TOKENS_JS)
        want = tok[scheme]
        chrome = page.evaluate(PAGE_CHROME_JS)
        on = [m["content"] for m in chrome["metas"] if m["on"]]
        top = tok["lightTop"] if scheme == "light" else tok["darkTop"]
        check(tok["active"] == scheme and corner(page, f"d1-hub-{scheme}.png") == want["sky"],
              f"[{tag}] the hub opens {scheme}: the active token set and its sky ({tok['active']})")
        check(on == [top] and chrome["bg"] == rgb_css(top) and chrome["scheme"] == "light dark",
              f"[{tag}] page chrome: the theme-color that applies is sky-top {top}, the page background too ({on}, {chrome['bg']})")
        for name in THEME_GAMES:
            g_ = open_tile(page, name)
            g_.wait_for_timeout(200)
            got = game_corner(page, g_, name, f"d1-{name}-{scheme}.png")
            exp = want["sand"] if name in ("putt", "glide") else want["sky"]
            gc = g_.evaluate(PAGE_CHROME_JS)
            check(got == exp and gc["bg"] == rgb_css(top), f"[{tag}] {name} opened from its card is {scheme} ({got}, want {exp}; background {gc['bg']})")
            check(gc["stored"] == 0 and gc["cookie"] == "", f"[{tag}] {name}: nothing stored ({gc['stored']} keys, cookie {gc['cookie']!r})")
            back_to_hub(page)
        chrome = page.evaluate(PAGE_CHROME_JS)
        check(chrome["stored"] == 0 and chrome["cookie"] == "" and not errors, f"[{tag}] hub: nothing stored, no page errors {errors}")
        ctx.close()

    # A live switch, from light to dark and back, with each game open: the look changes within a frame, the state does not.
    ctx = new_context(browser, 360, 800, DPR, "light")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base)
    hits(page)
    tok = page.evaluate(THEME_TOKENS_JS)
    page.emulate_media(color_scheme="dark")
    page.wait_for_timeout(100)
    check(corner(page, "d1-hub-switch-dark.png") == tok["dark"]["sky"], "[theme switch] the hub turns dark while open")
    page.emulate_media(color_scheme="light")
    page.wait_for_timeout(100)
    check(corner(page, "d1-hub-switch-light.png") == tok["light"]["sky"], "[theme switch] and light again")
    for name in THEME_GAMES:
        tag = f"theme switch {name}"
        g_ = open_tile(page, name)
        g_.wait_for_timeout(200)
        before = g_.evaluate(THEME_STATE_JS[name])
        shot0 = OUT / f"d1-switch-{name}-0.png"
        page.screenshot(path=str(shot0))
        page.emulate_media(color_scheme="dark")
        # Two animation frames after the switch: the page has drawn the dark look.
        g_.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
        dark = game_corner(page, g_, name, f"d1-switch-{name}-dark.png")
        mid = g_.evaluate(THEME_STATE_JS[name])
        if name in ("bricks", "catch", "glide"):  # a fresh, paused opening draws the same in both runs: no colour left over from light
            from PIL import Image, ImageChops
            diff = ImageChops.difference(Image.open(OUT / f"d1-switch-{name}-dark.png").convert("RGB"),
                                         Image.open(OUT / f"d1-{name}-dark.png").convert("RGB")).getbbox()
            check(diff is None, f"[{tag}] switched to dark, the frame equals the same opening made in dark, pixel for pixel ({diff})")
        exp = tok["dark"]["sand" if name in ("putt", "glide") else "sky"]
        check(dark == exp, f"[{tag}] switched to dark with the game open: dark within two frames ({dark}, want {exp})")
        check(mid == before, f"[{tag}] the switch moves nothing in the game (state kept)")
        page.emulate_media(color_scheme="light")
        g_.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
        light = game_corner(page, g_, name, f"d1-switch-{name}-light.png")
        after = g_.evaluate(THEME_STATE_JS[name])
        check(light == tok["light"]["sand" if name in ("putt", "glide") else "sky"] and after == before,
              f"[{tag}] and back to light: light again ({light}), state kept")
        if name != "stack":  # Stack's block slides on; the paused games draw the very frame they drew before
            from PIL import Image, ImageChops
            shot1 = OUT / f"d1-switch-{name}-1.png"
            page.screenshot(path=str(shot1))
            diff = ImageChops.difference(Image.open(shot0).convert("RGB"), Image.open(shot1).convert("RGB")).getbbox()
            check(diff is None, f"[{tag}] light, dark and light again: the frame is the one drawn before the switch, pixel for pixel ({diff})")
        back_to_hub(page)
    chrome = page.evaluate(PAGE_CHROME_JS)
    check(chrome["stored"] == 0 and chrome["cookie"] == "" and not errors, f"[theme switch] nothing stored, no page errors {errors}")
    ctx.close()


# Row D1 review: the whole game state for the mid-play switch, less what time alone moves while the game runs on
# (Stack's block slides on with no finger down: its x and direction; nothing else changes without a tap).
THEME_FULL_JS = {
    "bricks": "JSON.stringify(window.__bricks.snapshot().game)",
}


def theme_play(page, touch, name):
    """Play a game opened from the hub until it is mid-game, then bring it to rest (Bricks and Catch: the finger
    lifted, paused; Putt: the ball stopped after a shot; Stack: floors dropped, the camera settled). Returns a
    description of where play got to, or None if it did not get there."""
    if name == "bricks":
        n0 = snap(page)["count"]
        x, y, scale, k = sea_point(page)
        width = page.viewport_size["width"]
        sens = snap(page)["sensitivity"]
        cur = x
        page.mouse.move(cur, y)
        page.mouse.down()
        end = time.time() + 25
        while time.time() < end:
            q = snap(page)
            g = q["game"]
            if q["count"] <= n0 - 3 and g["ball"] and (g["ball"]["vx"] or g["ball"]["vy"]):
                break
            if g["ball"]:
                d = g["ball"]["x"] + 2.5 - (g["paddleX"] + 15)
                nxt = max(30, min(width - 30, cur + max(-12, min(12, d / sens * scale * k))))
                if abs(nxt - cur) > 0.01:
                    page.mouse.move(nxt, y)
                    cur = nxt
            page.wait_for_timeout(15)
        page.mouse.up()
        page.wait_for_function("window.__bricks.snapshot().mode === 'paused' && !window.__bricks.snapshot().raf", timeout=5000)
        q = snap(page)
        g = q["game"]
        ok = q["count"] <= n0 - 3 and g["ball"] and (g["ball"]["vx"] or g["ball"]["vy"])
        return f"{n0 - q['count']} bricks popped, the ball in flight at ({g['ball']['x']:.1f}, {g['ball']['y']:.1f}), paused" if ok else None
    if name == "catch":
        x, y, scale, k = sea_point(page)
        for _ in range(5):
            catch_track(page, touch, 1500, x, y, scale * k, until=lambda g: sum(not o["low"] for o in g["items"]) >= 2, max_ms=15000)
            page.wait_for_function("window.__catch.snapshot().mode === 'paused' && !window.__catch.snapshot().raf", timeout=5000)
            g = csnap(page)["game"]
            air = [o for o in g["items"] if not o["low"]]
            if air:
                return f"{len(air)} things in the air (y {[round(o['y'], 1) for o in air]}), paused"
        return None
    if name == "putt":
        s0 = psnap(page)
        putt_stroke(page, touch, 180, 420, 180, 470)
        page.wait_for_timeout(40)
        s = putt_until_rest(page)
        b, b0 = s["ball"], s0["ball"]
        ok = s["levelNo"] == s0["levelNo"] and not b["moving"] and not b["sunk"] and (b["x"], b["y"]) != (b0["x"], b0["y"]) and not s["aiming"]
        return f"one shot, the ball at rest at ({b['x']:.1f}, {b['y']:.1f}) from ({b0['x']:.1f}, {b0['y']:.1f})" if ok else None
    if name == "glide":
        q0 = gsnap(page)
        touch.down(180, 600)
        time.sleep(0.35)
        for i in range(30):  # the thumb wanders: the ring goes up and down the player's half
            touch.move(180 + 40 * math.sin(i / 3), 600 - 30 * math.sin(i / 5))
            time.sleep(0.05)
        touch.up()
        page.wait_for_function("window.__glide.snapshot().mode === 'paused' && !window.__glide.snapshot().raf", timeout=5000)
        q = gsnap(page)
        g = q["game"]
        moved = (g["puck"]["x"], g["puck"]["y"]) != (q0["game"]["puck"]["x"], q0["game"]["puck"]["y"])
        ok = moved and g["phase"] in ("play", "goal")
        return f"the shell in play at ({g['puck']['x']:.1f}, {g['puck']['y']:.1f}), paused" if ok else None
    if name == "stack":
        for _ in range(3):
            stack_tap_at(page, touch, 0)
        deadline = time.time() + 10
        while time.time() < deadline:
            q = ssnap(page)
            a = page.evaluate(THEME_FULL_JS["stack"])
            page.wait_for_timeout(120)
            if q["game"]["block"]["mode"] == "slide" and q["bits"] == 0 and page.evaluate(THEME_FULL_JS["stack"]) == a:
                break
        q = ssnap(page)
        ok = q["top"] >= 3 and q["game"]["block"]["mode"] == "slide" and q["raf"]
        return f"{q['top']} floors dropped, the block sliding on" if ok else None
    return None


def run_theme_play(browser, base):
    """Row D1 review: a live switch, light to dark, in the middle of play in each game (Bricks with the ball
    launched and bricks popped, Catch with things in the air, Putt after a shot, Stack with floors dropped).
    The look turns dark within two frames; the game state is unchanged (the paused games' whole state, and
    Stack's apart from its sliding block's x and direction, which time moves while it runs on)."""
    ctx = new_context(browser, 360, 800, DPR, "light")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base)
    hits(page)
    tok = page.evaluate(THEME_TOKENS_JS)
    touch = Touch(ctx, page)
    for name in THEME_GAMES:
        tag = f"theme mid-play {name}"
        page.emulate_media(color_scheme="light")
        page.evaluate(SET_CLOCK_JS, 0)  # each game played from sunset, so the sky compared is step 0's
        g_ = open_tile(page, name)
        g_.wait_for_timeout(200)
        where = theme_play(g_, touch, name)
        check(where is not None, f"[{tag}] played to mid-game in light: {where}")
        before = (g_.evaluate(THEME_STATE_JS[name]), g_.evaluate(THEME_FULL_JS[name]))
        g_.wait_for_timeout(300)
        still = (g_.evaluate(THEME_STATE_JS[name]), g_.evaluate(THEME_FULL_JS[name]))
        check(still == before, f"[{tag}] at rest before the switch: the state holds over 300 ms (so the comparison is exact)")
        light = game_corner(page, g_, name, f"d1-play-{name}-light.png")
        page.emulate_media(color_scheme="dark")
        g_.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
        dark = game_corner(page, g_, name, f"d1-play-{name}-dark.png")
        g_.wait_for_timeout(200)
        mid = (g_.evaluate(THEME_STATE_JS[name]), g_.evaluate(THEME_FULL_JS[name]))
        exp = "sand" if name in ("putt", "glide") else "sky"
        check(light == tok["light"][exp] and dark == tok["dark"][exp],
              f"[{tag}] switched light to dark mid-game: dark within two frames ({light} -> {dark}, want {tok['dark'][exp]})")
        check(mid[0] == before[0], f"[{tag}] the switch moves nothing: the fields run_theme compares are unchanged")
        check(mid[1] == before[1], f"[{tag}] and the whole game state is unchanged" + (" (but the sliding block's x and direction)" if name == "stack" else ""))
        back_to_hub(page)
    page.emulate_media(color_scheme="light")
    check(not errors, f"[theme mid-play] no page errors {errors}")
    ctx.close()


ACTIVATION_PROBE = """
if (location.pathname.includes('/games/')) {
  setTimeout(() => {
    window.__act = { active: navigator.userActivation.hasBeenActive, vib: typeof navigator.vibrate === 'function' ? navigator.vibrate(1) : null };
  }, 700);
}
"""


def run_activation(browser, base):
    """Row X1: a game opened by a tap on its hub tile runs in a frame made on that touch, so the tap also
    counts as the game page's own (Chrome lets a page vibrate only after one). Real navigator.vibrate, real
    touch over CDP; the game page records its own state from a timer (no test gesture involved)."""
    tag = "activation 360x800"
    ctx = browser.new_context(viewport={"width": 360, "height": 800}, device_scale_factor=DPR, is_mobile=True, has_touch=True)
    ctx.add_init_script(ACTIVATION_PROBE)
    page = ctx.new_page()
    logs = []
    page.on("console", lambda m: logs.append(m.text))
    page.goto(base)
    hits(page)
    touch = Touch(ctx, page)
    for game in GAMES:
        p = hits(page)[game]
        touch.tap(p["x"], p["y"], 40)
        # No script runs in the hub or the game until the game has recorded its state: a test's evaluate
        # counts as a user gesture in Chromium and would grant the activation being tested.
        page.wait_for_timeout(1500)
        fr = game_frame(page, game)
        act = fr.evaluate("window.__act || null") if fr else None
        check(act == {"active": True, "vib": True},
              f"[{tag}] {game} opened by a tap on its tile can vibrate before any touch of its own {act}")
        back_to_hub(page)
    blocked = [m for m in logs if "Blocked call to navigator.vibrate" in m]
    check(not blocked, f"[{tag}] Chrome blocked no vibrate call {blocked}")
    # For the record (X6): a game page loaded on its own, with no tap, cannot vibrate until its first tap.
    page.goto(base + "games/bricks/")
    page.wait_for_timeout(1500)
    act = page.evaluate("window.__act || null") or {}
    check(act.get("active") is False and act.get("vib") is False, f"[{tag}] (X6, for the record) Bricks loaded on its own, no tap: no activation, vibrate refused {act}")
    ctx.close()


def run_version_bump(browser):
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="rlx-bump-"))
    site = tmp / "site"
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns(".git", "out"))
    httpd, base = serve(site)
    ctx = new_context(browser, 360, 800)
    page = ctx.new_page()
    page.goto(base)
    hits(page)
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    before = page.evaluate("caches.keys()")
    sw = site / "sw.js"
    nxt = "rlx-v%d" % (int(SW_VERSION.split("-v")[1]) + 1)
    sw.write_text(sw.read_text().replace(f"const VERSION = '{SW_VERSION}';", f"const VERSION = '{nxt}';"))
    # Change a shipped file so we can see the new deploy arrive.
    hub = site / "index.html"
    hub.write_text(hub.read_text().replace("<title>rlx</title>", "<title>rlx new</title>"))
    page.reload()  # navigation triggers the update check
    deadline = time.time() + 10
    after = before
    while time.time() < deadline:
        try:
            after = page.evaluate("caches.keys()")
        except Exception:
            after = before  # the page is reloading itself as the new worker takes over
        if after == [nxt]:
            break
        page.wait_for_timeout(200)
    check(before == [SW_VERSION] and after == [nxt], f"version bump replaces the cache {before} -> {after}")
    # The page reloads itself once when the new worker takes over: no second launch is needed.
    title = ""
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            title = page.title()
        except Exception:
            title = ""
        if title == "rlx new":
            break
        page.wait_for_timeout(200)
    check(title == "rlx new", f"after the bump the open page loads the new deploy by itself ({title})")
    page.reload()
    page.wait_for_timeout(300)
    check(page.title() == "rlx new", f"and the next load serves it too ({page.title()})")
    ctx.close()
    httpd.shutdown()


def view_of(page):
    """The logical screen of a page: scale, H and the device-pixel offsets, from the hub's layout or a game's hook."""
    return page.evaluate("""() => {
      const c = document.getElementById('screen');
      const off = (scale, H) => ({ scale, H, ox: Math.floor((c.width - 135 * scale) / 2), oy: Math.floor((c.height - H * scale) / 2) });
      if (c.dataset.layout) { const l = JSON.parse(c.dataset.layout); return off(l.scale, l.H); }
      if (window.__bricks) return window.__bricks.snapshot().view;
      if (window.__pool) { const g = window.__pool.snapshot().geo; return off(g.scale, g.H); }
      return null;
    }""")


GAMES = ("bricks", "pool")
THEME_GAMES = ("bricks",)  # the dark/light switch and play checks of row D1 are Bricks'; Pool's are in run_pool


GAME_READY = {
    "bricks": "window.__bricks && window.__bricks.snapshot().game",
    "pool": "window.__pool && window.__pool.snapshot().table",
}


class Hosted:
    """A game opened from the hub: it runs in a frame over the hub's page (row X1). Script calls go to
    the game's frame; input, screenshots, media and history go to the page (the frame fills the screen)."""
    FRAME = {"evaluate", "wait_for_function", "eval_on_selector", "query_selector", "query_selector_all", "content"}

    def __init__(self, page, frame):
        self.page, self.frame = page, frame

    def __getattr__(self, name):
        return getattr(self.frame if name in self.FRAME else self.page, name)


def game_frame(page, name):
    for f in page.frames:
        if f.url.split("?")[0].endswith((f"/games/{name}/", f"/games/{name}/index.html")):
            return f
    return None


def open_tile(page, name, timeout=20000):
    """Tap a hub card, wait for the game's frame to show and the game to be ready. Returns a Hosted."""
    tap(page, name)
    page.wait_for_function(f"document.body.dataset.game === '{name}'", timeout=timeout)
    deadline = time.time() + timeout / 1000
    fr = game_frame(page, name)
    while fr is None and time.time() < deadline:
        page.wait_for_timeout(20)
        fr = game_frame(page, name)
    fr.wait_for_function(GAME_READY[name], timeout=timeout)
    return Hosted(page, fr)


def back_to_hub(page):
    """The Android back gesture: one step back in history. The game's frame goes; the hub shows."""
    page.go_back()
    page.wait_for_function("!document.body.dataset.game && !document.querySelector('iframe')")
    hits(page)


def set_hidden(target, hidden):
    """Fake the page being hidden or shown (in a page or a game's frame) and fire visibilitychange."""
    if hidden:
        target.evaluate("""() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        }""")
    else:
        target.evaluate("() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }")


# The DOM of a game screen: nothing but the canvas, the safe-area probe and scripts; no visible text.
SCREEN_DOM_JS = """() => {
  const els = [...document.body.querySelectorAll('*')].filter((e) => e.tagName !== 'SCRIPT');
  const odd = els.filter((e) => !(e.tagName === 'CANVAS' && e.id === 'screen') && !e.classList.contains('safe-probe'));
  const c = document.getElementById('screen');
  return { odd: odd.map((e) => e.tagName + '.' + e.className), text: document.body.innerText.trim(),
           buttons: document.querySelectorAll('button, a, input, select, [role=button]').length,
           hud: c.dataset.hud || null, hits: c.dataset.hits || null, layout: c.dataset.layout || null, drawnText: window.__text || 0 };
}"""


def no_hud(page, tag, what):
    d = page.evaluate(SCREEN_DOM_JS)
    check(d == {"odd": [], "text": "", "buttons": 0, "hud": None, "hits": None, "layout": None, "drawnText": 0},
          f"[{tag}] {what}: no text, number or button drawn or in the DOM, no HUD or hit areas {d}")


STALE_KEYS_JS = """() => {
  const old = { 'rlx.v1.settings': '{"haptics":false}', 'rlx.v2.bricks': '{}', 'rlx.v1.bricks-score': '12', 'rlx.v1.catch': '{}',
    'rlx.v1.catch-count': '{"caught":3,"eaten":1}', 'rlx.v1.session': '{"active":300,"last":0}', 'rlx.v1.bricks': '{}' };
  for (const [k, v] of Object.entries(old)) localStorage.setItem(k, v);
  sessionStorage.setItem('rlx.v1.session', '{}');
  localStorage.setItem('other-app', 'kept');
}"""


SET_CLOCK_JS = """a => { const c = window.__rlxSession; c.active = a; c.hiddenAt = null;
  dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })); }"""


def main():
    global MAX_AGE
    if "--max-age" in sys.argv:
        MAX_AGE = int(sys.argv[sys.argv.index("--max-age") + 1])
        print(f"serving with Cache-Control: max-age={MAX_AGE}")
    OUT.mkdir(parents=True, exist_ok=True)
    # --only a,b runs just the named parts (for a quick look while working; the full run is the check).
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    want = lambda name: only is None or name in only
    for name, fn in (("static", static_checks), ("android", android_checks), ("bricks-sim", run_node_sim), ("pool-sim", run_pool_sim),
                     ("haptics-native", run_haptics_native)):
        if want(name):
            fn()
    httpd, base = serve(ROOT)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        if want("viewport"):
            for w, h, dpr in FULL:
                run_viewport(browser, base, w, h)
        if want("layout"):
            for w, h, dpr in LAYOUT_ONLY:
                run_layout_only(browser, base, w, h, dpr)
        for name, fn in (("resize", run_resize), ("hub-grid", run_hub_grid), ("bricks", run_bricks), ("scene", run_scene), ("scene-dark", run_scene_dark),
                         ("pool", run_pool), ("hub-life", run_hub_life), ("contrast-hub", run_contrast_hub), ("contrast-pages", run_contrast_pages),
                         ("theme", run_theme), ("theme-play", run_theme_play), ("contrast-hub-dark", lambda b, u: run_contrast_hub(b, u, "dark")),
                         ("contrast-pages-dark", lambda b, u: run_contrast_pages(b, u, "dark")),
                         ("activation", run_activation)):
            if want(name):
                fn(browser, base)
        if want("version-bump"):
            run_version_bump(browser)
        browser.close()
    httpd.shutdown()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
