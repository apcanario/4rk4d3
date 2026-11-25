# RLX: backlog

Rows are defined in docs/PLAN.md. Nothing is built that is not a row here. A done row leaves the Queue.

## Queue

- C1 Catch (PLAN.md section 6b)
- B3 Real-device pass of B1 and tuning from Pedro's feel report (fps, haptic feel, kill and reopen, back gesture; serve angle 10 and loop nudge 8 degrees in CONFIG)

## Done

- H1 Shell and hub (2026-11-25)
- B1 Bricks (2026-11-25)
- B1a Bricks haptics do not fire on Pedro's device (2026-11-25)
- B2 Wind-down rules in Bricks (2026-11-25)

## Parked

- P2 Stack: blocks slide across, tap to drop them. When specced it takes the wind-down rules: the pace is the slide speed, the skill signal is the run of clean drops, the exit ramp is the shared sunset.
- P3 APK wrapper, with a native haptics bridge if the web ticks feel mushy.

## Proposed

- X1 Add tools/ and tests/ (including tests/bricks-sim.mjs) and the read-only test hooks (canvas.dataset, window.__bricks) to the PLAN §4 layout (PLAN.md is kept verbatim, so this needs Pedro's veto window).
- X2 Real-device pass of H1 on Android Chrome: install, standalone, portrait, offline, back gesture, haptics (cannot be done headless).
- X3 Add to PLAN §6 the choices it was silent on: serve angle 10 degrees alternating, loop breaker (3 launches without a pop, nudge grows 8 degrees per launch, cap 70), wedge escape, first finger drives the paddle. Needs Pedro's veto window.
- X4 Score is drawn small (size 1, 'quiet' per PLAN §6) while docs/style-reference.jpg shows it large; Pedro decides in the feel report.
- X6 A Bricks page loaded without a tap from the hub (direct URL, reload, Chrome reloading the tab after Android killed it) cannot vibrate until the first lift: Chrome needs a tap (touch pointerup) on the page first, and in Bricks the first lift is the first such event. No in-page fix exists without changing the controls; Pedro decides whether to accept it.
- X7 tests/check.py cannot see Chrome's vibrate gate: it replaces navigator.vibrate, drives Bricks with mouse events (a mouse pointerdown grants activation) and reads state with page.evaluate (which runs as a user gesture). Add a check that keeps the real vibrate, plays with CDP touch events, reads state over CDP without a gesture, and asserts no 'Blocked call to navigator.vibrate' message after a tap from the hub.
- X8 Add to PLAN §2b and §6a the choices B2 made where they are silent (PLAN.md is kept verbatim, so this needs Pedro's veto window): (a) the session clock is saved under its own shared key rlx.v1.session, at the same moments as the Bricks state, and Bricks' pace and flight speed sit in the Bricks state (now version 2); (b) "a new launch starts at 90" is read as a launch with no save or after the reset gap; a reopen within 5 minutes restores the saved pace (exact resume); (c) a clock reset sets the pace to 90 at once, while the ball in flight keeps its speed until its next paddle bounce; (d) a new serve after a miss takes the current pace (a new flight, not mid-flight), and both a miss and a serve are clamped to the falling ceiling; (e) the ceiling falls linearly from 125 to 80 over minutes 10 to 12; (f) the scene has sunset plus 10 steps, one per whole minute of active play, full dusk at minute 10; the sun sinks round(24 x step / 10) px; stars are 3 x 3 white crosses, 2, 4 and 6 at steps 8, 9 and 10, spread over each page's open sky; clouds and glints stay; (g) the clock resets only when play starts (on load or on resume); a page that shows the clock (hub, or Bricks while paused) shows sunset once the gap has passed, and the hub redraws itself at that moment; (h) the rally is always shown, 0 included; to fit it under the score, the score moved from the vertical middle of the back control to its top line; (i) test hooks: canvas.dataset.scene and dataset.hud, and window.__bricks now reports rally, clock and step (see X1).
- X9 Readability at full dusk on the smallest design height (logical H 240, e.g. a 360 x 640 window): the field reaches sky band 7, and brick row 7 (#FFB2C4) sits at CIE76 delta E 9.99 from it at step 10, against a stated threshold of 10 (24 at sunset). Every other pair at every step clears 10; on both test phones (H 300) the weakest pair is 13.6. PLAN fixes both the brick and the dusk tokens, so no fix was made; tests/bricks-sim.mjs pins this one pair. Pedro judges it on his phone at dusk; if it reads weak, a token change needs a PLAN change.
