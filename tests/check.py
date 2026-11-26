#!/usr/bin/env python3
"""RLX checks (rows H1, B1, B2, C1, B4, U1, S1 and X1) in headless Chromium and Node. Not needed to run the app.

Needs Python Playwright with Chromium (pip install playwright;
python -m playwright install chromium). Run: python3 tests/check.py
Serves the repo under /4rk4d3/ (the GitHub Pages project subpath), then checks
both phone widths: pixels crisp, no scroll, the hub's tiles and nothing else,
each game opened over the hub by its tile and closed by the back gesture
(history back), old rlx.* keys cleared at start, the manifest fullscreen, the
service worker offline, cache version bump, no console errors, no requests to
another host. Row X1 throughout: no text, number or button on any game screen,
storage empty after play in every game, touches that begin within 24 CSS px
of a side edge ignored in every game, a fresh game on every opening, haptics
always on, one session clock in memory shared by the hub and every game it
opens (reset when the app starts and after 5 minutes hidden), Catch's drag on
the shared thumb travel, and a game opened by its tile allowed to vibrate at
once (real vibrate, real touch). Rows B1 and B2: tests/bricks-sim.mjs (physics
in Node) and Bricks in the browser: pause and resume, relative drag, haptics,
reduced motion, no loop while paused, the clock, the hub drawing the scene
phase, Bricks at full dusk. Row C1: tests/catch-sim.mjs and Catch with real
touch events (CDP): taps and fish, the pause grace, haptics, dusk. Row B4: the
contrast standard on the hub (wordmark, tiles) at sunset and all 10 steps on
logical heights 240, 300 and 400, and the drawn colours of the hub, Bricks and
Catch at sunset, step 5 and step 10 (see tests/contrast.mjs). Row U1:
tests/putt-sim.mjs and Putt with real touch events: a level at once and the
next built in a Web Worker, a cancelled pull, real shots planned with the
page's own sim.js until the ball drops (10, 6 and 24 ms ticks), the next level
sliding in with no wait, level 1 only from minute 10, a new level on every
opening, offline. Row S1: tests/stack-sim.mjs and Stack with real touch
events: a new tower on every opening, timed taps for a near-perfect drop (16
ms), a landed drop with bits (8 ms), a complete miss, a floor under 12 px
followed by a 60 px block, hidden and pagehide pause, reduced motion, dusk,
the drawn colours at sunset, step 5 and step 10.
Screenshots go to tests/out/.
"""
import functools
import http.server
import json
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
SHIPPED_EXCLUDE = {"docs", "tools", "tests", ".git", "README.md", ".gitignore", ".nojekyll"}
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
window.__raf = 0;
const __rafReal = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => { window.__raf++; return __rafReal(cb); };
"""


def new_context(browser, w, h, dpr=DPR):
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=dpr,
        is_mobile=True,
        has_touch=True,
        service_workers="allow",
    )
    ctx.add_init_script(VIBRATE_STUB)
    return ctx


def hits(page):
    page.wait_for_function("document.getElementById('screen').dataset.hits")
    return json.loads(page.eval_on_selector("#screen", "c => c.dataset.hits"))


def layout_of(page):
    hits(page)
    return json.loads(page.eval_on_selector("#screen", "c => c.dataset.layout"))


def hub_layout_checks(page, tag, h):
    """Tiles: top edge in the lower half, sun clear where room allows, one label size; tiles and nothing else."""
    lay = layout_of(page)
    H, r = lay["H"], lay["rects"]
    horizon = H - 42
    top = r["bricks"]["y"]
    bottom = r["stack"]["y"] + r["stack"]["h"]
    check(top * 2 >= H, f"[{tag}] first tile top edge {top} >= H/2 ({H}/2)")
    if H >= 270:
        check(bottom <= horizon - 28, f"[{tag}] sun fully clear of the tiles (tiles end {bottom}, sun top {horizon - 24})")
    else:
        check(bottom <= horizon - 12, f"[{tag}] at least half the sun clear of the tiles (tiles end {bottom}, horizon {horizon})")
    labels = json.loads(page.eval_on_selector("#screen", "c => c.dataset.labels"))
    check(len(set(labels.values())) == 1 and 0 not in labels.values(), f"[{tag}] all tile labels drawn at one size {labels}")
    # Row X1: the hub is the game tiles and nothing else: one active tile per built game, no switch, no setting.
    check(sorted(hits(page)) == sorted(GAMES) and sorted(labels) == sorted(GAMES),
          f"[{tag}] the hub has one tile per built game and nothing else {sorted(hits(page))}")
    return lay


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

    # Navigation: each tile opens its game over the hub; the back gesture (history back) returns.
    hlen = page.evaluate("history.length")
    for game in GAMES:
        g = open_tile(page, game)
        page.wait_for_timeout(150)
        page.screenshot(path=str(OUT / f"{game}-{tag}.png"))
        shown = page.evaluate("(() => { const f = document.querySelector('iframe.game'); const r = f.getBoundingClientRect(); "
                              "return { shown: f.classList.contains('shown'), w: r.width, h: r.height, n: document.querySelectorAll('iframe').length }; })()")
        check(page.url == base and shown == {"shown": True, "w": w, "h": h, "n": 1},
              f"[{tag}] tap {game.upper()} opens {game} full screen over the hub (the page stays the hub) {shown}")
        no_hud(g, tag, game)
        back_to_hub(page)
        check(page.url == base and page.evaluate("document.querySelectorAll('iframe').length") == 0,
              f"[{tag}] back gesture (history back) returns from {game} to the hub, the game gone")
    check(page.evaluate("history.length") == hlen + 1, f"[{tag}] going in and out of games leaves one history entry above the hub")

    # Only tiles open games: a tap on the open sky between the wordmark and the tiles opens nothing.
    sky_y = hits(page)["bricks"]["y"] * 0.6
    page.touchscreen.tap(180, sky_y)
    page.wait_for_timeout(300)
    check(page.url == base and page.evaluate("document.querySelectorAll('iframe').length") == 0,
          f"[{tag}] a tap on the hub's open sky ({sky_y:.0f} CSS px) opens nothing")
    # A touch that starts on a tile and slides off it opens nothing (the frame made on touch is dropped).
    p0 = hits(page)["catch"]
    cdp = ctx.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": p0["x"], "y": p0["y"]}]})
    page.wait_for_timeout(60)
    made = page.evaluate("document.querySelectorAll('iframe').length")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": p0["x"], "y": sky_y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(200)
    check(made == 1 and page.evaluate("document.querySelectorAll('iframe').length") == 0 and not page.evaluate("document.body.dataset.game || ''"),
          f"[{tag}] a touch that slides off its tile opens nothing")
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
    check(bad == 0 and info["sw"] <= info["iw"] and info["sh"] <= info["ih"] and lv["H"] == H and lv["y1"] + 3 == H - 26 - ps["geo"]["bottom"]
          and lv["y0"] - 3 == 6 + ps["geo"]["top"] and lv["x0"] - 3 == 6 and lv["x1"] + 3 == 129,
          f"[{tag}] Putt: crisp, no overflow, the course inset 6 px at the sides and top, 26 px above the bottom (H {H})")
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

    # Font: one rounding rule for every glyph (no uncut L-corner).
    src = (ROOT / "shared" / "font.js").read_text()
    body = src[src.index("export const GLYPHS"):]
    bad = []
    for key, rows in re.findall(r"'(.)':\s*\[([^\]]*)\]", body):
        g = re.findall(r"'([.#]+)'", rows)
        ink = lambda r, c: 0 <= r < len(g) and 0 <= c < len(g[0]) and g[r][c] == "#"  # noqa: E731
        for r in range(len(g)):
            for c in range(len(g[0])):
                if ink(r, c) and ink(r, c - 1) + ink(r, c + 1) == 1 and ink(r - 1, c) + ink(r + 1, c) == 1:
                    bad.append((key, r, c))
    check(not bad, f"font: every outer corner is cut {bad}")
    needed = set("RLXBRICKSCATCHPUTTSTACK")
    check(needed <= set(re.findall(r"'(.)':", body)), "font has every character the UI uses (the wordmark and the tile labels)")

    # Row X1: no settings, no storage module, fullscreen; text is drawn on the hub only.
    check(not (ROOT / "shared" / "settings.js").exists() and not (ROOT / "shared" / "store.js").exists(),
          "shared/settings.js and shared/store.js are gone (row X1)")
    manifest = json.loads((ROOT / "manifest.webmanifest").read_text())
    check(manifest["display"] == "fullscreen", f"manifest display is fullscreen ({manifest['display']})")
    shipped_js = [p for p in list((ROOT / "shared").glob("*.js")) + list((ROOT / "games").rglob("*.js")) + [ROOT / "index.html"]]
    uses = {p.relative_to(ROOT).as_posix() for p in shipped_js
            if re.search(r"localStorage|sessionStorage|indexedDB|document\.cookie|settings\.js|store\.js|hapticsOn|setHaptics",
                         re.sub(r"//.*", "", p.read_text()))}
    check(uses == {"shared/pixel.js"}, f"only pixel.js touches storage (to clear old rlx.* keys); nothing else reads a setting {sorted(uses)}")
    texty = {p.relative_to(ROOT).as_posix() for p in shipped_js if re.search(r"font\.js|drawFitted|drawText|fillText", re.sub(r"//.*", "", p.read_text()))}
    check(texty == {"index.html", "shared/font.js"}, f"text is drawn on the hub only (no game imports the font) {sorted(texty)}")
    hub = (ROOT / "index.html").read_text()
    check(not re.search(r"SOON|HAPTICS|haptics|TOGGLE|TAG_", hub), "the hub has no SOON tile code and no haptics switch (row X1)")


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

    # Lift: frozen within one frame, ring shown.
    page.mouse.up()
    a = snap(page)
    page.wait_for_timeout(300)
    b = snap(page)
    check(a["mode"] == "paused" and a["game"]["ball"] == b["game"]["ball"] and a["game"]["time"] == b["game"]["time"],
          f"[{tag}] lifting the thumb freezes play at once")
    r1 = page.evaluate("window.__raf")
    page.wait_for_timeout(400)
    check(page.evaluate("window.__raf") == r1, f"[{tag}] no animation loop while paused")
    page.screenshot(path=str(OUT / "bricks-game-lifted.png"))
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
        hz = lay["H"] - 42
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
    s1 = r["bricks"]["y"] - 3
    star = (22, round(42 + 0.05 * (s1 - 42)))
    top, sea, sun, st, tile = logical_pixels(page, shot, [(1, 1), (1, hz + 2), (96, hz - 1), star, (r["bricks"]["x"] + 3, r["bricks"]["y"] + 6)])
    check(step == 10 and top == "#CDB8E0" and sea == "#6FA3C4" and bad == 0,
          f"[{tag}] hub after 12 minutes of play: full dusk, crisp ({step}, sky {top}, sea {sea}, {total - bad}/{total})")
    check(sun != C["sun"] and st == "#FFFFFF" and tile == C["coral"],
          f"[{tag}] hub at dusk: sun below the horizon ({sun}), a white star ({st}), the BRICKS tile keeps its colour ({tile})")
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
    edgeCoral: edge(C.coral), soonFill: T.mix(C.skyBottom, C.cloud, 0.45),
    // B4 review: keel, glint and ink cloud (absent before it: null, so old tokens fail cleanly).
    keel: C.keel || null, glint: C.glint || null,
    inked: Array.from({ length: 11 }, (_, k) => T.scenePalette(k / 10).sea.map((c) => T.mix(c, C.inkCloud || T.shade(C.blue), T.INK_CLOUD_AMOUNT || 0.35))),
  };
}"""

# Logical heights 240, 300 and 400 at 360 CSS px wide, DPR 3 (scale 8).
CONTRAST_VIEWS = [(360, 640, "H240"), (360, 800, "H300"), (360, 1067, "H400")]


def run_contrast_hub(browser, base):
    """Row B4: the hub's wordmark and tiles against the scene at sunset and all 10 steps."""
    for w, h, tag in CONTRAST_VIEWS:
        tag = f"contrast hub {tag}"
        ctx = new_context(browser, w, h, 3)
        page = ctx.new_page()
        page.goto(base)
        lay = layout_of(page)
        tok = page.evaluate(HUB_TOKENS_JS)
        C, H, r = tok["C"], lay["H"], lay["rects"]
        horizon = H - 42

        def bands(y0, y1):
            return [i for i in range(tok["bands"]) if round(i * horizon / 10) < y1 and round((i + 1) * horizon / 10) > y0]

        rows = []
        for k in range(11):
            pal = tok["pals"][k]
            sun = [("sun", C["sun"])] if k < 10 else []
            sky = lambda ix: [(f"sky band {i + 1}", pal["sky"][i]) for i in ix]  # noqa: E731
            items = [("wordmark (large)", "cr", MIN_CR, C["coral"], tok["edgeCoral"], sky(bands(12, 40)))]
            for t in GAMES:
                items.append((f"{t} tile", "cr", MIN_CR, C["coral"], tok["edgeCoral"], sky(bands(r[t]["y"], r[t]["y"] + r[t]["h"])) + sun))
            for what, rule, need, fill, edge_, bgs in items:
                m = contrast if rule == "cr" else delta_e
                for on, bg in bgs:
                    rows.append((what, need, max(m(fill, bg), m(edge_, bg)), on, bg, k))
        under = [x for x in rows if x[2] < x[1]]
        worst = min(rows, key=lambda x: x[2] / x[1])
        check(rows and not under, f"[{tag}] sunset and all 10 steps: wordmark and tiles (fill or edge) meet the B4 standard "
              f"(weakest {worst[0]} on {worst[3]} {worst[4]} step {worst[5]}: {worst[2]:.2f}; {len(under)} under {under[:3]})")
        labels = json.loads(page.eval_on_selector("#screen", "c => c.dataset.labels"))
        size = min(labels.values())
        # The tile labels as drawn (B4 review): scan each row of the label's left half for the first
        # outline pixel and take the pixel just right of it; the commonest such colour is the glyph. The
        # label is measured against its outline (small lettering 4.5 at size 1, 3 at larger sizes).
        shot = OUT / f"b4-hub-labels-{tag.split()[-1]}.png"
        page.screenshot(path=str(shot))
        glyphs, outlines = {}, set()
        for t in GAMES:
            rt = r[t]
            ys = list(range(rt["y"] + 2, rt["y"] + rt["h"] - 2))
            xs = list(range(rt["x"] + 2, rt["x"] + rt["w"] // 2))
            px = logical_pixels(page, shot, [(x, y) for y in ys for x in xs])
            for j in range(len(ys)):
                row = px[j * len(xs):(j + 1) * len(xs)]
                for i in range(len(row) - 1):
                    if row[i] == tok["edgeCoral"]:
                        outlines.add(row[i])
                        if row[i + 1] != tok["edgeCoral"]:
                            glyphs[row[i + 1]] = glyphs.get(row[i + 1], 0) + 1
                        break
        glyph = max(glyphs, key=glyphs.get) if glyphs else None
        outline = tok["edgeCoral"] if outlines else None
        label_cr = contrast(glyph, outline) if glyph and outline else 0
        check(glyph == C["cloud"] and outline == tok["edgeCoral"], f"[{tag}] tile labels drawn white in a 1 px outline of the coral's edge "
              f"(sampled glyph {glyph}, outline {outline}, {glyphs})")
        need = MIN_CR if size >= 2 else MIN_CR_SMALL
        check(label_cr >= need, f"[{tag}] tile labels (size {size}) on their outline: contrast {label_cr:.2f} >= {need}")
        ctx.close()


def run_contrast_pages(browser, base):
    """Row B4: the drawn colours of the hub, Bricks and Catch at sunset, step 5 and step 10 (games opened from the hub)."""
    for w, h, vtag in CONTRAST_VIEWS:
        ctx = new_context(browser, w, h, 3)
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
            bt = r["bricks"]
            word = [(x, y) for y in range(11, 42) for x in range(135)]
            got = logical_pixels(page, shot, word + [(bt["x"] + 3, bt["y"]), (bt["x"] + 3, bt["y"] + 6)])
            wm, rest = set(got[:len(word)]), got[len(word):]
            check(page.eval_on_selector("#screen", "c => c.dataset.scene") == str(k) and C["coral"] in wm and tok["edgeCoral"] in wm
                  and rest == [tok["edgeCoral"], C["coral"]],
                  f"[{tag}] hub: wordmark coral in its edge, tile coral in its edge ({rest})")
            # Bricks: paddle edge and fill, the pause ring in its ink ring.
            g_ = open_tile(page, "bricks")
            page.wait_for_timeout(150)
            q = snap(g_)
            g = q["game"]
            geo = g["geo"]
            shot = OUT / f"b4-bricks-{vtag}-{k}.png"
            page.screenshot(path=str(shot))
            px, py = round(g["paddleX"]), geo["paddleY"]
            ring_y = min(geo["horizon"] + 21, q["view"]["H"] - 7 - 2)
            got = logical_pixels(g_, shot, [(px + 15, py), (px + 15, py + 3), (67, ring_y - 8), (67, ring_y - 7)])
            check(q["step"] == k and q["mode"] == "paused" and got == [tok["edgeCoral"], C["coral"], C["ink"], C["cloud"]],
                  f"[{tag}] Bricks: paddle coral in its edge, pause ring white in an ink ring ({got})")
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
            check(q["step"] == k and got == [tok["edgeCoral"], C["coral"], C["sail"], tok["edgeCoral"]],
                  f"[{tag}] Catch: hull coral in its edge, sail in its own colour, mast in the edge ({got})")
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
    check(a["lastDrop"]["kind"] == "land" and a["top"] == b["top"] + 1 and a["bits"] > 0 and vib == [8]
          and a["game"]["block"]["w"] < b["game"]["block"]["w"],
          f"[{tag}] a landed drop: the overlap stays, the overhang falls as {a['bits']} bits, one 8 ms tick ({vib}, overlap {a['lastDrop']['ratio']:.2f})")
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


def run_contrast_stack(browser, base):
    """Row S1: Stack's floors drawn in the brick-row tokens with their edge, at sunset, step 5 and step 10, on three heights."""
    for w, h, vtag in CONTRAST_VIEWS:
        ctx = new_context(browser, w, h, 3)
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
    hub.write_text(hub.read_text().replace("<title>RLX</title>", "<title>RLX new</title>"))
    page.reload()  # navigation triggers the update check
    deadline = time.time() + 10
    after = before
    while time.time() < deadline:
        after = page.evaluate("caches.keys()")
        if after == [nxt]:
            break
        page.wait_for_timeout(200)
    check(before == [SW_VERSION] and after == [nxt], f"version bump replaces the cache {before} -> {after}")
    page.reload()
    page.wait_for_timeout(300)
    check(page.title() == "RLX new", f"after the bump the next load serves the new deploy ({page.title()})")
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
        if f.url.split("?")[0].endswith(f"/games/{name}/"):
            return f
    return None


def open_tile(page, name, timeout=20000):
    """Tap a hub tile, wait for the game's frame to show and the game to be ready. Returns a Hosted."""
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
           hud: c.dataset.hud || null, hits: c.dataset.hits || null, layout: c.dataset.layout || null };
}"""


def no_hud(page, tag, what):
    d = page.evaluate(SCREEN_DOM_JS)
    check(d == {"odd": [], "text": "", "buttons": 0, "hud": None, "hits": None, "layout": None},
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
    static_checks()
    run_node_sim()
    run_catch_sim()
    run_putt_sim()
    run_stack_sim()
    httpd, base = serve(ROOT)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h, dpr in FULL:
            run_viewport(browser, base, w, h)
        for w, h, dpr in LAYOUT_ONLY:
            run_layout_only(browser, base, w, h, dpr)
        run_resize(browser, base)
        run_bricks(browser, base)
        run_scene(browser, base)
        run_catch(browser, base)
        run_putt(browser, base)
        run_stack(browser, base)
        run_contrast_hub(browser, base)
        run_contrast_pages(browser, base)
        run_contrast_stack(browser, base)
        run_activation(browser, base)
        run_version_bump(browser)
        browser.close()
    httpd.shutdown()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
