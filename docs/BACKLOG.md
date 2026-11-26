# RLX: backlog

Rows are defined in docs/PLAN.md. Nothing is built that is not a row here. A done row leaves the Queue.

## Queue

- P3 Android app for Google Play: Capacitor shell with the game files bundled, native haptics, immersive portrait, back to the hub and out, targetSdk 36, only VIBRATE; CI debug APK and signed .aab; store docs and screenshots (PLAN §6f; Pedro's decision 2026-11-26)

## Done

- H1 Shell and hub (2026-11-25)
- B1 Bricks (2026-11-25)
- B1a Bricks haptics do not fire on Pedro's device (2026-11-25)
- B2 Wind-down rules in Bricks (2026-11-25)
- C1 Catch (2026-11-25)
- B4 Contrast pass (2026-11-25)
- U1 Putt (2026-11-25)
- S1 Stack (2026-11-26)
- X1 Strip-down (2026-11-26)
- B3 Bricks and Catch thumb travel cut to 35 percent from Pedro's feel report; Bricks put on the shared fraction (X26) (2026-11-26)
- X3, X8, X10, X15, X20, X21, X22, X24, X27, X28 build choices merged into PLAN (2026-11-26)
- X18 Putt idle window 10 s (2026-11-26)
- X29, X7, X6, X31, X4 closed: superseded by X1 or accepted and documented in PLAN (2026-11-26)
- B3a Thumb travel 28 percent and Putt pull cap 48 px from Pedro's feel report (2026-11-26)
- H2 Hub redesign: a 2x2 grid of four framed cards, each a small window onto its game, no text (Pedro chose mockup 1 of 4; PLAN §5a) (2026-11-26)
- H2 review fixes and Pedro's layout answer: cards low in the thumb's reach, at most 1.3 x as tall as wide, on the sea with the horizon 8 px above them and the sky, sun, clouds and stars above as the picture; keel edge on the card frames; Stack card floor on the horizon; stale PLAN lines fixed (2026-11-26)
- X33 Pause markers removed from Bricks (ring with chevrons) and Catch (ring with a square); pausing unchanged; Pedro: not needed (2026-11-26)
- X30 Putt check "ticks: release 10 ms ..." not reproduced in 27 runs (7 full suites, 20 Putt browser runs); closed (2026-11-26)
- X16 Effects outside the B4 standard (ball trail, pop particle highlight bit, splash white top) accepted as built; PLAN §3 says so (2026-11-26)
- X32 Real-device pass closed on Pedro's report (2026-11-26). The report covered: the games feel great, thumb travel and ball travel are right, the pause marker is not needed. It did not confirm, so they are not claimed: tick strengths told apart, vibrate on a game opened from its card, the look at low brightness (edges, ink, keel too heavy or not), reduced motion, kill and reopen opening the hub, the first back after a reload, the hub's card size and tap comfort, Putt's first opening and the wait between holes, Stack's tap latency and camera slide, installed-app fullscreen and offline, one edge swipe back, outdoors brightness, fps, safe area with a cutout, split screen and rotation; they are X34 (2026-11-26)

## Parked


## Proposed

- X34 Device check of the low grid hub (card size and tap comfort, keel card edge too heavy or not, sun and sky look), and of what Pedro's report did not cover (PLAN §8 list); in the browser or in the P3 app
- X35 Remove shared/font.js: no page loads it since H2 and, since P3, tools/make-icons.py draws the icons from tools/rlx_art.py; drop it from sw.js FILES and retire the font checks in tests/check.py
