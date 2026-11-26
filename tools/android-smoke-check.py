#!/usr/bin/env python3
"""Judge the rlx emulator smoke run (tools/android-smoke.sh; PLAN §6f). Not part of the app.

Fails on: the hub not drawn (sky-top at the top of the screen), a card not opening its game,
back not returning to the hub, back at the hub not leaving the app, a page error in logcat
(the debug build logs the pages' console), a network error. Reports, without failing, whether
the vibrator log shows the app's vibrations (an emulator may have no vibrator).
"""
import pathlib
import re
import sys

from PIL import Image, ImageChops, ImageStat

OUT = pathlib.Path(sys.argv[1])
PKG = "io.github.apcanario.rlx"
FAILS = []


def check(ok, what):
    print(("PASS " if ok else "FAIL ") + what)
    if not ok:
        FAILS.append(what)


def img(name):
    return Image.open(OUT / f"{name}.png").convert("RGB")


def diff(a, b):
    """Mean absolute difference over the lower 70 percent of the screen (where the cards are), 0..255."""
    w, h = a.size
    box = (0, int(h * 0.3), w, h)
    return sum(ImageStat.Stat(ImageChops.difference(a.crop(box), b.crop(box))).mean) / 3


def near(c, hexc, tol=8):
    t = tuple(int(hexc[i:i + 2], 16) for i in (1, 3, 5))
    return all(abs(x - y) <= tol for x, y in zip(c, t))


import base64
import io

for name in ("1-hub", "2-stack", "3-stack-dropped", "4-hub-after-back", "5-bricks", "6-hub-after-back", "7-after-second-back"):
    try:
        small = Image.open(OUT / f"{name}.png").convert("RGB").resize((135, 300), Image.NEAREST)
        buf = io.BytesIO()
        small.save(buf, "PNG", optimize=True)
        print(f"SHOT {name} " + base64.b64encode(buf.getvalue()).decode())
    except OSError as err:
        print(f"SHOT {name} missing ({err})")

hub = img("1-hub")
w, h = hub.size
print(f"screen {w}x{h}")
top = hub.getpixel((w // 4, int(h * 0.06)))
check(near(top, "#FFF7EC"), f"the hub is drawn: sky-top near the top of the screen ({'#%02X%02X%02X' % top})")
colours = hub.resize((w // 8, h // 8), Image.NEAREST).getcolors(1 << 20) or []
check(any(near(c, "#F05A68", 4) for _, c in colours), "the hub shows the coral card frames")

stack, back1, bricks, back2 = img("2-stack"), img("4-hub-after-back"), img("5-bricks"), img("6-hub-after-back")
d_stack, d_back1, d_bricks, d_back2 = diff(hub, stack), diff(hub, back1), diff(hub, bricks), diff(hub, back2)
print(f"differences from the hub: stack {d_stack:.1f}, after back {d_back1:.1f}, bricks {d_bricks:.1f}, after back {d_back2:.1f}")
check(d_stack > 15, "a tap on the Stack card opens Stack full screen (the screen changes)")
check(d_back1 < 4, "one back from Stack returns to the hub")
check(d_bricks > 15, "a tap on the Bricks card opens Bricks")
check(d_back2 < 4, "one back from Bricks returns to the hub")

act = (OUT / "activity.txt").read_text().splitlines()
print("\n".join(act))
check(all(PKG in line for line in act[:4]), "the app stays in front through the game and the backs to the hub")
check(len(act) >= 5 and PKG not in act[4], "back at the hub leaves the app")

log = (OUT / "logcat.txt").read_text(errors="replace")
console = [line for line in log.splitlines() if "Capacitor/Console" in line]
# Capacitor's own SystemBars script can run before the document exists ("Error injecting safe area CSS"); it is
# Capacitor's, retried on the next insets pass, and not a page error.
errors = [line for line in console if re.search(r"\bE Capacitor/Console|Uncaught|TypeError|ReferenceError|SyntaxError", line)
          and "Error injecting safe area CSS" not in line]
pid = None
m = re.search(r"Start proc (\d+):" + re.escape(PKG) + r"/", log)
if m:
    pid = m.group(1)
app_lines = [line for line in log.splitlines() if pid and re.match(r"\S+ \S+\s+" + pid + r"\s", line)]
neterr = [line for line in app_lines if "net::ERR_" in line]
print(f"app pid {pid}, {len(app_lines)} log lines from it")
for line in [l for l in log.splitlines() if " RLX" in l or "RLX  " in l][:12]:
    print("LOG " + line)
print(f"{len(console)} console lines from the pages")
check(not errors, f"no page errors in the console {errors[:5]}")
check(not neterr, f"no network errors {neterr[:5]}")
crash = [line for line in log.splitlines() if "FATAL EXCEPTION" in line or ("AndroidRuntime" in line and " E " in line)]
check(not crash, f"no crash {crash[:5]}")

vib = (OUT / "vibrator.txt").read_text(errors="replace")
if PKG in vib:
    print("INFO the vibrator log shows vibrations from the app (native RlxHaptics):")
    for line in [l for l in vib.splitlines() if PKG in l][:6]:
        print("     " + line.strip())
else:
    print("INFO the vibrator log shows no vibration from the app (the emulator may have no vibrator); not a failure")

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)
