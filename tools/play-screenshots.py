#!/usr/bin/env python3
"""Make the Play Store phone screenshots (row P3, PLAN §6f): 1080 x 1920 PNG (9:16), no alpha.

Play refuses a screenshot whose long side is more than twice its short side, so 9:16, not a
20:9 phone screen.

Not shipped. Needs Python Playwright with Chromium and Pillow. Serves the repo,
opens the real hub at 360 x 640 CSS px, device scale 3 (logical scale 8), taps
each card and plays with real touch events (CDP), then saves the screen into
docs/play/screenshots/. Run: python3 tools/play-screenshots.py
"""
import functools
import http.server
import pathlib
import socketserver
import threading
import time

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "play" / "screenshots"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


class Touch:
    def __init__(self, page):
        self.cdp = page.context.new_cdp_session(page)

    def send(self, kind, x=None, y=None):
        pts = [] if kind == "touchEnd" else [{"x": x, "y": y}]
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})

    def tap(self, x, y):
        self.send("touchStart", x, y)
        self.send("touchEnd")


def card_centre(page, name):
    return page.evaluate("""(name) => {
      const c = document.getElementById('screen'); const g = JSON.parse(c.dataset.grid); const r = g.cards[name];
      const box = c.getBoundingClientRect(); const k = box.width / c.width;
      const s = Math.floor(c.width / 135); const ox = Math.floor((c.width - 135 * s) / 2);
      return { x: (ox + (r.x + r.w / 2) * s) * k, y: (r.y + r.h / 2) * s * k };
    }""", name)


def open_game(page, touch, name):
    p = card_centre(page, name)
    touch.tap(p["x"], p["y"])
    page.wait_for_function(f"document.body.dataset.game === '{name}'")
    page.wait_for_timeout(800)


def save(page, name):
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path))
    im = Image.open(path).convert("RGB")
    assert im.size == (1080, 1920), im.size
    im.save(path, optimize=True)
    print("wrote", path.relative_to(ROOT))


def back(page):
    page.go_back()
    page.wait_for_function("!document.body.dataset.game && !document.querySelector('iframe')")
    page.wait_for_timeout(300)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    httpd, base = serve()
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 360, "height": 640}, device_scale_factor=3, is_mobile=True, has_touch=True,
                            service_workers="block")
        page = ctx.new_page()
        page.goto(base + "index.html")
        page.wait_for_function("document.getElementById('screen').dataset.grid")
        page.wait_for_timeout(500)
        touch = Touch(page)
        save(page, "1-hub")

        # Bricks: the thumb down on the sea, sweeping slowly, the ball in flight.
        open_game(page, touch, "bricks")
        touch.send("touchStart", 180, 592)
        x = 180
        for i in range(160):
            x = 180 + 40 * ((i // 40) % 2 * 2 - 1) * ((i % 40) / 40)
            touch.send("touchMove", x, 592)
            page.wait_for_timeout(25)
        save(page, "2-bricks")
        touch.send("touchEnd")
        back(page)

        # Catch: the thumb down, the boat drifting, things falling.
        open_game(page, touch, "catch")
        touch.send("touchStart", 180, 592)
        for i in range(200):
            touch.send("touchMove", 160 + 40 * ((i // 50) % 2), 592)
            page.wait_for_timeout(25)
        save(page, "3-catch")
        touch.send("touchEnd")
        back(page)

        # Putt: a shot being lined up (pull back and hold).
        open_game(page, touch, "putt")
        page.wait_for_timeout(1500)
        touch.send("touchStart", 180, 480)
        for i in range(1, 21):
            touch.send("touchMove", 180 + i * 2.2, 480 + i * 6)
            page.wait_for_timeout(16)
        page.wait_for_timeout(200)
        save(page, "4-putt")
        touch.send("touchMove", 180, 484)  # back near the start: the shot is cancelled
        touch.send("touchEnd")
        back(page)

        # Stack: a few floors, a little later in the evening (step 4 of the exit ramp).
        page.evaluate("""() => { const c = window.__rlxSession; c.active = 240; c.hiddenAt = null;
          dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })); }""")
        open_game(page, touch, "stack")
        fr = next(f for f in page.frames if "/games/stack/" in f.url)
        for i in range(9):
            # drop when the block is near the middle, so most floors land well
            deadline = time.time() + 4
            while time.time() < deadline:
                st = fr.evaluate("window.__stack.snapshot().game")
                blk = st.get("block") or {}
                bx, bw = blk.get("x"), blk.get("w")
                top = st["floors"][-1]
                aim = (i % 3) - 1  # a little off now and then, so the tower is not a perfect column
                if bx is not None and abs((bx + bw / 2) - (top["x"] + top["w"] / 2) - aim * 4) < 2:
                    break
                page.wait_for_timeout(10)
            touch.tap(180, 320)
            page.wait_for_timeout(450)
        page.wait_for_timeout(600)
        save(page, "5-stack")
        back(page)
        b.close()
    httpd.shutdown()


if __name__ == "__main__":
    main()
