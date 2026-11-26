#!/usr/bin/env python3
"""Draw the RLX web app icons from the approved beach-sunset art (PLAN §6f).

Not part of the shipped runtime. Needs Pillow (pip install pillow).
The art is tools/rlx_art.py, the same that made the Android launcher icons
and docs/play/ic-play-512.png (Pedro's approved set, 2026-11-26). No lettering.
Writes:
- icons/icon-512.png: the 64 px grid x 8, full bleed, the Play icon pixel for pixel;
- icons/icon-192.png: the same grid x 3;
- icons/icon-maskable-512.png: the adaptive-icon layout (a 48 px viewport in a
  64 px grid, full bleed), so the sun and boat sit well inside the maskable
  safe circle (radius 40 percent).
Run from anywhere: python3 tools/make-icons.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from rlx_art import Grid, draw_background, draw_foreground, full_icon  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent


def maskable():
    g = Grid(64, 64)
    draw_background(g, 48, 8)
    draw_foreground(g, 48, 8)
    return g


def main():
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    base = full_icon(64)
    base.scaled(8).save(out / "icon-512.png", optimize=True)
    base.scaled(3).save(out / "icon-192.png", optimize=True)
    maskable().scaled(8).save(out / "icon-maskable-512.png", optimize=True)
    print("wrote icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png")


if __name__ == "__main__":
    main()
