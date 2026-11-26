# RLX: backlog

Rows are defined in docs/PLAN.md. Nothing is built that is not a row here. A done row leaves the Queue.

## Queue

- X32 Real-device pass of every game on Pedro's phone, installed app in fullscreen (replaces X2, X12, X17, X19, X23, X25; cannot be done headless): one edge swipe from each game back to the hub (if Android needs two, set the manifest to standalone); install, portrait, offline; fps; tap and drag feel in Catch (200 ms, 4 px, 400 ms grace) and Putt pull and release; tick strengths told apart in each game; vibrate on a game opened from its card; look at sunset, step 5 and dusk at normal and low brightness and outdoors (are the edges, ink, keel, ink cloud and hub card frames too heavy for the pastel look); Putt first opening and hole-to-hole wait; the new grid hub: card size and tap comfort; Stack tap latency and camera slide; safe-area insets with a display cutout; reduced motion; kill and reopen opens the hub, and the first back after a reload on a game entry; split screen and rotation. Bricks and Catch thumb travel at 28 percent (B3a) and Putt's pull cap at 48 px.

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

## Parked

- P3 APK wrapper, with a native haptics bridge if the web ticks feel mushy.

## Proposed

- X16 Effects still outside the B4 standard: the ball trail (delta E 16.42 from the sky), a pop particle's highlight bit and the splash's white top. Pedro decides whether they should read more strongly; listed in PLAN §3.
- X33 The pause rings in Bricks (ring with chevrons) and Catch (ring with a square) are on screen while paused. PLAN §6e does not list them and §2 bans any other HUD. Keep them (they are the only sign the game is paused) or remove them: Pedro decides.
- X30 Watch: the Putt check "ticks: release 10 ms ..." failed once in one full run of the builder (cause not proven; suspected a random level where the side shot meets water).
