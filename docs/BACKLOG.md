# RLX: backlog

Rows are defined in docs/PLAN.md. Nothing is built that is not a row here. A done row leaves the Queue.

## Queue

- B2 Wind-down rules in Bricks (PLAN.md section 6a)
- C1 Catch (PLAN.md section 6b)
- B3 Real-device pass of B1 and tuning from Pedro's feel report (fps, haptic feel, kill and reopen, back gesture; serve angle 10 and loop nudge 8 degrees in CONFIG)

## Done

- H1 Shell and hub (2026-11-25)
- B1 Bricks (2026-11-25)
- B1a Bricks haptics do not fire on Pedro's device (2026-11-25)

## Parked

- P2 Stack: blocks slide across, tap to drop them. When specced it takes the wind-down rules: the pace is the slide speed, the skill signal is the run of clean drops, the exit ramp is the shared sunset.
- P3 APK wrapper, with a native haptics bridge if the web ticks feel mushy.

## Proposed

- X1 Add tools/ and tests/ (including tests/bricks-sim.mjs) and the read-only test hooks (canvas.dataset, window.__bricks) to the PLAN §4 layout (PLAN.md is kept verbatim, so this needs Pedro's veto window).
- X2 Real-device pass of H1 on Android Chrome: install, standalone, portrait, offline, back gesture, haptics (cannot be done headless).
- X3 Add to PLAN §6 the choices it was silent on: serve angle 10 degrees alternating, loop breaker (3 launches without a pop, nudge grows 8 degrees per launch, cap 70), wedge escape, first finger drives the paddle. Needs Pedro's veto window.
- X4 Score is drawn small (size 1, 'quiet' per PLAN §6) while docs/style-reference.jpg shows it large; Pedro decides in the feel report.
- X5 Pedro checks his phone for B1a: close and reopen RLX twice (rules out a stale service worker), then on the hub switch HAPTICS off then on and say whether the test tick buzzes; check the ringer is not on silent or Do Not Disturb, Settings > Vibration and haptics (touch feedback) is on, and battery saver is off; then play Bricks after one lift. Only Pedro can do this; the result decides whether B1a needs code (no code cause was found headless).
- X6 A Bricks page loaded without a tap from the hub (direct URL, reload, Chrome reloading the tab after Android killed it) cannot vibrate until the first lift: Chrome needs a tap (touch pointerup) on the page first, and in Bricks the first lift is the first such event. No in-page fix exists without changing the controls; Pedro decides whether to accept it.
- X7 tests/check.py cannot see Chrome's vibrate gate: it replaces navigator.vibrate, drives Bricks with mouse events (a mouse pointerdown grants activation) and reads state with page.evaluate (which runs as a user gesture). Add a check that keeps the real vibrate, plays with CDP touch events, reads state over CDP without a gesture, and asserts no 'Blocked call to navigator.vibrate' message after a tap from the hub.
