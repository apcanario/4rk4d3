#!/usr/bin/env python3
"""RLX checks (rows H1, H2, B1, B2, C1, B4, U1, U2, S1 and X1) in headless Chromium and Node. Not needed to run the app.

Needs Python Playwright with Chromium (pip install playwright;
python -m playwright install chromium). Run: python3 tests/check.py
Serves the repo under /4rk4d3/ (the GitHub Pages project subpath), then checks
both phone widths: pixels crisp, no scroll, the hub's four cards and nothing else
(row H2: a 2x2 grid of equal cards, no text drawn), each game opened over the
hub by its card and closed by the back gesture
(history back), old rlx.* keys cleared at start, the manifest fullscreen, the
service worker offline, cache version bump, no console errors, no requests to
another host. Row X1 throughout: no text, number or button on any game screen,
storage empty after play in every game, touches that begin within 24 CSS px
of a side edge ignored in every game, a fresh game on every opening, haptics
always on, one session clock in memory shared by the hub and every game it
opens (reset when the app starts and after 5 minutes hidden), Catch's drag on
the shared thumb travel, and a game opened by its card allowed to vibrate at
once (real vibrate, real touch). Rows B1 and B2: tests/bricks-sim.mjs (physics
in Node) and Bricks in the browser: pause and resume, relative drag, haptics,
reduced motion, no loop while paused, the clock, the hub drawing the scene
phase, Bricks at full dusk. Row C1: tests/catch-sim.mjs and Catch with real
touch events (CDP): taps and fish, the pause grace, haptics, dusk. Row B4: the
contrast standard on the hub (card frames, and the pieces in each card) at sunset and all 10 steps on
logical heights 240, 300 and 400 (360 and 412 CSS px wide), and the drawn colours of the hub, Bricks and
Catch at sunset, step 5 and step 10 (see tests/contrast.mjs). Row U1:
tests/putt-sim.mjs and Putt with real touch events: a level at once and the
next built in a Web Worker, a cancelled pull, real shots planned with the
page's own sim.js until the ball drops (10, 6 and 24 ms ticks), the next level
sliding in with no wait, level 1 only from minute 10, a new level on every
opening, offline. Row U2: Putt's open course (no frame), sand and sea levels alternating, in light and dark,
with screenshots of each. Row S1: tests/stack-sim.mjs and Stack with real touch
events: a new tower on every opening, timed taps for a near-perfect drop (16
ms), a landed drop with bits (8 ms), a complete miss, a floor under 12 px
followed by a 60 px block, hidden and pagehide pause, reduced motion, dusk,
the drawn colours at sunset, step 5 and step 10.
Screenshots go to tests/out/.
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


def new_context(browser, w, h, dpr=DPR, scheme="light"):
    # Row D1: the phone's colour scheme (prefers-color-scheme); every existing check runs in light, as before.
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=dpr,
        is_mobile=True,
        has_touch=True,
        service_workers="allow",
        color_scheme=scheme,
    )
    ctx.add_init_script(VIBRATE_STUB)
    return ctx


def hits(page):
    page.wait_for_function("document.getElementById('screen').dataset.hits")
    return json.loads(page.eval_on_selector("#screen", "c => c.dataset.hits"))


def layout_of(page):
    hits(page)
    return json.loads(page.eval_on_selector("#screen", "c => c.dataset.layout"))


# Row H2 layout values (PLAN §5a), restated here so a change in hub/cards.js fails a check.
H2_GAP, H2_SEA_CLEAR, H2_RATIO, H2_SKY_MIN = 5, 8, 1.3, 40


# Card sizes (w, h) by CSS width and device scale, at logical heights 240, 300 and 400 (row H2).
H2_CARD_SIZE = {(360, 2.625): (56, 72), (360, 3): (56, 72), (412, 2.625): (57, 74), (412, 3): (58, 75)}


def h2_bottom_margin(H):
    return max(8, round(H * 0.05))


def mix_hex(a, b, t):
    """shared/tokens.js mix(): a flat mix of two #RRGGBB colours."""
    pa, pb = [[int(c[i:i + 2], 16) for i in (1, 3, 5)] for c in (a, b)]
    return "#" + "".join("%02X" % math.floor(x + (y - x) * t + 0.5) for x, y in zip(pa, pb))


def h2_sun_radius(sky):
    return max(24, min(40, round(sky * 0.3)))


def hub_layout_checks(page, tag, h):
    """Row H2: four equal cards in a 2x2 grid (Bricks, Catch / Putt, Stack), each at least 40 logical px each way,
    5 px gaps, centred, inside the safe area and clear of the 24 CSS px side band, low in the thumb's reach (the grid's
    bottom a fixed margin above the bottom inset), at most 1.3 x as tall as wide, the horizon 8 px above the grid with
    the sky above it; the cards and nothing else; no text drawn."""
    lay = layout_of(page)
    g = json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))
    H, W, r = lay["H"], lay["W"], lay["rects"]
    safe = g["safe"]
    check(sorted(r) == sorted(GAMES) and sorted(hits(page)) == sorted(GAMES),
          f"[{tag}] the hub has one card per built game and nothing else {sorted(hits(page))}")
    b, c, p, s = (r[k] for k in GAMES)
    sizes = {(q["w"], q["h"]) for q in r.values()}
    check(len(sizes) == 1, f"[{tag}] the four cards are the same size {sizes}")
    w, hh = b["w"], b["h"]
    check(w >= 40 and hh >= 40, f"[{tag}] every card is a tap target of at least 40 logical px each way ({w}x{hh})")
    gx = c["x"] - (b["x"] + w)
    gy = p["y"] - (b["y"] + hh)
    check(b["y"] == c["y"] and p["y"] == s["y"] and b["x"] == p["x"] and c["x"] == s["x"]
          and s["x"] - (p["x"] + w) == gx and s["y"] - (c["y"] + hh) == gy and gx == gy == H2_GAP,
          f"[{tag}] a 2x2 grid in order Bricks, Catch / Putt, Stack with 5 px gaps ({gx}, {gy})")
    left, right, top, bottom = b["x"], c["x"] + w, b["y"], p["y"] + hh
    check(left >= safe["left"] and W - right >= safe["right"] and top >= safe["top"] and bottom <= H - safe["bottom"],
          f"[{tag}] the grid ({left}..{right} x {top}..{bottom}) is inside the safe area {safe}")
    side = max(4, g["edge"], safe["left"] + 2, safe["right"] + 2)
    check(left >= g["edge"] and W - right >= g["edge"] and abs(left - (W - right)) <= 1 and w == (W - 2 * side - H2_GAP) // 2,
          f"[{tag}] the grid is centred, clear of the side band where touches are ignored, the cards as wide as the margins allow "
          f"({left}, {W - right}, band {g['edge']}, width {w})")
    want_bottom = H - safe["bottom"] - h2_bottom_margin(H)
    check(bottom == want_bottom, f"[{tag}] the grid sits low, in the thumb's reach: it ends {bottom}, want {want_bottom} "
          f"(H {H} - bottom inset {safe['bottom']} - {h2_bottom_margin(H)})")
    check(hh == int(w * H2_RATIO), f"[{tag}] the cards are {H2_RATIO} x as tall as wide at most, and that tall ({w}x{hh})")
    horizon = g["horizon"]
    check(horizon == top - H2_SEA_CLEAR and g["seaHeight"] == H - horizon and horizon - safe["top"] >= H2_SKY_MIN,
          f"[{tag}] the horizon {horizon} is {H2_SEA_CLEAR} px above the grid (top {top}): the cards sit on the sea, "
          f"the sky above is at least {H2_SKY_MIN} px ({horizon - safe['top']})")
    check(page.eval_on_selector("#screen", "c => c.dataset.labels || null") is None and page.evaluate("window.__text") == 0,
          f"[{tag}] the hub draws no text (no labels, no fillText or strokeText)")
    return lay


def hub_scene_checks(page, shot, tag):
    """Row H2 at sunset: the whole sun on the raised horizon in the open sky above the cards, sized to the sky,
    clear of every card; the sea from the horizon down behind the cards."""
    g = json.loads(page.eval_on_selector("#screen", "c => c.dataset.grid"))
    tok = page.evaluate(HUB_TOKENS_JS)
    C, pal = tok["C"], tok["pals"][0]
    hz, safe = g["horizon"], g["safe"]
    rad = h2_sun_radius(hz - safe["top"])
    sx = g["sunX"]
    got = logical_pixels(page, shot, [(sx, hz - 1), (sx, hz - rad), (sx, hz - rad - 1), (1, hz), (1, hz - 1),
                                      (4, g["y0"] + g["ch"]), (2, g["bottom"] + 1), (sx - rad, hz - 1), (sx + rad - 1, hz - 1),
                                      (sx + rad, hz - 1)])
    check(got[0] == C["sun"] and got[1] == C["sun"] and got[2] != C["sun"] and got[3] == pal["sea"][0] and got[4] in pal["sky"]
          and got[5] in pal["sea"] and got[6] in pal["sea"] and got[7] == C["sun"] and got[8] == C["sun"] and got[9] != C["sun"]
          and g["sunRadius"] == rad and hz - rad > safe["top"] + 8 and hz < g["y0"],
          f"[{tag}] sunset: the whole sun (radius {rad}, x {sx}) on the horizon {hz} in the open sky, clear of the cards (top {g['y0']}); "
          f"the sea from the horizon down behind and below the cards ({got})")
    check(sx <= 96 and sx + rad <= 135 - 4 and sx - rad >= 4,
          f"[{tag}] the whole sun shows with a margin: x {sx} radius {rad} spans {sx - rad}..{sx + rad - 1} of 0..134 (at least 4 px clear of each edge)")
    H = g["horizon"] + g["seaHeight"]
    check(len(g["clouds"]) == (4 if H > 300 else 3), f"[{tag}] {len(g['clouds'])} clouds in the sky at logical height {H} (a fourth over 300)")
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
    p0 = hits(page)["catch"]
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
        if game == "putt":
            ps = g.evaluate("window.__putt.snapshot()")
            check(ps["mode"] == "worker" and ps["level"]["fallback"] is False,
                  f"[{tag}] Putt opens offline and its worker builds the level ({ps['mode']})")
        elif game == "stack":
            check(g.evaluate("window.__stack.snapshot().raf"), f"[{tag}] Stack opens and runs offline")
        else:
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
    page.goto(base + "games/catch/")
    page.wait_for_function(GAME_READY["catch"])
    page.wait_for_timeout(150)
    shot = OUT / f"catch-{w}x{h}.png"
    page.screenshot(path=str(shot))
    info, s, H, bad, total, ncol, size = crisp(page, shot)
    g = page.evaluate("window.__catch.snapshot().game")["geo"]
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"] and g["top"] == 5
          and g["horizon"] == H - 42 and g["deckY"] == H - 47,
          f"[{tag}] Catch: crisp, no overflow, things fall from 5 px below the top (no HUD), boat on the horizon")
    page.goto(base + "games/putt/")
    page.wait_for_function("window.__putt && window.__putt.snapshot().level", timeout=20000)
    page.wait_for_timeout(150)
    shot = OUT / f"putt-{w}x{h}.png"
    page.screenshot(path=str(shot))
    ps = page.evaluate("window.__putt.snapshot()")
    info, s, H, bad, total, ncol, size = crisp(page, shot, ps["geo"]["scale"])
    lv = ps["level"]
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"] and lv["H"] == H and lv["y1"] == H - ps["geo"]["bottom"]
          and lv["y0"] == ps["geo"]["top"] and lv["x0"] == 0 and lv["x1"] == 135,
          f"[{tag}] Putt: crisp, no overflow, the course the whole screen less the safe-area insets (row U2; H {H})")
    page.goto(base + "games/stack/")
    page.wait_for_function("window.__stack && window.__stack.snapshot().game", timeout=10000)
    page.wait_for_timeout(150)
    shot = OUT / f"stack-{w}x{h}.png"
    page.screenshot(path=str(shot))
    q = page.evaluate("window.__stack.snapshot()")
    info, s, H, bad, total, ncol, size = crisp(page, shot, q["geo"]["scale"])
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"] and q["geo"]["H"] == H and q["geo"]["horizon"] == H - 42
          and abs(q["game"]["floors"][0]["x"] + 30 - 67.5) < 1e-9,
          f"[{tag}] Stack: crisp, no overflow, the tower centred on the horizon (H {H})")
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
                    # The card size, stated per view: the same at logical heights 240, 300 and 400 (capped at 1.3 x the width).
                    size = (lay["rects"]["bricks"]["w"], lay["rects"]["bricks"]["h"])
                    check(size == H2_CARD_SIZE[(w, dpr)], f"[{tag}] H{H}: cards {size[0]}x{size[1]}, want {H2_CARD_SIZE[(w, dpr)]}")
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
    ctx = new_context(browser, 360, 800)
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


def open_catch(ctx, base):
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "games/catch/")
    page.wait_for_function(GAME_READY["catch"])
    page.wait_for_timeout(150)
    return page, errors


def catch_track(page, touch, ms, x, y, per_px, until=None, max_ms=30000):
    """Hold a finger and steer the boat under the thing nearest to landing, for ms; with until (a test on
    the game state), go on past ms until it holds, at most max_ms (X13: a fixed window can see no catch)."""
    import math

    width = page.viewport_size["width"]
    sens = csnap(page)["sensitivity"]
    cur = x
    touch.down(cur, y)
    t0 = time.time()
    end, hard = t0 + ms / 1000, t0 + max(ms, max_ms) / 1000
    while True:
        g = csnap(page)["game"]
        now = time.time()
        if now >= hard or (now >= end and (until is None or until(g))):
            break
        things = [o for o in g["items"] + ([g["treat"]] if g["treat"] else []) if not o["low"]]
        if things:
            o = max(things, key=lambda o: o["y"])
            ox = o["x"] + 3 * math.sin(o["ph"]) + 3.5
            d = ox - (g["boatX"] + 12)
            nxt = max(30, min(width - 30, cur + max(-12, min(12, d / sens * per_px))))
            if abs(nxt - cur) > 0.01:
                touch.move(nxt, y)
                cur = nxt
        page.wait_for_timeout(15)
    touch.up()


def run_catch(browser, base):
    """Rows C1 and X1: Catch in the browser at 360x800, played with real touch events."""
    tag = "catch 360x800"
    ctx = new_context(browser, 360, 800)
    foreign = []
    origin = base.split("/4rk4d3/")[0]
    ctx.on("request", lambda r: (not r.url.startswith(origin) and not r.url.startswith("data:")) and foreign.append(r.url))
    page, errors = open_catch(ctx, base)
    page.evaluate("localStorage.clear(); sessionStorage.clear()")
    page.reload()
    page.wait_for_function(GAME_READY["catch"])
    page.wait_for_timeout(200)
    touch = Touch(ctx, page)
    x, y, scale, k = sea_point(page)
    per_px = scale * k  # CSS px per logical px

    s0 = csnap(page)
    g0 = s0["game"]
    check(s0["mode"] == "paused" and g0["caught"] == 0 and g0["eaten"] == 0 and g0["pace"] == 0.3 and g0["unlocked"] == 2
          and not g0["items"] and "v" not in g0,
          f"[{tag}] opening: paused, pace 0.3, 2 kinds, variety counts at 0")
    shot = OUT / "catch-game-paused.png"
    page.screenshot(path=str(shot))
    no_pause_marker(page, shot, tag, "__catch", "Catch opening")
    info, s, H, bad, total, _, _ = crisp(page, shot)
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"], f"[{tag}] crisp, no scrolling or overflow")
    no_hud(page, tag, "Catch")
    r0 = page.evaluate("window.__raf")
    page.wait_for_timeout(500)
    s1 = csnap(page)
    check(s1["game"] == g0 and page.evaluate("window.__raf") == r0 and not s1["raf"], f"[{tag}] paused: frozen, no frame requested")

    # Row X1: touches that begin within 24 CSS px of either side edge do nothing: no resume, no boat move, no fish.
    for ex, to in ((5, 120), (23, 120), (337, 240), (355, 240)):
        touch.down(ex, y)
        touch.move(to, y)
        page.wait_for_timeout(320)
        touch.up()
        touch.tap(ex, y - 200, 30)
    page.wait_for_timeout(50)
    q = csnap(page)
    check(q["mode"] == "paused" and q["game"] == g0 and q["fingers"] == 0,
          f"[{tag}] touches that begin within 24 CSS px of the left or right edge are ignored: no resume, the boat still, no fish")

    # A quick touch while paused is the resume touch: never a tap, no fish; lifted before 250 ms it stays paused.
    touch.tap(x, y, 40)
    page.wait_for_timeout(100)
    q = csnap(page)
    check(q["mode"] == "paused" and not q["game"]["fish"], f"[{tag}] a quick touch while paused: no fish, still paused ({q['mode']})")

    # Finger down: resumes after 250 ms; the drag follows the shared thumb travel, clamped.
    touch.down(x, y)
    page.wait_for_timeout(60)
    q = csnap(page)
    check(q["mode"] == "resuming" and q["game"]["items"] == g0["items"], f"[{tag}] finger down: waits before resuming")
    page.wait_for_timeout(300)
    check(csnap(page)["mode"] == "running", f"[{tag}] after 250 ms play runs")
    sens = csnap(page)["sensitivity"]
    b0 = csnap(page)["game"]["boatX"]
    for i in range(1, 5):
        touch.move(x + 5 * i, y)
    page.wait_for_timeout(30)
    b1 = csnap(page)["game"]["boatX"]
    want = 20 / per_px * sens
    check(abs((b1 - b0) - want) < 0.05, f"[{tag}] relative drag: boat moved {b1 - b0:.2f} for {want:.2f} (sensitivity {sens:.3f})")
    touch.move(x + 600, y)
    page.wait_for_timeout(30)
    check(abs(csnap(page)["game"]["boatX"] - (135 - 24)) < 1e-9, f"[{tag}] boat clamped to the field")
    touch.move(x - 600, y)
    page.wait_for_timeout(30)
    check(csnap(page)["game"]["boatX"] == 0, f"[{tag}] boat clamped at the left edge")
    # Shared thumb travel (PLAN §6a, §6e): a drag across 28 percent of the screen width moves the boat exactly end to end.
    half = page.viewport_size["width"] * 0.28
    start = x - 600
    for i in range(1, 11):
        touch.move(start + half * i / 10, y)
    page.wait_for_timeout(30)
    end_x = csnap(page)["game"]["boatX"]
    check(abs(end_x - (135 - 24)) < 0.05, f"[{tag}] a drag across 28 percent of the screen width ({half:.0f} CSS px) moves the boat end to end ({end_x:.2f} of 111)")
    touch.move(start + half * 0.5, y)
    touch.up()

    # Lift: play goes on through the 400 ms grace, the boat holds, then it pauses.
    a = csnap(page)
    page.wait_for_timeout(200)
    b = csnap(page)
    check(b["mode"] == "running" and b["grace"] and b["game"]["time"] > a["game"]["time"] and b["game"]["boatX"] == a["game"]["boatX"],
          f"[{tag}] 200 ms after the lift: still playing, the boat holds its position")
    page.wait_for_timeout(350)
    c = csnap(page)
    page.wait_for_timeout(300)
    d = csnap(page)
    check(c["mode"] == "paused" and d["game"] == c["game"] and not d["raf"], f"[{tag}] after the grace: paused and frozen")
    check(c["clock"]["active"] > 0.5, f"[{tag}] the session clock counts Catch play, in memory ({c['clock']['active']:.2f} s)")

    # Play: catches tick 8 ms (tracked until at least one catch, X13).
    page.evaluate("window.__vib = []")
    c_start = csnap(page)["game"]["caught"]
    catch_track(page, touch, 9000, x, y, per_px, until=lambda g: g["caught"] > c_start)
    page.wait_for_timeout(600)
    q = csnap(page)
    vib = page.evaluate("window.__vib")
    check(q["game"]["caught"] > 0 and 8 in vib and set(vib) <= {8}, f"[{tag}] catches tick 8 ms, haptics always on ({q['game']['caught']} caught, {vib})")
    no_hud(page, tag, "Catch after play")
    page.screenshot(path=str(OUT / "catch-game-play.png"))

    def with_nasty(ny, nx=100, boat=0):
        """A nasty in the air (and nothing else due soon), then resume and lift (grace)."""
        set_catch(page, """(s, g) => { s.items = []; s.treat = null; s.fish = []; s.spawnIn = 1.7; s.nastyIn = 25; s.treatIn = 140;
          s.boatX = g.boat; s.nasty = { x: g.nx, y: g.ny, vy: 30, k: 0, low: false, hunted: false }; }""", {"nx": nx, "ny": ny, "boat": boat})
        touch.down(x, y)
        page.wait_for_timeout(400)
        touch.up()

    # A tap with a nasty in the air: a fish leaps, bites (16 ms), and the tap is not read as a pause.
    page.wait_for_function("window.__catch.snapshot().mode === 'paused'")
    with_nasty(200)
    page.evaluate("window.__vib = []")
    e0 = csnap(page)["game"]["eaten"]
    touch.tap(x - 40, y - 200, 30)
    page.wait_for_timeout(60)
    q = csnap(page)
    check(q["mode"] == "running" and any(f["m"] == "leap" for f in q["game"]["fish"]) and q["game"]["nasty"]["hunted"],
          f"[{tag}] a tap anywhere with a nasty in the air sends a fish leaping")
    page.wait_for_timeout(300)
    q = csnap(page)
    check(q["mode"] == "running" and q["game"]["eaten"] == e0 + 1 and q["game"]["nasty"] is None,
          f"[{tag}] the fish eats the nasty; play is still running 360 ms after the tap (eaten {q['game']['eaten']})")
    check(16 in page.evaluate("window.__vib"), f"[{tag}] the bite ticks 16 ms ({page.evaluate('window.__vib')})")
    check(q["bits"] > 0, f"[{tag}] bite bits shown")
    page.wait_for_timeout(500)
    check(csnap(page)["mode"] == "paused", f"[{tag}] with no further touch, play pauses after the grace")
    # A nasty about to land in the water: the tap still bites first.
    hz = csnap(page)["game"]["geo"]["horizon"]
    page.evaluate("window.__vib = []")
    set_catch(page, """(s, h) => { s.nasty = { x: 100, y: h - 7 - 12, vy: 30, k: 1, low: true, hunted: false }; s.boatX = 0; s.fish = []; s.items = [];
      s.ink = 0; s.nastyIn = 25; s.spawnIn = 1.7; }""", hz)
    touch.down(x, y)
    page.wait_for_timeout(300)
    touch.up()
    touch.tap(x, y, 20)
    q = csnap(page)
    above = hz - (q["game"]["nasty"]["y"] + 7) if q["game"]["nasty"] else None
    page.wait_for_timeout(300)
    q = csnap(page)
    check(q["game"]["nasty"] is None and q["game"]["ink"] == 0 and q["game"]["eaten"] == e0 + 2,
          f"[{tag}] a nasty tapped just above the water ({above if above is None else round(above, 2)} px) is eaten, no ink")
    # A slow lift (over 200 ms) with a nasty in the air never fires a fish.
    page.wait_for_timeout(500)
    with_nasty(60)
    touch.down(x, y)
    page.wait_for_timeout(320)
    touch.up()
    page.wait_for_timeout(50)
    q = csnap(page)
    check(not q["game"]["fish"] and not q["game"]["nasty"]["hunted"], f"[{tag}] a slow lift (320 ms) fires no fish")
    # A tap with no nasty: a hop, no haptic.
    page.wait_for_timeout(500)
    set_catch(page, "(s) => { s.nasty = null; s.fish = []; }")
    touch.down(x, y)
    page.wait_for_timeout(300)
    touch.up()
    page.evaluate("window.__vib = []")
    touch.tap(x, y, 30)
    page.wait_for_timeout(40)
    q = csnap(page)
    check(any(f["m"] == "hop" for f in q["game"]["fish"]) and 16 not in page.evaluate("window.__vib"), f"[{tag}] a tap with no nasty: a hop, no bite tick")

    # A nasty landing uneaten: cosmetics only.
    page.wait_for_timeout(600)
    set_catch(page, """(s, h) => { s.nasty = { x: 100, y: h - 7 - 1, vy: 30, k: 2, low: true, hunted: false }; s.boatX = 0; s.fish = []; s.items = [];
      s.pace = 0.5; }""", hz)
    before = csnap(page)
    page.evaluate("window.__vib = []")
    touch.down(x, y)
    page.wait_for_timeout(500)
    q = csnap(page)
    page.screenshot(path=str(OUT / "catch-ink.png"))
    touch.up()
    check(q["game"]["ink"] > 3 and q["game"]["caught"] == before["game"]["caught"] and q["game"]["pace"] == 0.5
          and page.evaluate("window.__vib") == [],
          f"[{tag}] a nasty landing in the water: ink, no count or pace change, no haptic")
    page.wait_for_timeout(600)

    # Hidden mid-play: paused at once (no grace), no loop.
    touch.down(x, y)
    page.wait_for_timeout(500)
    set_hidden(page, True)
    h = csnap(page)
    r2 = page.evaluate("window.__raf")
    page.wait_for_timeout(400)
    check(h["mode"] == "paused" and not h["raf"] and csnap(page)["game"] == h["game"]
          and page.evaluate("window.__raf") == r2, f"[{tag}] hidden: paused at once, no loop")
    set_hidden(page, False)
    touch.up()
    st = page.evaluate(STORAGE_JS)
    check(st == {"local": {}, "session": {}, "idb": [], "cookie": ""}, f"[{tag}] after play storage is empty {st}")

    # Kill mid-play (pagehide only) and reopen: a fresh scene, paused; nothing was stored.
    touch.down(x, y)
    page.wait_for_timeout(1500)
    page.evaluate("dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))")
    st = page.evaluate(STORAGE_JS)
    page.close()
    page, errors2 = open_catch(ctx, base)
    touch = Touch(ctx, page)
    r = csnap(page)
    check(st == {"local": {}, "session": {}, "idb": [], "cookie": ""} and r["mode"] == "paused" and not r["game"]["items"]
          and r["game"]["caught"] == 0 and r["game"]["pace"] == 0.3 and r["clock"]["active"] == 0,
          f"[{tag}] killed mid-play: nothing stored; reopened: a fresh scene, paused, the clock at 0")
    page.screenshot(path=str(OUT / "catch-game-reopened.png"))
    errors += errors2

    # Reduced motion: a bite shows no bits.
    page.emulate_media(reduced_motion="reduce")
    with_nasty(150)
    touch.tap(x, y, 30)
    mx = 0
    for _ in range(20):
        page.wait_for_timeout(30)
        q = csnap(page)
        mx = max(mx, q["bits"])
    check(mx == 0 and q["game"]["nasty"] is None, f"[{tag}] reduced motion: a bite shows no bits")
    page.emulate_media(reduced_motion="no-preference")

    # Full dusk, opened from the hub at 12 minutes: step 10, the hull keeps its colour.
    page.goto(base)
    hits(page)
    page.evaluate(SET_CLOCK_JS, 720)
    g_ = open_tile(page, "catch")
    page.wait_for_timeout(200)
    q = csnap(g_)
    shot = OUT / "catch-dusk.png"
    page.screenshot(path=str(shot))
    gg = q["game"]
    hull = (round(gg["boatX"]) + 12, gg["geo"]["deckY"] + 3)
    sky_px = (2, gg["geo"]["top"] + 2)
    got = logical_pixels(g_, shot, [hull, sky_px])
    check(q["step"] == 10 and q["clock"]["active"] == 720 and got[0] == "#F05A68" and delta_e(got[0], got[1]) >= MIN_DE,
          f"[{tag}] Catch opened from the hub at 12 minutes: the hub's clock, full dusk, hull keeps coral ({got})")
    # One clock across games: play Catch, go back, open Bricks: it shows the same clock.
    xs, ys, *_ = sea_point(g_)
    touch = Touch(ctx, g_)
    touch.down(xs, ys)
    page.wait_for_timeout(1500)
    touch.up()
    page.wait_for_timeout(600)
    played = csnap(g_)["clock"]["active"]
    back_to_hub(page)
    hub_clock = page.evaluate("window.__rlxSession.active")
    gb = open_tile(page, "bricks")
    bq = snap(gb)
    check(played > 720.5 and hub_clock == played and bq["clock"]["active"] == played and bq["step"] == 10,
          f"[{tag}] one clock across games: Catch played it to {played:.2f} s, the hub and then Bricks read the same")
    back_to_hub(page)

    check(not errors and not errors2, f"[{tag}] no console errors {errors + errors2}")
    check(not foreign, f"[{tag}] only same-origin requests {foreign}")
    ctx.close()


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
    """Row B4: the drawn colours of the hub, Bricks and Catch at sunset, step 5 and step 10 (games opened from the hub)."""
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
                  and got == [tok["keel"], C["coral"], tok["edgeCoral"], tok["keel"], tok["keel"]] * 4,
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
            # Catch: hull edge and fill, sail in its token.
            g_ = open_tile(page, "catch")
            page.wait_for_timeout(150)
            q = csnap(g_)
            gg = q["game"]
            shot = OUT / f"b4-catch-{vtag}-{k}.png"
            page.screenshot(path=str(shot))
            bx, deck = round(gg["boatX"]), gg["geo"]["deckY"]
            got = logical_pixels(g_, shot, [(bx + 12, deck), (bx + 12, deck + 3), (bx + 12, deck - 3), (bx + 11, deck - 6)])
            check(q["step"] == k and got == [tok["edgeCoral"], C["coral"], C["sail"], tok["lineCoral"]],
                  f"[{tag}] Catch: hull coral in its edge, sail in its own colour, mast in the edge ({got})")
            no_pause_marker(g_, shot, tag, "__catch", "Catch from the hub")
            # B4 review: the hull's rows at and below the horizon in the keel; with an ink cloud and a
            # glint set in the live state, the inked sea and the glint as drawn.
            hz = gg["geo"]["horizon"]
            got = logical_pixels(g_, shot, [(bx + 12, hz), (bx + 12, hz + 1), (bx + 12, hz - 1)])
            check(tok["keel"] is not None and got == [tok["keel"], tok["keel"], C["coral"]],
                  f"[{tag}] Catch: the hull's rows below the horizon in the keel {tok['keel']}, the row above in coral ({got})")
            set_catch(g_, "(s) => { s.ink = 3; s.sky = { k: 'glint', t: 0 }; }")
            # A redraw while paused: a resize event re-lays out and paints.
            g_.evaluate("() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))")
            page.wait_for_timeout(150)
            q = csnap(g_)
            shot = OUT / f"b4-catch-fx-{vtag}-{k}.png"
            page.screenshot(path=str(shot))
            sink = round(k / 10 * 24)
            gy = hz - (24 - sink) + 3 if k < 10 else hz + 4
            sea_row = logical_pixels(g_, shot, [(x, hz + 9) for x in range(135)])
            got = logical_pixels(g_, shot, [(96, gy), (94, gy), (96, gy - 2)])
            inked = tok["inked"][k][0]
            check(q["game"]["ink"] > 2 and q["game"]["sky"] and inked in sea_row and tok["pals"][k]["sea"][0] not in sea_row
                  and delta_e(inked, tok["pals"][k]["sea"][0]) >= MIN_DE,
                  f"[{tag}] Catch: the ink cloud drawn as {inked}, delta E {delta_e(inked, tok['pals'][k]['sea'][0]):.2f} from sea band 1")
            behind = [C["sun"]] if k < 10 else [tok["pals"][k]["sea"][0], inked]
            de = min(delta_e(tok["glint"], b) for b in behind) if tok["glint"] else 0
            check(tok["glint"] is not None and got == [tok["glint"]] * 3 and de >= MIN_DE,
                  f"[{tag}] Catch: the glint drawn in {tok['glint']}, delta E {de:.2f} from what is behind it ({got})")
            back_to_hub(page)
        ctx.close()


def run_catch_sim():
    """tests/catch-sim.mjs: sim.js in Node (the 15-minute run and more)."""
    res = subprocess.run(["node", str(ROOT / "tests" / "catch-sim.mjs")], capture_output=True, text=True)
    out = res.stdout.strip().splitlines()
    for line in out:
        if line.startswith("FAIL"):
            print("  sim " + line)
    summary = out[-1] if out else res.stderr.strip()
    check(res.returncode == 0, f"node tests/catch-sim.mjs: {summary}")


def run_node_sim():
    """tests/bricks-sim.mjs: physics.js and the session clock in Node (10- and 15-minute runs and more)."""
    res = subprocess.run(["node", str(ROOT / "tests" / "bricks-sim.mjs")], capture_output=True, text=True)
    out = res.stdout.strip().splitlines()
    for line in out:
        if line.startswith("FAIL"):
            print("  sim " + line)
    summary = out[-1] if out else res.stderr.strip()
    check(res.returncode == 0, f"node tests/bricks-sim.mjs: {summary}")


def run_putt_sim():
    """tests/putt-sim.mjs: sim.js and gen.js in Node (200 levels per difficulty and more)."""
    res = subprocess.run(["node", str(ROOT / "tests" / "putt-sim.mjs")], capture_output=True, text=True)
    out = res.stdout.strip().splitlines()
    for line in out:
        if line.startswith("FAIL"):
            print("  sim " + line)
    summary = out[-1] if out else res.stderr.strip()
    check(res.returncode == 0, f"node tests/putt-sim.mjs: {summary}")


def psnap(page):
    return page.evaluate("window.__putt.snapshot()")


# Plans one shot in the page with Putt's own sim.js and gen.js (the same modules the game runs): from a
# thumb at (cx0, cy0) CSS px, every whole-degree direction at seven pull lengths (0.8 of those used
# under the old 60 px cap, so the same powers are sampled under the 48 px cap); the pull is turned
# into a shot by __putt.shotFor, exactly as the game does. Picks a shot that sinks, else the one that
# rests nearest the hole by walking distance. With side set, a full-power pull straight sideways.
PLAN_SHOT_JS = """async ({ cx0, cy0, side }) => {
  const S = await import(new URL('./sim.js', location.href).href);
  const G = await import(new URL('./gen.js', location.href).href);
  const snap = window.__putt.snapshot();
  const w = S.buildWorld(snap.level);
  const b = snap.ball;
  const play = { launchSpeed: 220, decel: 55, stopSpeed: 4, bounce: 0.85, sandFactor: 3, captureSpeed: 140 };
  const field = G.distanceField(w);
  const sim = (ex, ey) => {
    const shot = window.__putt.shotFor(cx0, cy0, ex, ey);
    if (!shot) return null;
    const ball = S.newBall(b.x, b.y);
    S.shoot(ball, shot.dx, shot.dy, shot.speed);
    let bounces = 0;
    while (ball.moving) { const ev = S.step(w, ball, play); if ((ev & S.EV_BOUNCE) && ball.vn >= 8) bounces++; }
    return { ex, ey, sunk: ball.sunk, x: ball.x, y: ball.y, bounces, water: !ball.sunk && ball.x === b.x && ball.y === b.y };
  };
  if (side) return sim(cx0 + side * 170, cy0);
  let best = null;
  for (let a = 0; a < 360; a++) {
    for (const len of [13, 26, 42, 64, 86, 106, 132]) {
      const ex = Math.round(cx0 + Math.cos(a * Math.PI / 180) * len);
      const ey = Math.round(cy0 + Math.sin(a * Math.PI / 180) * len);
      const r = sim(ex, ey);
      if (!r) continue;
      r.score = r.sunk ? -1 : r.water ? 1e9 : field.at(r.x, r.y);
      if (!best || r.score < best.score) best = r;
    }
  }
  return best;
}"""


def putt_stroke(page, touch, cx0, cy0, ex, ey):
    """Pull back from (cx0, cy0) to (ex, ey) with a real finger, in steps, and release."""
    touch.down(cx0, cy0)
    page.wait_for_timeout(20)
    for i in range(1, 6):
        touch.move(cx0 + (ex - cx0) * i / 5, cy0 + (ey - cy0) * i / 5)
        page.wait_for_timeout(16)
    touch.up()


def putt_until_rest(page, max_ms=8000):
    t0 = time.time()
    while time.time() - t0 < max_ms / 1000:
        s = psnap(page)
        if not s["ball"]["moving"]:
            return s
        page.wait_for_timeout(30)
    return psnap(page)


def putt_play_hole(page, touch, tag, cx0=180, cy0=420, max_strokes=20, first_side=0):
    """Play the current hole to the end with planned real shots. Returns a log of the strokes."""
    log = []
    start_no = psnap(page)["levelNo"]
    for k in range(max_strokes):
        side = first_side if k == 0 else 0
        plan = page.evaluate(PLAN_SHOT_JS, {"cx0": cx0, "cy0": cy0, "side": side})
        before = psnap(page)
        putt_stroke(page, touch, cx0, cy0, plan["ex"], plan["ey"])
        page.wait_for_timeout(40)
        after = putt_until_rest(page)
        log.append({"plan": plan, "before": before, "after": after})
        if after["ball"]["sunk"] or after["levelNo"] != start_no:
            break
    return log


STORAGE_JS = """async () => ({
  local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
  session: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])),
  idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
  cookie: document.cookie,
})"""


def run_putt(browser, base):
    """Row U1 in the browser at 360x800, played with real touch events."""
    tag = "putt 360x800"
    ctx = new_context(browser, 360, 800)
    foreign = []
    origin = base.split("/4rk4d3/")[0]
    ctx.on("request", lambda r: (not r.url.startswith(origin) and not r.url.startswith("data:")) and foreign.append(r.url))
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    hub = page
    hub.goto(base)
    hits(hub)
    hub.evaluate("localStorage.clear(); sessionStorage.clear()")
    hub.evaluate(SET_CLOCK_JS, 30)
    stored0 = hub.evaluate(STORAGE_JS)
    t0 = time.time()
    page = open_tile(hub, "putt")
    first_ms = (time.time() - t0) * 1000
    s = psnap(page)
    check(s["level"]["fallback"] is False and s["mode"] == "worker" and first_ms < 3000 and s["opening"]["diff"] == s["level"]["diff"],
          f"[{tag}] opening Putt shows a generated level ({first_ms:.0f} ms from the tap, level {s['level']['diff']}; levels 1 and 2 built on the page, 3 in the worker)")
    openings = [s["opening"]]
    page.wait_for_function("window.__putt.snapshot().ready.random !== null", timeout=20000)
    s = psnap(page)
    check(s["ready"]["random"] in (1, 2, 3), f"[{tag}] the next level is built in the background while this one is played (level {s['ready']['random']} ready)")
    check(s["clock"]["active"] >= 30 and s["step"] == 0, f"[{tag}] Putt reads the shared session clock ({s['clock']['active']:.1f} s)")
    no_hud(page, tag, "Putt")
    shot = OUT / f"putt-play-{tag.split()[-1]}.png"
    page.screenshot(path=str(shot))
    info, sc, H, bad, total, ncol, size = crisp(page, shot, s["geo"]["scale"])
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"], f"[{tag}] crisp, no scrolling ({ncol} colours)")
    touch = Touch(ctx, page)
    page.evaluate("window.__vib = []")

    # Touches that begin within 24 CSS px of either edge move nothing.
    lv = s["level"]
    for x in (5, 23, 337, 355):
        putt_stroke(page, touch, x, 420, 180, 600)
        page.wait_for_timeout(60)
    s = psnap(page)
    check(s["ball"]["x"] == lv["tee"]["x"] and s["ball"]["y"] == lv["tee"]["y"] and not s["ball"]["moving"] and not s["aiming"]
          and page.evaluate("window.__vib.length") == 0, f"[{tag}] touches that begin within 24 CSS px of the left or right edge are ignored")
    # A touch 25 px in does aim.
    touch.down(26, 420)
    touch.move(26, 470)
    page.wait_for_timeout(50)
    aiming = psnap(page)["aiming"]
    page.screenshot(path=str(OUT / f"putt-aim-{tag.split()[-1]}.png"))
    # Pull back to within 4 logical px (10 CSS px at this scale) and release: cancelled.
    touch.move(26, 428)
    touch.up()
    page.wait_for_timeout(80)
    s = psnap(page)
    check(aiming and not s["ball"]["moving"] and s["ball"]["x"] == lv["tee"]["x"] and page.evaluate("window.__vib.length") == 0,
          f"[{tag}] a touch 26 px in aims; pulling back to within 4 px and releasing cancels the shot (no move, no tick)")

    # Play the hole with planned real shots: the first a full-power pull sideways, into a wall.
    page.evaluate("window.__vib = []; window.__vibAt = []")
    log = putt_play_hole(page, touch, tag, first_side=1)
    agree = all((l["after"]["ball"]["sunk"] and l["plan"]["sunk"]) or (abs(l["after"]["ball"]["x"] - l["plan"]["x"]) < 1e-6
                and abs(l["after"]["ball"]["y"] - l["plan"]["y"]) < 1e-6) for l in log)
    check(agree, f"[{tag}] every real shot ends exactly where the page's own sim.js said it would ({len(log)} strokes)")
    last = log[-1]["after"]
    check(last["ball"]["sunk"] or last["levelNo"] != log[0]["before"]["levelNo"], f"[{tag}] the ball drops in the hole after {len(log)} strokes")
    vib = page.evaluate("window.__vib")
    at = page.evaluate("window.__vibAt")
    gaps = [b - a for a, b in zip(at, at[1:])]
    bounced = sum(l["plan"]["bounces"] for l in log)
    check(log[0]["plan"]["bounces"] > 0 and vib.count(10) == len(log) and vib.count(24) == 1 and 6 in vib and set(vib) <= {10, 6, 24},
          f"[{tag}] ticks: release 10 ms (one per stroke), bounce 6 ms, drop 24 ms and nothing else ({vib}; {bounced} planned bounces)")
    check(all(g >= 40 - 0.5 for g in gaps), f"[{tag}] at most one vibrate call per 40 ms (smallest gap {min(gaps) if gaps else None})")
    # The next level slides in after about 800 ms, with no wait.
    before_no = log[0]["before"]["levelNo"]
    lvl_before = log[0]["before"]["level"]
    t_sink = time.time()
    slid = False
    while time.time() - t_sink < 3:
        s = psnap(page)
        slid = slid or s["sliding"]
        if s["levelNo"] != before_no and not s["sliding"]:
            break
        page.wait_for_timeout(20)
    waited = time.time() - t_sink
    s = psnap(page)
    check(s["levelNo"] == before_no + 1 and slid and s["level"]["fallback"] is False and s["level"]["seed"] != lvl_before["seed"]
          and s["ball"]["x"] == s["level"]["tee"]["x"] and not s["ball"]["sunk"],
          f"[{tag}] after the drop the next (generated, not fallback) level slides in from the top, ball on its tee ({waited:.2f} s after the last stroke settled)")
    page.wait_for_function("window.__putt.snapshot().ready.random !== null", timeout=20000)
    check(psnap(page)["ready"]["random"] in (1, 2, 3), f"[{tag}] the level after that is ready in the background again")
    page.screenshot(path=str(OUT / f"putt-next-{tag.split()[-1]}.png"))
    s = psnap(page)
    check(s["clock"]["active"] > 30 + 1, f"[{tag}] the session clock counts Putt play in memory ({s['clock']['active']:.1f} s)")
    check(not s["raf"] or s["ball"]["moving"], f"[{tag}] idle at rest: no animation loop")

    # Nothing written to storage (the game's frame and the hub's page share it).
    stored1 = page.evaluate(STORAGE_JS)
    check(stored1 == stored0 and hub.evaluate(STORAGE_JS) == stored0,
          f"[{tag}] nothing written to storage (localStorage, sessionStorage, IndexedDB, cookies): {stored1}")
    hub_active = hub.evaluate("window.__rlxSession.active")
    check(s["clock"]["active"] <= hub_active < s["clock"]["active"] + 5, f"[{tag}] Putt's play is on the hub's clock (one clock: {hub_active:.1f} s)")

    # Opening Putt again always gives a new level.
    seeds = {s["level"]["seed"]}
    for i in range(3):
        back_to_hub(hub)
        page = open_tile(hub, "putt")
        s = psnap(page)
        seeds.add(s["level"]["seed"])
        openings.append(s["opening"])
        if s["levelNo"] != 1:
            seeds.add(None)
    check(len(seeds) == 4 and None not in seeds, f"[{tag}] every opening from the hub starts a fresh level ({len(seeds)} different)")
    # The first frame already has its course on a level-1 or 2 opening; a level 3 is asked of the worker
    # at module load and the sea is drawn alone until it lands. Open until both kinds are seen (or 12 openings).
    while len(openings) < 12 and not (any(o["diff"] < 3 for o in openings) and any(o["diff"] == 3 for o in openings)):
        back_to_hub(hub)
        page = open_tile(hub, "putt")
        openings.append(psnap(page)["opening"])
    easy_open = [o for o in openings if o["diff"] < 3]
    hard_open = [o for o in openings if o["diff"] == 3]
    check(easy_open and all(o["atFirstFrame"] for o in easy_open),
          f"[{tag}] a level-1 or 2 opening has its course in the first frame ({sum(o['atFirstFrame'] for o in easy_open)}/{len(easy_open)} openings)")
    check(all(o["atFirstFrame"] or (o["landedMs"] is not None and o["landedMs"] < 3000) for o in hard_open),
          f"[{tag}] a level-3 opening lands from the worker started at module load ({[round(o['landedMs']) if o['landedMs'] is not None else 'first frame' for o in hard_open]} ms after load; {len(hard_open)} of {len(openings)} openings)")

    # From minute 10 of the session clock every new course is level 1, drawn at full dusk.
    back_to_hub(hub)
    hub.evaluate(SET_CLOCK_JS, 600)
    stored0 = hub.evaluate(STORAGE_JS)
    page = open_tile(hub, "putt")
    page.wait_for_function("window.__putt && window.__putt.snapshot().level && window.__putt.snapshot().ready.random !== null", timeout=20000)
    page.wait_for_function("window.__putt.snapshot().ready.easy !== null", timeout=20000)
    s = psnap(page)
    scene = page.eval_on_selector("#screen", "c => c.dataset.scene")
    page.screenshot(path=str(OUT / f"putt-dusk-{tag.split()[-1]}.png"))
    diffs = [s["level"]["diff"], s["ready"]["random"], s["ready"]["easy"]]
    log = putt_play_hole(page, touch, tag)
    t_sink = time.time()
    while time.time() - t_sink < 3:
        s2 = psnap(page)
        if s2["levelNo"] != s["levelNo"] and not s2["sliding"]:
            break
        page.wait_for_timeout(20)
    s2 = psnap(page)
    diffs.append(s2["level"]["diff"])
    check(scene == "10" and diffs == [1, 1, 1, 1] and s2["levelNo"] == s["levelNo"] + 1,
          f"[{tag}] from minute 10 every new course is level 1 (first, queued, kept ready, next: {diffs}), the scene at full dusk ({scene})")
    check(page.evaluate(STORAGE_JS) == stored0, f"[{tag}] at dusk too, nothing written to storage")

    check(not errors, f"[{tag}] no console errors {errors}")
    check(not foreign, f"[{tag}] no requests to another host {foreign}")
    ctx.close()


# Row U2: what a Putt level should look like where nothing is drawn, from the page's own modules: the
# look's ground, the ball's fill and edge, the hole's centre; and the pixels along the four screen edges
# that no piece, hazard, hole, flag or drop shade covers (they must be bare ground: no frame).
PUTT_LOOK_JS = """async () => {
  const T = await import(new URL('../../shared/tokens.js', location.href).href);
  const S = await import(new URL('./sim.js', location.href).href);
  const G = await import(new URL('./gen.js', location.href).href);
  const q = window.__putt.snapshot();
  const L = q.level;
  const look = q.look;
  const g = T.puttGround(look, q.step / 10);
  const C = T.COLORS;
  const dash = T.mix(C.foam, g.ground, 0.55);
  const shapes = [...G.solidPieces(L), ...G.hazardPieces(L)].map((p) => p.shape);
  const covered = (x, y) => shapes.some((sh) => S.shapeDist(sh, S.shapeOf({ k: 'disc', x, y, r: 0 })) <= 0.71);
  const H = q.geo.H;
  const near = (x, y) => Math.hypot(x - L.hole.x, y - L.hole.y) < L.hole.r + 12;
  const bare = [];
  for (let x = 0; x < 135; x++) for (const y of [0, H - 1]) bare.push([x, y]);
  for (let y = 1; y < H - 1; y++) for (const x of [0, 134]) bare.push([x, y]);
  const edges = bare.filter(([x, y]) => !covered(x + 0.5, y + 0.5) && !covered(x + 0.5, y - 0.5) && !near(x + 0.5, y + 0.5));
  return { look, levelNo: q.levelNo, ground: g.ground, dash, edges, ball: [Math.round(q.ball.x - 2.5), Math.round(q.ball.y - 2.5)],
           ballFill: look === 'sea' ? C.foam : C.blue, ballEdge: look === 'sea' ? T.edge(C.coral) : null, holeC: C.keel,
           hole: [Math.floor(L.hole.x), Math.floor(L.hole.y)], box: [L.x0, L.y0, L.x1, L.y1], geo: q.geo,
           kinds: L.edges.map((e) => e.k) };
}"""


def putt_look_checks(g_, tag, shot_name, want_look):
    """Row U2: one Putt level as drawn: its look, the course box, no frame along the four screen edges, the ball and the hole."""
    shot = OUT / shot_name
    g_.page.screenshot(path=str(shot))
    q = g_.evaluate(PUTT_LOOK_JS)
    geo = q["geo"]
    check(q["look"] == want_look and q["box"] == [0, geo["top"], 135, geo["H"] - geo["bottom"]],
          f"[{tag}] level {q['levelNo']} is a {q['look']} level (want {want_look}); the course is the whole screen less the insets {q['box']}; edge pieces {q['kinds']}")
    got = logical_pixels(g_, shot, q["edges"])
    ok = {q["ground"], q["dash"]} if q["look"] == "sea" else {q["ground"]}
    off = [(q["edges"][i], got[i]) for i in range(len(got)) if got[i] not in ok]
    check(len(q["edges"]) > 200 and not off,
          f"[{tag}] no frame: every bare pixel along the four screen edges is the ground ({len(q['edges'])} px; {len(off)} not: {off[:3]})")
    bx, by = q["ball"]
    pts = [(bx + 2, by + 2), (bx, by + 2), q["hole"]]
    got = logical_pixels(g_, shot, pts)
    want_edge = q["ballEdge"] or q["ballFill"]
    check(got[0] == q["ballFill"] and got[1] == want_edge and got[2] == q["holeC"],
          f"[{tag}] the ball {q['ballFill']} in {'its coral edge ' + q['ballEdge'] if q['ballEdge'] else 'its stepped corners'}, the hole's middle {q['holeC']} ({got})")
    return q


def run_putt_open(browser, base):
    """Row U2: Putt's open course and its two looks in the browser at 360x800, light and dark: the first level of
    an opening is sand, then sea, then sand (played with real shots); no frame; the screenshots of one sand and
    one sea level in each theme go to tests/out/u2-*.png for the look against docs/style-reference-putt-open.jpg."""
    for scheme in ("light", "dark"):
        tag = f"putt open {scheme} 360x800"
        ctx = new_context(browser, 360, 800, DPR, scheme)
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base)
        hits(page)
        page.evaluate(SET_CLOCK_JS, 0)
        g_ = open_tile(page, "putt")
        g_.wait_for_timeout(200)
        looks = [putt_look_checks(g_, tag, f"u2-sand-{scheme}.png", "sand")["look"]]
        touch = Touch(ctx, g_)
        for k, want in ((2, "sea"), (3, "sand")):
            log = putt_play_hole(g_, touch, tag)
            deadline = time.time() + 4
            while time.time() < deadline:
                s = psnap(g_)
                if s["levelNo"] == k and not s["sliding"]:
                    break
                g_.wait_for_timeout(30)
            g_.wait_for_timeout(100)
            check(psnap(g_)["levelNo"] == k, f"[{tag}] hole {k - 1} sunk in {len(log)} strokes; level {k} in place")
            name = f"u2-{want}-{scheme}.png" if k == 2 else f"u2-{want}-{scheme}-3.png"
            looks.append(putt_look_checks(g_, tag, name, want)["look"])
        check(looks == ["sand", "sea", "sand"], f"[{tag}] the levels of an opening alternate sand, sea, sand ({looks})")
        back_to_hub(page)
        g_ = open_tile(page, "putt")
        check(psnap(g_)["look"] == "sand" and psnap(g_)["levelNo"] == 1, f"[{tag}] opening Putt again starts on a sand level (nothing stored)")
        check(not errors, f"[{tag}] no console errors {errors}")
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
    check('versionCode(((System.getenv("RLX_VERSION_CODE") ?: "1") as Integer) + 100)' in gradle,
          "versionCode is the CI run number + 100 (PLAN §6f)")
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


def run_stack_sim():
    """tests/stack-sim.mjs: sim.js in Node (the 15-minute run and more)."""
    res = subprocess.run(["node", str(ROOT / "tests" / "stack-sim.mjs")], capture_output=True, text=True)
    out = res.stdout.strip().splitlines()
    for line in out:
        if line.startswith("FAIL"):
            print("  sim " + line)
    summary = out[-1] if out else res.stderr.strip()
    check(res.returncode == 0, f"node tests/stack-sim.mjs: {summary}")


def ssnap(page):
    return page.evaluate("window.__stack.snapshot()")


def open_stack(hub, base, active=None):
    """Open Stack from the hub with one tap on its tile (the hub's clock set to active first). Returns a Hosted."""
    hub.goto(base)
    hits(hub)
    if active is not None:
        hub.evaluate(SET_CLOCK_JS, active)
    page = open_tile(hub, "stack", 10000)
    page.wait_for_timeout(100)
    return page


def stack_time_to(q, target):
    """Seconds until the sliding block's centre reaches target (logical x), from the snapshot."""
    b, W = q["game"]["block"], q["game"]["W"]
    lo, hi = b["w"] / 2, W - b["w"] / 2
    target = max(lo, min(hi, target))
    c, v = b["x"] + b["w"] / 2, b["speed"]
    if b["dir"] > 0:
        return ((target - c) if target >= c else (hi - c) + (hi - target)) / v
    return ((c - target) if target <= c else (c - lo) + (target - lo)) / v


def stack_tap_at(page, touch, offset, x_css=180, y_css=420):
    """Tap when the block's centre is offset px from the top floor's centre (as near as frame timing allows).
    Returns (snapshot before, snapshot after)."""
    page.wait_for_function("window.__stack.snapshot().game.block.mode === 'slide'", timeout=10000)
    deadline = time.time() + 10
    while time.time() < deadline:
        q = ssnap(page)
        f = q["game"]["floors"][-1]
        dt = stack_time_to(q, f["x"] + f["w"] / 2 + offset)
        if dt < 0.012:
            break
        time.sleep(min(dt - 0.008, 0.03) if dt > 0.02 else 0.001)
    before = ssnap(page)
    touch.tap(x_css, y_css, hold_ms=10)
    page.wait_for_timeout(40)
    return before, ssnap(page)


def stack_pixels(page, shot, q, points):
    """Colours of logical pixels in a screenshot of Stack (geometry from the hook)."""
    from PIL import Image

    img = Image.open(shot).convert("RGB")
    g = q["geo"]
    s = g["scale"]
    return ["#%02X%02X%02X" % img.getpixel((g["ox"] + x * s + s // 2, g["oy"] + y * s + s // 2)) for x, y in points]


def run_stack(browser, base):
    """Row S1 in the browser at 360x800, played with real touch events."""
    tag = "stack 360x800"
    ctx = new_context(browser, 360, 800)
    foreign = []
    origin = base.split("/4rk4d3/")[0]
    ctx.on("request", lambda r: (not r.url.startswith(origin) and not r.url.startswith("data:")) and foreign.append(r.url))
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    hub = page
    hub.goto(base)
    hits(hub)
    hub.evaluate("localStorage.clear(); sessionStorage.clear()")
    stored0 = hub.evaluate(STORAGE_JS)
    page = open_stack(hub, base, 30)
    q = ssnap(page)
    g = q["game"]
    check(hub.url == base and hub.evaluate("document.body.dataset.game") == "stack" and q["top"] == 0 and len(g["floors"]) == 1 and g["floors"][0]["w"] == 60
          and g["pace"] == 50 and g["block"]["speed"] == 50 and g["block"]["w"] == 60 and g["block"]["mode"] == "slide",
          f"[{tag}] one tap on STACK opens a new tower: one 60 px floor, a 60 px block sliding at 50")
    check(q["clock"]["active"] >= 30 and q["step"] == 0, f"[{tag}] Stack reads the shared session clock ({q['clock']['active']:.1f} s)")
    no_hud(page, tag, "Stack")
    shot = OUT / f"stack-play-{tag.split()[-1]}.png"
    page.screenshot(path=str(shot))
    info, sc, H, bad, total, ncol, size = crisp(page, shot, q["geo"]["scale"])
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"], f"[{tag}] crisp, no scrolling ({ncol} colours)")
    x0 = ssnap(page)["game"]["block"]["x"]
    page.wait_for_timeout(250)
    check(ssnap(page)["game"]["block"]["x"] != x0 and ssnap(page)["raf"], f"[{tag}] the block keeps sliding with no finger on the screen")

    touch = Touch(ctx, page)
    page.evaluate("window.__vib = []; window.__vibAt = []")
    # Touches that begin within 24 CSS px of either edge drop nothing.
    for x in (5, 23, 337, 355):
        touch.tap(x, 420, hold_ms=10)
        page.wait_for_timeout(40)
    q = ssnap(page)
    check(q["top"] == 0 and q["lastDrop"] is None and q["game"]["block"]["mode"] == "slide" and page.evaluate("window.__vib.length") == 0,
          f"[{tag}] touches that begin within 24 CSS px of the left or right edge are ignored")

    # One thumb: a second finger that comes down while the first is held drops nothing.
    page.wait_for_function("window.__stack.snapshot().game.block.mode === 'slide'", timeout=10000)
    touch.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 180, "y": 420, "id": 1}]})
    page.wait_for_timeout(60)
    d1 = ssnap(page)
    touch.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 180, "y": 420, "id": 1}, {"x": 240, "y": 500, "id": 2}]})
    page.wait_for_timeout(60)
    d2 = ssnap(page)
    touch.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(60)
    check(d1["lastDrop"] is not None and d2["lastDrop"] == d1["lastDrop"] and d2["top"] == d1["top"]
          and d2["game"]["block"]["mode"] == "slide" and ssnap(page)["lastDrop"] == d1["lastDrop"],
          f"[{tag}] the first finger drops the block; a second finger down while it is held drops nothing")
    page.wait_for_timeout(100)

    # A near-perfect drop (a tap timed over the floor's centre, 26 CSS px in): snap, nothing breaks, 16 ms.
    snapped = None
    for _ in range(12):
        page.evaluate("window.__vib = []")
        b, a = stack_tap_at(page, touch, 0, x_css=26)
        if a["lastDrop"] and a["lastDrop"]["kind"] == "snap":
            snapped = (b, a, page.evaluate("window.__vib"))
            break
        page.wait_for_timeout(60)
    if snapped:
        b, a, vib = snapped
        bw = b["game"]["block"]["w"]
        check(a["top"] == b["top"] + 1 and abs(a["game"]["floors"][-1]["w"] - bw) < 1e-9 and a["game"]["block"]["w"] == min(60, bw + 2)
              and a["bits"] == 0 and vib == [16],
              f"[{tag}] a tap 26 CSS px in drops the block; near-perfect: it snaps whole, the next block {a['game']['block']['w']} wide, one 16 ms tick ({vib})")
    else:
        check(False, f"[{tag}] a near-perfect drop in 12 timed taps")

    # A landed drop with an overhang: the overhang breaks into bits, 8 ms.
    page.wait_for_timeout(60)
    page.evaluate("window.__vib = []")
    b, a = stack_tap_at(page, touch, 0.3 * ssnap(page)["game"]["block"]["w"])
    vib = page.evaluate("window.__vib")
    page.screenshot(path=str(OUT / f"stack-bits-{tag.split()[-1]}.png"))
    # The next block is the new floor's width, or the fresh 60 px block when that floor is under 12 px (PLAN §6d):
    # the untimed first-finger drop above can leave the tower narrow enough for that (X39).
    bw, fl, nb = b["game"]["block"]["w"], a["game"]["floors"][-1], a["game"]["block"]
    next_ok = (nb["w"] == 60 and nb["fresh"]) if fl["w"] < 12 else (abs(nb["w"] - fl["w"]) < 1e-9 and not nb["fresh"])
    check(a["lastDrop"]["kind"] == "land" and a["top"] == b["top"] + 1 and a["bits"] > 0 and vib == [8]
          and fl["w"] < bw and abs(fl["w"] - a["lastDrop"]["ratio"] * bw) < 1e-6 and next_ok,
          f"[{tag}] a landed drop: the overlap stays, the overhang falls as {a['bits']} bits, one 8 ms tick, the next block "
          f"{'the fresh 60 px one' if fl['w'] < 12 else 'the floor wide'} ({vib}, overlap {a['lastDrop']['ratio']:.2f} of {bw:.1f} px)")
    page.wait_for_timeout(1500)
    check(ssnap(page)["bits"] == 0, f"[{tag}] the bits are gone into the sea")

    # Narrow the tower, then a complete miss: no tick, the same block comes back, only the pace changes.
    for _ in range(8):
        q = ssnap(page)
        if q["game"]["block"]["fresh"]:
            stack_tap_at(page, touch, 0)
            continue
        w = q["game"]["floors"][-1]["w"]
        if 16 <= w <= 30:
            break
        stack_tap_at(page, touch, max(1, w - 24) if w > 30 else 0)
        page.wait_for_timeout(60)
    page.wait_for_timeout(200)
    q = ssnap(page)
    f = q["game"]["floors"][-1]
    page.evaluate("window.__vib = []")
    side = -1 if f["x"] > 135 - f["x"] - f["w"] else 1
    b, a = stack_tap_at(page, touch, side * (f["w"] / 2 + q["game"]["block"]["w"] / 2 + 6))
    ok_miss = a["lastDrop"]["kind"] == "miss"
    page.wait_for_function("window.__stack.snapshot().game.block.mode === 'slide'", timeout=5000)
    page.wait_for_timeout(50)
    c = ssnap(page)
    bg, cg = b["game"], c["game"]
    same = all(json.dumps(bg[k]) == json.dumps(cg[k]) for k in ("floors", "base", "shifts")) and cg["block"]["i"] == bg["block"]["i"] \
        and cg["block"]["w"] == bg["block"]["w"]
    check(ok_miss and same and cg["pace"] == max(40, bg["pace"] - 8) and page.evaluate("window.__vib") == [],
          f"[{tag}] a complete miss: the block plops into the sea and the same block comes back; no tick; tower and width unchanged; "
          f"pace {bg['pace']} -> {cg['pace']} ({a['lastDrop']['kind']})")

    # A floor narrower than 12 px: the next block is 60 wide and lands whole (8 ms).
    fresh_ok = False
    for _ in range(6):
        q = ssnap(page)
        if q["game"]["block"]["fresh"]:
            break
        w = q["game"]["floors"][-1]["w"]
        bw = q["game"]["block"]["w"]
        # overlap = bw - |offset| (block over a floor no narrower than it): aim for an overlap of 6 px
        stack_tap_at(page, touch, min(bw, w) - 6 + (bw - w) / 2 if bw >= w else bw - 6)
        page.wait_for_timeout(40)
    q = ssnap(page)
    if q["game"]["block"]["fresh"]:
        page.evaluate("window.__vib = []")
        b, a = stack_tap_at(page, touch, 30)
        vib = page.evaluate("window.__vib")
        fresh_ok = b["game"]["floors"][-1]["w"] < 12 and b["game"]["block"]["w"] == 60 and a["lastDrop"]["kind"] == "fresh" \
            and a["game"]["floors"][-1]["w"] == 60 and a["game"]["block"]["w"] == 60 and vib == [8]
    check(fresh_ok, f"[{tag}] a floor narrower than 12 px is followed by a 60 px block that lands whole as a fresh platform (8 ms)")

    at = page.evaluate("window.__vibAt")
    gaps = [y - x for x, y in zip(at, at[1:])]
    check(all(gp >= 40 - 0.5 for gp in gaps), f"[{tag}] at most one vibrate call per 40 ms")

    # Hidden: everything pauses at once, the clock stops; shown again it carries on.
    set_hidden(hub, True)
    set_hidden(page.frame, True)
    page.wait_for_timeout(50)
    h1 = ssnap(page)
    r1 = page.evaluate("window.__raf")
    page.wait_for_timeout(400)
    h2 = ssnap(page)
    check(not h2["raf"] and h2["game"]["block"]["x"] == h1["game"]["block"]["x"] and h2["clock"]["active"] == h1["clock"]["active"]
          and page.evaluate("window.__raf") == r1, f"[{tag}] hidden: paused, the block still, the clock still, no loop")
    touch.tap(180, 420, hold_ms=10)
    page.wait_for_timeout(40)
    check(ssnap(page)["top"] == h2["top"], f"[{tag}] hidden: a tap drops nothing")
    set_hidden(page.frame, False)
    set_hidden(hub, False)
    page.wait_for_timeout(200)
    h3 = ssnap(page)
    check(h3["raf"] and h3["game"]["block"]["x"] != h2["game"]["block"]["x"] and h3["clock"]["active"] > h2["clock"]["active"],
          f"[{tag}] shown again: it carries on where it was")
    page.evaluate("dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))")
    page.wait_for_timeout(50)
    p1 = ssnap(page)
    page.wait_for_timeout(300)
    p2 = ssnap(page)
    check(not p2["raf"] and p2["game"]["block"]["x"] == p1["game"]["block"]["x"], f"[{tag}] pagehide pauses")
    page.evaluate("dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))")
    page.wait_for_timeout(200)
    check(ssnap(page)["raf"], f"[{tag}] pageshow resumes")

    q = ssnap(page)
    hub_active = hub.evaluate("window.__rlxSession.active")
    check(q["clock"]["active"] > 30 + 3 and q["clock"]["active"] <= hub_active < q["clock"]["active"] + 1,
          f"[{tag}] the session clock counts Stack play in memory, on the hub's clock ({q['clock']['active']:.1f} s)")
    check(page.evaluate(STORAGE_JS) == stored0, f"[{tag}] nothing written to storage (localStorage, sessionStorage, IndexedDB, cookies)")
    # Hidden 5 minutes: the clock starts again, and so does the pace (the next block slides at 50).
    set_hidden(hub, True)
    set_hidden(page.frame, True)
    hub.evaluate("window.__rlxSession.hiddenAt = Date.now() - 5 * 60 * 1000")
    set_hidden(page.frame, False)
    set_hidden(hub, False)
    page.wait_for_timeout(100)
    q = ssnap(page)
    check(q["clock"]["active"] < 1 and q["clock"]["resets"] == 1 and q["game"]["pace"] == 50 and q["step"] == 0,
          f"[{tag}] hidden 5 minutes: the clock starts again and the pace is back at 50 ({q['game']['pace']})")

    # Opening Stack again always starts a new tower.
    back_to_hub(hub)
    page = open_tile(hub, "stack", 10000)
    q = ssnap(page)
    check(q["top"] == 0 and q["game"]["pace"] == 50 and q["game"]["floors"][0]["w"] == 60 and q["lastDrop"] is None,
          f"[{tag}] opening Stack from the hub again starts a new tower at speed 50")

    # Reduced motion: no bits; the camera jumps.
    page.emulate_media(reduced_motion="reduce")
    touch = Touch(ctx, page)
    seen = 0
    cuts = 0
    for _ in range(3):
        b, a = stack_tap_at(page, touch, 0.3 * ssnap(page)["game"]["block"]["w"])
        if a["lastDrop"]["kind"] == "land":
            cuts += 1
        seen = max(seen, a["bits"])
        page.wait_for_timeout(50)
    check(cuts > 0 and seen == 0, f"[{tag}] reduced motion: no bits over {cuts} cut drops")
    page.emulate_media(reduced_motion="no-preference")

    # Dusk: from minute 12 the block slides at 40, the scene at full dusk.
    stored0 = hub.evaluate(STORAGE_JS)
    page = open_stack(hub, base, 720)
    touch = Touch(ctx, page)
    page.wait_for_timeout(100)
    stack_tap_at(page, touch, 0)
    q = ssnap(page)
    page.screenshot(path=str(OUT / f"stack-dusk-{tag.split()[-1]}.png"))
    check(page.eval_on_selector("#screen", "c => c.dataset.scene") == "10" and q["ceiling"] == 40 and q["game"]["block"]["speed"] == 40
          and q["game"]["pace"] == 40, f"[{tag}] from minute 12: the scene at full dusk, the next block slides at 40")
    check(page.evaluate(STORAGE_JS) == stored0, f"[{tag}] at dusk too, nothing written to storage")

    check(not errors, f"[{tag}] no console errors {errors}")
    check(not foreign, f"[{tag}] no requests to another host {foreign}")
    ctx.close()


def run_contrast_stack(browser, base, scheme="light"):
    """Row S1: Stack's floors drawn in the brick-row tokens with their edge, at sunset, step 5 and step 10, on three heights."""
    for w, h, vtag in CONTRAST_VIEWS:
        vtag = vtag if scheme == "light" else f"{scheme}-{vtag}"
        ctx = new_context(browser, w, h, 3, scheme)
        page = ctx.new_page()
        page.goto(base)
        hits(page)
        tok = page.evaluate("""async () => {
          const T = await import(new URL('shared/tokens.js', document.baseURI).href);
          return { rows: T.BRICK_ROWS, edges: T.BRICK_ROWS.map(T.edge), pals: Array.from({ length: 11 }, (_, k) => T.scenePalette(k / 10)) };
        }""")
        for k, active in ((0, 0), (5, 300), (10, 720)):
            tag = f"contrast stack {vtag} step {k}"
            g_ = open_stack(page, base, active)
            page.wait_for_timeout(50)
            shot = OUT / f"s1-stack-{vtag}-{k}.png"
            page.screenshot(path=str(shot))
            q = ssnap(g_)
            hz = q["geo"]["horizon"]
            # Floor 0 (coral): its edge on the top row, its fill on the fifth; just below the horizon, the sea in front.
            got = stack_pixels(page, shot, q, [(67, hz - 8), (67, hz - 4), (67, hz)])
            sea0 = tok["pals"][k]["sea"][0]
            check(q["step"] == k and got[0] == tok["edges"][0] and got[1] == tok["rows"][0] and got[2] == sea0
                  and delta_e(tok["edges"][0], sea0) >= MIN_DE,
                  f"[{tag}] the first floor coral in its edge, standing on the horizon, the sea in front ({got})")
        ctx.close()


# Row D1: the theme follows the phone. The state of each game kept across a switch (what must not move).
THEME_STATE_JS = {
    "bricks": "(() => { const g = window.__bricks.snapshot().game; return JSON.stringify({ rows: g.rows, ball: g.ball, paddleX: g.paddleX, speed: g.speed, pace: g.pace }); })()",
    "catch": "(() => { const g = window.__catch.snapshot().game; return JSON.stringify(g); })()",
    "putt": "(() => { const q = window.__putt.snapshot(); return JSON.stringify({ level: q.level, ball: q.ball, levelNo: q.levelNo }); })()",
    "stack": "(() => { const g = window.__stack.snapshot().game; return JSON.stringify({ floors: g.floors, base: g.base, block: g.block.i, w: g.block.w }); })()",
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
        for name in GAMES:
            g_ = open_tile(page, name)
            g_.wait_for_timeout(200)
            got = game_corner(page, g_, name, f"d1-{name}-{scheme}.png")
            exp = want["sand"] if name == "putt" else want["sky"]
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
    for name in GAMES:
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
        if name in ("bricks", "catch"):  # a fresh, paused opening draws the same in both runs: no colour left over from light
            from PIL import Image, ImageChops
            diff = ImageChops.difference(Image.open(OUT / f"d1-switch-{name}-dark.png").convert("RGB"),
                                         Image.open(OUT / f"d1-{name}-dark.png").convert("RGB")).getbbox()
            check(diff is None, f"[{tag}] switched to dark, the frame equals the same opening made in dark, pixel for pixel ({diff})")
        exp = tok["dark"]["sand" if name == "putt" else "sky"]
        check(dark == exp, f"[{tag}] switched to dark with the game open: dark within two frames ({dark}, want {exp})")
        check(mid == before, f"[{tag}] the switch moves nothing in the game (state kept)")
        page.emulate_media(color_scheme="light")
        g_.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
        light = game_corner(page, g_, name, f"d1-switch-{name}-light.png")
        after = g_.evaluate(THEME_STATE_JS[name])
        check(light == tok["light"]["sand" if name == "putt" else "sky"] and after == before,
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
    "catch": "JSON.stringify(window.__catch.snapshot().game)",
    "putt": "(() => { const q = window.__putt.snapshot(); return JSON.stringify({ level: q.level, levelNo: q.levelNo, ball: q.ball, aiming: q.aiming, sliding: q.sliding, sinking: q.sinking }); })()",
    "stack": "(() => { const g = window.__stack.snapshot().game; const { x, dir, ...b } = g.block; return JSON.stringify({ ...g, block: b }); })()",
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
    for name in GAMES:
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
        exp = "sand" if name == "putt" else "sky"
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
      for (const k of ['__bricks', '__catch']) if (window[k]) return window[k].snapshot().view;
      if (window.__stack) { const g = window.__stack.snapshot().geo; return { scale: g.scale, H: g.H, ox: g.ox, oy: g.oy }; }
      if (window.__putt) { const g = window.__putt.snapshot().geo; return off(g.scale, g.H); }
      return null;
    }""")


GAMES = ("bricks", "catch", "putt", "stack")


GAME_READY = {
    "bricks": "window.__bricks && window.__bricks.snapshot().game",
    "catch": "window.__catch && window.__catch.snapshot().game",
    "putt": "window.__putt && window.__putt.snapshot().level",
    "stack": "window.__stack && window.__stack.snapshot().game",
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


def set_catch(page, js, arg=None):
    """Set up a scene in the live Catch state (paused): js is a function of (state, arg)."""
    page.evaluate("([src, arg]) => { const s = window.__catch.live(); (0, eval)(src)(s, arg); }", [js, arg])


def main():
    global MAX_AGE
    if "--max-age" in sys.argv:
        MAX_AGE = int(sys.argv[sys.argv.index("--max-age") + 1])
        print(f"serving with Cache-Control: max-age={MAX_AGE}")
    OUT.mkdir(parents=True, exist_ok=True)
    # --only a,b runs just the named parts (for a quick look while working; the full run is the check).
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    want = lambda name: only is None or name in only
    for name, fn in (("static", static_checks), ("android", android_checks), ("bricks-sim", run_node_sim), ("catch-sim", run_catch_sim),
                     ("putt-sim", run_putt_sim), ("stack-sim", run_stack_sim), ("haptics-native", run_haptics_native)):
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
                         ("catch", run_catch), ("putt", run_putt), ("putt-open", run_putt_open), ("stack", run_stack), ("contrast-hub", run_contrast_hub),
                         ("contrast-pages", run_contrast_pages), ("contrast-stack", run_contrast_stack),
                         ("theme", run_theme), ("theme-play", run_theme_play), ("contrast-hub-dark", lambda b, u: run_contrast_hub(b, u, "dark")),
                         ("contrast-pages-dark", lambda b, u: run_contrast_pages(b, u, "dark")),
                         ("contrast-stack-dark", lambda b, u: run_contrast_stack(b, u, "dark")),
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
