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
VIEWPORTS = [(360, 800), (412, 915), (360, 640)]
DPR = 2.625
FAILS = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
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


def new_context(browser, w, h):
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=DPR,
        is_mobile=True,
        has_touch=True,
        service_workers="allow",
    )
    ctx.add_init_script(VIBRATE_STUB)
    return ctx


def hits(page):
    page.wait_for_function("document.getElementById('screen').dataset.hits")
    return json.loads(page.eval_on_selector("#screen", "c => c.dataset.hits"))


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
    s = info["cw"] // 135
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
    tiles = hits(page)
    check(tiles["bricks"]["y"] > h / 2 and tiles["stack"]["y"] > h / 2, f"[{tag}] tiles sit in the lower half")

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
    # Broken storage value does not throw.
    page.evaluate("localStorage.setItem('rlx.v1.settings', '{nope')")
    page.reload()
    hits(page)

    # Service worker and offline.
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    hits(page)
    controlled = page.evaluate("!!navigator.serviceWorker.controller")
    keys = page.evaluate("caches.keys()")
    check(controlled, f"[{tag}] service worker controls the page")
    check(keys == ["rlx-v1"], f"[{tag}] one versioned cache {keys}")
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
    hits(page)
    check(True, f"[{tag}] placeholder opens offline")
    page.go_back()
    page.wait_for_url(base)
    ctx.set_offline(False)

    check(not errors, f"[{tag}] no console errors {errors}")
    check(not foreign, f"[{tag}] no requests to another host {foreign}")
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
    sw.write_text(sw.read_text().replace("const VERSION = 'rlx-v1';", "const VERSION = 'rlx-v2';"))
    # Change a shipped file so we can see the new deploy arrive.
    hub = site / "index.html"
    hub.write_text(hub.read_text().replace("<title>RLX</title>", "<title>RLX new</title>"))
    page.reload()  # navigation triggers the update check
    deadline = time.time() + 10
    after = before
    while time.time() < deadline:
        after = page.evaluate("caches.keys()")
        if after == ["rlx-v2"]:
            break
        page.wait_for_timeout(200)
    check(before == ["rlx-v1"] and after == ["rlx-v2"], f"version bump replaces the cache {before} -> {after}")
    page.reload()
    page.wait_for_timeout(300)
    check(page.title() == "RLX new", f"after the bump the next load serves the new deploy ({page.title()})")
    ctx.close()
    httpd.shutdown()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    httpd, base = serve(ROOT)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h in VIEWPORTS:
            run_viewport(browser, base, w, h)
        run_version_bump(browser)
        browser.close()
    httpd.shutdown()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
