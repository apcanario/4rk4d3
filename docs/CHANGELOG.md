# RLX: changelog

One entry per session: date, row, the models that actually ran, what was built, review findings and fixes, anything deferred.

## 2026-11-25: H1 shell and hub

Models that ran: main chat Sonnet 5.5; builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; fixes applied by the builder agent, Opus 5.5.

Built: shared modules (tokens, theme.css, pixel font, pixel canvas and scene, haptics, store, settings), hub with RLX wordmark, BRICKS tile and SOON tiles for CATCH and STACK, HAPTICS ON/OFF setting with test tick, Bricks placeholder with back control, manifest with 192, 512 and maskable icons, cache-first versioned service worker (now rlx-v2), README, headless test suite tests/check.py (97 checks).

Review findings and fixes (reviewer found no blockers):
1. should-fix, slash-less /games/bricks blanked under the service worker: now redirected to the slash URL. Fixed.
2. should-fix, tiles hid the sun on short screens: tile sizes step down, tiles never start above H/2, tests check the top edge. Fixed.
3. nit, landscape or small windows broke the layout: scale now steps down until logical height is 240 or scale is 1. Fixed.
4. nit, tile labels at different sizes: one shared label-box function, equal sizes asserted. Fixed.
5. nit, test gaps: assertions added or replaced, run again with Cache-Control max-age=600. Fixed.
6. nit, inconsistent font corner rounding: one rule for every glyph, enforced by a test, icons regenerated. Fixed.
7. nit, tools/ and tests/ and the canvas.dataset test hooks sit outside PLAN §4: accepted, documented in the README; proposed as X1.
8. nit, BACKLOG and CHANGELOG not yet closed: closed in this entry.

Not verifiable headless: real home-screen install, standalone and portrait launch, the Android back gesture and real haptics on a device. Proposed as X2.

Deferred: nothing else.

## 2026-11-25: B1 Bricks

Models that ran: main chat Sonnet 5.5; builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; fixes applied by the builder agent, Opus 5.5.

Built: Bricks in full per PLAN §6: 7 x 9 field with endless refill and the 12-row cap, 95 px/s ball on a fixed 120 Hz swept physics step (physics.js, no DOM), paddle angles and the 20 degree floor, miss splash and 600 ms respawn, relative drag at 1.2, pause on lift with thumb ring, 250 ms resume, full-state save and restore, haptics 8 and 16 ms with the 40 ms limit, all-time score, particles and trail off under reduced motion. Tests: tests/bricks-sim.mjs (134 checks, includes the 10-minute run) and Bricks checks in tests/check.py (134, all H1 checks kept). Service worker cache rlx-v4.

Review findings and fixes (no blockers):
1. should-fix, a paddle sliding into a deep ball let it sink through: ball is snapped up and bounced or pushed out sideways, tested with jitter and flick thumbs, 200 trials each. Fixed.
2. should-fix, a still thumb gave an endless vertical loop popping nothing: serves alternate 10 degrees off vertical and a growing nudge breaks a loop of 3 launches without a pop; still-thumb tests added. Fixed.
3. nit, two fingers doubled paddle speed: first finger drives. Fixed.
4. nit, paddle could bounce the ball during the resume wait: no catch or tick unless running. Fixed.
5. nit, score small against the reference: kept, PLAN says quiet. Proposed as X4.
6. nit, weak assertions in check.py: score check, 40 ms claim and swept brick check corrected. Fixed.
7. nit, stale placeholder label. Fixed.
8. found while fixing, a ball wedged between wall and paddle side bounced forever: wedge escape added and tested. Fixed.

Not verifiable headless: fps on a device, whether the 8 and 16 ms ticks feel different, touch feel, a real app kill, safe-area insets, the back gesture in play, how the fading row looks.

Deferred: device pass and tuning (B2); PLAN §4 and §6 amendments (X1, X3); score size (X4).

## 2026-11-25: plan bundle: evidence section, wind-down rules, rows B2 and C1

Models that ran: written in the design chat on Fable; applied to the repo in a docs-only session by Sonnet 5.5 (claude-sonnet-5-5), no agents. No code changed.

Changed: docs/PLAN.md replaced with the bundle's version (new sections 2a evidence, 2b wind-down rules, 6a row B2, 6b row C1; Bricks ball speed now follows the pace; P2 Stack reworded). docs/style-reference-catch.jpg added. BACKLOG: B2 (wind-down rules in Bricks) and C1 (Catch) added to the Queue; P1 and P4 removed from Parked (P1 is now C1, P4 is replaced by the sunset exit ramp in B2); P2 reworded, P3 kept.

Renumbered: the existing Queue row B2 (real-device pass of B1 and tuning) is now B3, because the plan's B2 is the wind-down row. The B1 entry above still calls it B2. Proposed rows X1 to X4 untouched.

## 2026-11-25: B1a Bricks haptics bug

Models that ran: main chat Sonnet 5.5 (claude-sonnet-5-5); builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; doc fixes applied by the main chat, Sonnet 5.5.

Diagnosis (headless Chromium 158 through Playwright, real navigator.vibrate kept, input as CDP touch events, state read over CDP without a user gesture):
1. vibrate called with no user activation: ruled out for the normal path, ruled in for one edge. Chrome gates navigator.vibrate on sticky activation; for touch only pointerup/touchend grants it, not pointerdown or touchmove. Observed: Bricks loaded directly has no activation, vibrate(8) returns false and Chrome logs "Blocked call to navigator.vibrate because user hasn't tapped on the frame or any embedded frame yet"; a touch drag ending in touchend grants it (touch-action none on the canvas, so no pointercancel; preventDefault on pointerdown does not stop it); a tap on BRICKS in the hub carries activation into Bricks (same-origin navigation from a tap), vibrate(8) returns true and nothing is logged. Two real holds after the tap: 4 calls each, all returned true, both 8 and 16 ms. Edge: a Bricks page loaded without that tap (direct URL, reload, Chrome reloading a killed tab) is silent until the first lift. Proposed as X6.
2. Hub test tick: works. testTick() runs in the pointerup handler (index.html), which is itself an activating event; headless it returned true. Bricks calls tick() from pointermove and from the rAF physics loop, which rely on sticky activation; that holds after the hub tap or the first lift.
3. Setting read: ruled out. shared/settings.js reads rlx.v1.settings from localStorage on every tick, default haptics true, a non-boolean falls back to true.
4. 40 ms limiter: ruled out. shared/haptics.js uses performance.now() for both the stamp and the check; the rAF timestamp is not used. A tick inside 40 ms of another is dropped by design (PLAN §6); paddle and brick events are far apart in time (the ball has to travel between them), and headless play produced both lengths.
5. Pause or running gate: ruled out. Paddle ticks in pointermove fire only when mode is running, which is when the finger is down and play is live; brick and paddle events from P.step are handled in the same frame they are produced, inside the running branch.
6. Stale service worker: ruled out in the code, open on the device. sw.js is cache-first under rlx-v4, FILES holds both shared/haptics.js and games/bricks/bricks.js, both are cached together under one version. Earlier builds (up to rlx-v4) may have run on the phone: a stale worker updates after one launch and takes effect on the next, so a phone that has been opened only once since the last deploy can still run old files. Not ruled out for the device; X5 covers it.
Also found: the existing Bricks checks in tests/check.py cannot see the activation gate (vibrate stubbed, mouse input, page.evaluate runs as a user gesture). Proposed as X7.

Cause: no code defect found that explains haptics never firing. On the normal path (hub, tap BRICKS, play) the code calls navigator.vibrate with 8 and 16 ms and Chromium accepts every call. The cause is most likely on the device; this is not proven.

Fix: none. No code change, no test, no service worker bump; cache stays rlx-v4.

Not verifiable headless: that Chrome for Android carries activation across the hub tap as desktop Chromium does; the phone's vibration settings, ringer or Do Not Disturb mode, battery saver; whether 8 and 16 ms pulses are strong enough to feel on his motor. Pedro's check is X5.

Review (reviewer found no blockers; verdict accept):
1. should-fix, item 6 said the repo has one commit, so no older code could be served; false (the clone is shallow and earlier builds shipped). Restated above. Fixed.
2. should-fix, X5 lacked a stale-worker step: it now says to close and reopen RLX twice before testing. Fixed.
3. nit, activation carry-over across the hub tap on Chrome for Android (as opposed to desktop Chromium) is unverified: stated above.

Device check (Pedro, 2026-11-25, after the build): haptics work on his phone. No code was changed, so the earlier silence was a phone or load-path matter, most likely the X6 case (page opened without the hub tap) or a stale worker; the exact cause was not pinned down. X5 is closed.

Deferred: X6 (silent first hold after a load without a tap), X7 (a test that sees the vibrate gate).

## 2026-11-25: B2 wind-down rules in Bricks

Models that ran: main chat Sonnet 5.5 (claude-sonnet-5-5); builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; fixes applied by a second Opus 5.5 agent (claude-opus-5-5).

Built:
- shared/session.js (new, shipped): the one session clock for all games, counting active play only, saved under rlx.v1.session with the time of the last active play, reset after 5 minutes without play; the SESSION block (ramp 10, slowdown 2, reset gap 5 minutes, 10 scene steps, stars from step 8); phase, step and slowdown helpers.
- shared/tokens.js and theme.css: dusk tokens (sky #CDB8E0 #F0A9A6, sea #6FA3C4 #5F93B8 #5083AB, star #FFFFFF) and scenePalette, a flat mix per step.
- shared/pixel.js: drawScene takes the phase and draws it in flat steps: sky and sea bands toward dusk, the sun sinking below the horizon, white stars in the last three steps.
- Hub: draws the phase of the saved clock, never advances it, shows sunset after the reset gap and redraws at that moment if left open.
- Bricks: hidden pace (80 to 125, start 90, +1 per paddle return, -12 per miss, applied only at a paddle bounce or a new serve), the dusk slowdown (ceiling 125 to 80 over minutes 10 to 12, passed into physics.js as ease), the clock reset back to 90, the rally number under the score in the same blue (not saved), the scene redrawn when its step changes. State version 2 adds pace and speed; a B1 save gives a fresh field with its score kept. Haptics path untouched.
- Tests: tests/bricks-sim.mjs 210 checks (was 134), including the 15-minute run with misses (speed 80 at the first bounce after minute 12, 723.2 s) and the readability check; tests/check.py 152 checks (was 134), all passing. Service worker cache rlx-v6, shared/session.js added to FILES. README layout and tests text updated.

Readability (CIE76 delta E in CIELAB, threshold 10, each foreground against the scene colours under it, sunset and all 10 steps): passes on H 300 (both test phones, weakest 13.6) and H 330. On H 240 one pair is under: brick row 7 #FFB2C4 on sky band 7 at step 10, 9.99. Proposed as X9; no change made, PLAN fixes both colours. In the browser at 360x800 full dusk, each brick row, the paddle, the ball and the rally keep their token colours, weakest 16.4 against the sky beside them.

Not verifiable headless: whether the pace change is noticeable (PLAN says it should not be), how the dusk looks on the phone's screen, real 12-minute sessions across app kills, Date.now jumps on the device.

Review findings and fixes (no blockers; verdict accept):
1. A new serve could start slightly above the falling ceiling: spawn used the pace clamped at the miss 600 ms earlier, so a serve just after minute 12 flew at about 80.2. physics.js now clamps the pace to the ceiling at the serve (ease passed into spawn). New sim check: a serve after minute 12 flies at exactly 80; it fails with the clamp removed (80.1125). Fixed.
2. A device clock set backwards was never stale, so the 5-minute reset never fired. isStale in shared/session.js now also treats now earlier than the last active play as stale. Two new sim checks; both fail without the fix. Fixed.
3. Weak tests. The sim check for paused time now drives the clock as the loop does (90 s of 120 Hz steps, 4 minutes paused, 30 s more: 120 s); it fails if paused wall time is counted. New browser check: hidden 3 s with the finger up, the saved clock stays the same. The rally browser check now asserts +1 at each paddle return and 0 at a miss through the test hook. Fixed.
4. Bricks left paused over 5 minutes shows the old scene until the next touch; documented in X8(g). Deferred.
5. A ball restored mid-flight gives 91 at its first bounce; X8(c). Deferred.
6. The saved pace is kept when Bricks is reopened within 5 minutes, while PLAN §6 says a new launch starts at 90; X8(b). Left for Pedro's veto.

Deferred: X8 (PLAN amendments for the choices made where it is silent), X9 (brick row 7 at full dusk on the smallest screen).

## 2026-11-25: C1 Catch

Models that ran: main chat Sonnet 5.5 (claude-sonnet-5-5); builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; fixes applied by a second Opus 5.5 agent (claude-opus-5-5).

Built:
- games/catch/ (new, shipped): index.html, catch.js (drawing, input, pause and save, haptics; the CONFIG block at the top holds the pace gains and losses, fall-speed and spawn-gap ranges, nasty interval, tap thresholds, pause grace, fish speed and haptic lengths), sim.js (no DOM, no imports: the 120 Hz simulation, the input state machine, the sprite masks). A boat (24 x 7 coral hull, mast, cream sail) on the horizon catches 8 kinds of 7 x 7 warm things falling at 32 to 48 px/s with a 3 px sway, one every 1.7 to 1.1 s within 70 px of the last, at most 3 in the air. One blue spiky nasty every 20 to 30 s at 30 px/s; a tap (under 200 ms, under 4 px) sends a 9 x 5 fish up at 220 px/s that eats it before it lands, or a hop with no nasty. Uneaten nasties rock the boat or ink the sea. The rare treat on a parachute sets off a gull, a dolphin or a sun glint. Pace 0 to 1 (start 0.3, +0.02, -0.15), applied only to new spawns, ceiling falling to 0 over minutes 10 to 12 of the shared session clock; dusk scene by the shared drawScene. Count (all-time) and run on the HUD; eaten stored, not shown. 400 ms pause grace, 250 ms resume, save on pause, hide and pagehide, restore paused. Haptics through shared tick() only: catch 8 ms, bite 16 ms. Bricks and shared/ unchanged.
- Hub: CATCH tile active; STACK stays SOON.
- Tests: tests/catch-sim.mjs (new) 172 checks, including the 15-minute run on four screen heights; tests/check.py 205 checks (was 152), including Catch played with CDP touch events; tests/bricks-sim.mjs 210 checks unchanged; all pass. sw.js FILES adds games/catch/ and its three files; cache rlx-v8. README updated.

Readability (CIE76 delta E in CIELAB, threshold 10, each sprite's edge colours against the scene colours under them, sunset and all 10 steps, logical H 240, 240 with a 10 px inset, 300 and 400): every pair passes. Weakest: item tiny sun outline #CCAEA7 on sky band 7 at step 6, H 240: 11.33; boat sail edge 14.07; fish 16.45; nasties 36.94; count 36.94. The sail's cream fill inside its edge is under 10 on 40 of 84 pairs (X11).

Not verifiable headless: whether the pace change or the dusk slowdown is noticeable, tap versus drag feel with a real thumb, catch and bite ticks told apart by feel, Chrome's vibrate gate (the browser checks stub navigator.vibrate and read state with page.evaluate, a user gesture), fps on the phone, a real app kill, the back gesture during play.

Deferred: X10 (PLAN amendments for the choices made where it is silent), X11 (sail fill), X12 (device pass of C1).

Review findings and fixes (no blockers; verdict fix):
1. should-fix, 5 fish break restore: rapid taps filled 4 hops and a leap for a nasty made 5, which restore() refuses as corrupt, so a kill and reopen lost the scene. Hops now stop at 3, so a leap always has a slot; X10 (f) updated. New sim checks: 4 rapid taps, a nasty, a tap, then save and restore give the same scene; both fail without the fix (5 fish up). Fixed.
2. nit, the tiny sun read spiky like the urchin (corner rays). New mask: a disc with four short stubs, still 7 x 7 with its outline; perimeter squared over area 31 (was 52), the shape check unchanged. Fixed.
3. nit, unlocked kinds lived only in the game state, so a corrupt save reset them to 2. A fresh or rebuilt scene now takes 2 plus one per 40 stored catches, up to 8, as fish kinds come from eaten; X10 (g) updated. New sim checks, including a corrupt save with 500 catches giving 8 kinds; they fail without the fix. Fixed.
4. nit, nasty and treat spawns moved the 70 px reference, so consecutive items were over 70 px apart in about 1 percent of spawns. Only normal items move it now; the 15-minute runs check consecutive items within 70 px and each nasty and treat within 70 px of the last item (fails on all four heights without the fix); X10 (b), (d) updated. Fixed.
5. nit, the haptics block in tests/catch-sim.mjs re-implements handle() rather than running it; real ticks are covered in tests/check.py. Deferred.
6. nit, no test would notice the resume delay cut below 200 ms. New sim checks: resumeDelayMs longer than tapMs in CONFIG, and a touch that begins while paused, lifted after 0 to 500 ms, never fires a fish. Fixed.

Accepted by the reviewer: the 50 ms bite hold (X10 (a)) and the sail's cream fill (X11).

