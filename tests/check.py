#!/usr/bin/env python3
"""RLX row H1 checks in headless Chromium. Not needed to run the app.

Needs Python Playwright with Chromium (pip install playwright;
python -m playwright install chromium). Run: python3 tests/check.py
Serves the repo under /4rk4d3/ (the GitHub Pages project subpath), then checks
both phone widths: pixels crisp, no scroll, navigation by tap and by back,
haptics setting persists, service worker offline, cache version bump, no
console errors, no requests to another host. Screenshots go to tests/out/.
"""
import functools
import http.server
import json
import pathlib
import shutil
import socketserver
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
Object.defineProperty(Navigator.prototype, 'vibrate', {
  configurable: true,
  value: function (p) { window.__vib.push(p); return true; },
});
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
    """Tiles: top edge in the lower half, sun clear where room allows, one label size."""
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
    check(r["haptics"]["y"] + r["haptics"]["h"] <= H, f"[{tag}] haptics control inside the screen")
    return lay


def tap(page, name):
    p = hits(page)[name]
    page.touchscreen.tap(p["x"], p["y"])


def crisp(page, shot_path):
    """Every logical pixel must be a uniform scale x scale block in the screenshot."""
    from PIL import Image

    info = page.evaluate("""() => {
      const c = document.getElementById('screen');
      return { cw: c.width, ch: c.height, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio,
               sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
    }""")
    img = Image.open(shot_path).convert("RGB")
    s = layout_of(page)["scale"]
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

    # Navigation: tap BRICKS, back gesture (history back), tap again, back control.
    tap(page, "bricks")
    page.wait_for_url("**/games/bricks/")
    hits(page)
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / f"bricks-{tag}.png"))
    check(page.url.endswith("/4rk4d3/games/bricks/"), f"[{tag}] tap BRICKS opens the placeholder")
    page.go_back()
    page.wait_for_url(base)
    hits(page)
    check(page.url == base, f"[{tag}] back gesture (history back) returns to the hub")
    tap(page, "bricks")
    page.wait_for_url("**/games/bricks/")
    hlen = page.evaluate("history.length")
    tap(page, "back")
    page.wait_for_url(base)
    hits(page)
    check(page.url == base, f"[{tag}] back control returns to the hub")
    page.wait_for_timeout(100)
    check(page.evaluate("history.length") == hlen, f"[{tag}] back control does not grow history")
    # Direct open of the placeholder, then the back control: lands on the hub.
    page.goto(base + "games/bricks/")
    tap(page, "back")
    page.wait_for_url(base)
    check(page.url == base, f"[{tag}] back control from a directly opened game goes to the hub")

    # SOON tiles are not tappable.
    tap(page, "catch")
    page.wait_for_timeout(300)
    check(page.url == base, f"[{tag}] CATCH (SOON) is not tappable")

    # Haptics: default on; off persists; on fires one test tick and persists.
    page.evaluate("localStorage.clear()")
    page.reload()
    hits(page)
    tap(page, "haptics")
    page.wait_for_timeout(100)
    stored = page.evaluate("localStorage.getItem('rlx.v1.settings')")
    check(stored == '{"haptics":false}', f"[{tag}] haptics OFF stored under a versioned key ({stored})")
    check(page.evaluate("window.__vib.length") == 0, f"[{tag}] switching off does not vibrate")
    page.reload()
    hits(page)
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / f"hub-off-{tag}.png"))
    check(page.evaluate("localStorage.getItem('rlx.v1.settings')") == '{"haptics":false}', f"[{tag}] haptics OFF survives reload")
    tap(page, "haptics")
    page.wait_for_timeout(100)
    vib = page.evaluate("window.__vib")
    check(vib == [16], f"[{tag}] switching on fires exactly one test tick ({vib})")
    page.reload()
    hits(page)
    check(page.evaluate("localStorage.getItem('rlx.v1.settings')") == '{"haptics":true}', f"[{tag}] haptics ON survives reload")
    # Broken storage value does not throw and falls back to the default (on).
    n_err = len(errors)
    page.evaluate("localStorage.setItem('rlx.v1.settings', '{nope')")
    page.reload()
    hits(page)
    page.evaluate("window.__vib = []")
    tap(page, "haptics")  # default on, so this switches off: no vibrate
    page.wait_for_timeout(100)
    check(len(errors) == n_err and page.evaluate("localStorage.getItem('rlx.v1.settings')") == '{"haptics":false}'
          and page.evaluate("window.__vib.length") == 0,
          f"[{tag}] corrupt stored setting: no error, read as the default ON")
    tap(page, "haptics")
    page.wait_for_timeout(100)

    # Service worker and offline.
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    hits(page)
    controlled = page.evaluate("!!navigator.serviceWorker.controller")
    keys = page.evaluate("caches.keys()")
    check(controlled, f"[{tag}] service worker controls the page")
    check(keys == [SW_VERSION], f"[{tag}] one versioned cache {keys}")
    manifest = page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())")
    check(manifest["display"] == "standalone" and manifest["orientation"] == "portrait", f"[{tag}] manifest standalone, portrait")
    cdp = ctx.new_cdp_session(page)
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
    tap(page, "bricks")
    page.wait_for_url("**/games/bricks/")
    back_hit = hits(page).get("back")
    check(page.url == base + "games/bricks/" and back_hit is not None, f"[{tag}] placeholder opens and draws offline")
    page.go_back()
    page.wait_for_url(base)
    # Slash-less folder URL, offline then online, with the worker in control.
    for mode in ("offline", "online"):
        ctx.set_offline(mode == "offline")
        page.goto(base + "games/bricks")
        page.wait_for_url("**/games/bricks/")
        ok = hits(page).get("back") is not None
        check(page.url == base + "games/bricks/" and ok, f"[{tag}] slash-less games/bricks redirects and draws ({mode})")
        tap(page, "back")
        page.wait_for_url(base)
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
    hits(page)
    page.screenshot(path=str(OUT / f"bricks-{w}x{h}.png"))
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
    tap(page, "bricks")
    page.wait_for_url("**/games/bricks/")
    check(page.url == base + "games/bricks/", "resize: BRICKS still opens from the new layout")
    page.go_back()
    page.wait_for_url(base)
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
    needed = set("RLXBRICKSCATCHSTACKSOONHAPTICSONOFF<")
    check(needed <= set(re.findall(r"'(.)':", body)), "font has every character the UI uses")


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


def main():
    global MAX_AGE
    if "--max-age" in sys.argv:
        MAX_AGE = int(sys.argv[sys.argv.index("--max-age") + 1])
        print(f"serving with Cache-Control: max-age={MAX_AGE}")
    OUT.mkdir(parents=True, exist_ok=True)
    static_checks()
    httpd, base = serve(ROOT)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h, dpr in FULL:
            run_viewport(browser, base, w, h)
        for w, h, dpr in LAYOUT_ONLY:
            run_layout_only(browser, base, w, h, dpr)
        run_resize(browser, base)
        run_version_bump(browser)
        browser.close()
    httpd.shutdown()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
