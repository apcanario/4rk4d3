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


## 2026-11-25: B4 contrast pass

Pedro: "make sure colors are visible. It's pastel but contrast is important". The look stays pastel sunset, rounded 8-bit, pink. The token values below override PLAN §3, §2b and §6b where they differ; PLAN.md is unchanged (X15).

Models that ran: main chat Sonnet 5.5 (claude-sonnet-5-5); builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; fixes applied by a second Opus 5.5 agent (claude-opus-5-5).

Measured first (old tokens, all 11 states, logical H 240, 240 with a 10 px inset, 300, 400): against the dusk sky (luminance about 0.5) no pastel or mid coral fill reaches WCAG 3:1. Before: paddle 1.72, ball 2.66, score 2.78, wordmark 1.79, back card 1.01, pause ring 1.69 (white on the sunset sea), haptics toggle 1.26; brick row 7 delta E 9.99, sail fill 0.00 (the sun's colour), tiny sun outline 11.33, the SOON tag's white lettering 2.25.

Standard (tests/contrast.mjs, enforced in all three suites; every pair it names passes, with no exception; what still sits outside it is listed under Deferred):
- (a) Lettering, the ball, the paddle, the boat hull, keel and mast, and every control (back control, pause ring and chevrons, hub tiles, haptics toggle): WCAG contrast ratio >= 3 against every scene colour behind it (sky bands, sea bands, inked sea, sun, clouds) at sunset and all 10 steps. A shape or control passes a background when its fill or its 1 px edge all round clears it (as WCAG 1.4.11 counts a boundary). Small lettering (size 1: score, rally, count, run, SOON, HAPTICS) >= 4.5, glyph colour alone; outlined lettering (the hub tile labels) against its outline, 4.5 at size 1 and 3 at larger sizes. The hull's rows below the horizon are drawn in the keel colour and measured against the plain sea bands, the inked sea band 1 and the sea's pale dashes (the hull reaches at most 3 rows below the horizon, all in sea band 1).
- (b) Bricks, things to catch, nasty ones, fish, sail and jib, and three effects (review): the sky-event glint (on the sun, or the sea's top band), the spray under a leaping fish (open sky, sun, clouds, the sea's top band) and the ink cloud (against the sea band it darkens): CIE76 delta E >= 20 against every scene colour behind them, fill or 1 px outline. Brick fills alone (bricks have no outline). The sail's fill alone too.
- (c) The nine brick colours pairwise delta E >= 8.
- Logical heights 240 (with and without a 10 px top inset), 300 and 400; the hub on real layouts at 360x640, 360x800 and 360x1067 (scale 8).

Token changes (the recorded deviation from PLAN §3; scene tokens unchanged: sky, sun, cloud, star, sea, dusk; coral unchanged):

| Token or use | Old | New |
| --- | --- | --- |
| blue (ball, nasty ones, dolphin, bits) | #4A6FA5 | #436495 (10 percent toward black) |
| ink (new): score, rally, count, run, back chevron and edge, SOON tag, toggle, pause ring's outer ring and chevron outline | the blue #4A6FA5 | #30486B (the blue 35 percent toward black) |
| brick row 7 (and the pearl) | #FFB2C4 | #FFA2CE |
| card (new name): back control, SOON tag fill | literals #A0D0E8 and #78B4D8 | #A0D0E8 |
| sail (new) | cream, the sun token #FFF4D6 | #A0D0E8 |
| edge (new): 1 px all round, EDGE_AMOUNT 0.7 toward #783C5A | none (items and fish: shade, 0.38) | paddle, hull, mast, hub tiles, wordmark outline, outlines of things to catch and fish, sail and jib edges; coral's edge #9C455E |
| jib | brick row 5 #FF96B2 | brick row 6 #F57DA8 |
| hub tile lettering and chevron | sun #FFF4D6 | white #FFFFFF |
| STACK tile label and edge | #F78E90, no edge | coral's edge #9C455E |
| haptics toggle | on: blue body, white text; off: #C5E5F1 body, blue text | on: ink body, white rim and text; off: white body, ink rim and text |
| pause ring | white ring, white chevrons | white ring in a 1 px ink ring, white chevrons in a 1 px ink outline |
| keel (new, review): the hull's rows at and below the horizon | coral and its edge #9C455E | #241E38 (deep plum) |
| glint (new, review): the sky-event glint and the spray dots | white #FFFFFF | #FFA2CE (brick row 7's pink) |
| inkCloud and INK_CLOUD_AMOUNT (new, review): the ink cloud | the blue's shade #57557F mixed 0.35 into the sea | #483080 mixed 0.45 |
| hub tile labels (review) | white with a 1 px drop shade | white in a 1 px outline of the coral's edge #9C455E, no drop shade (as the wordmark) |

Weakest pairs after (with the review fixes): (a) pause rings, chevrons and the haptics toggle on sea band 2 at step 9, 3.11; ball on sky band 10 at full dusk, 3.13; paddle, hull, mast and tiles by their edge, 3.19; keel on the inked sea band 1 at full dusk, 3.25; wordmark by its outline, 3.32; small lettering 5.04; tile labels against their outline 6.13. (b) ink cloud on sea band 3 at full dusk, 20.85; spray and brick row 7 on sky band 5 at full dusk (H 240), 21.24; brick row 5 21.41; brick row 9 21.65; tiny sun 27.62; sail fill on the sun 37.20; glint 45.50. (c) rows 1 and 2, 10.11; row 7 against row 5, 11.30.

Built:
- shared/tokens.js and theme.css (mirrored): the values above, edge() and EDGE_AMOUNT. shared/pixel.js: pixelBody takes a rim (the edge all round inside the same w x h, so sizes and hit areas are unchanged); the back control in card and ink; no colour literals left. shared/font.js: drawFitted takes an outline; drawTextOutlined.
- Hub: wordmark outlined (its box 1 px taller and higher, the letters where they were), tiles edged with white lettering, STACK edged and lettered in the coral's edge, the SOON tag in ink on the card, the toggle in ink and white.
- Bricks: paddle edged, score and rally in ink, pause ring and chevrons in ink and white. Catch: hull edged, mast in the edge, sail and jib as above, sprite outlines in the edge, count and run in ink, pause ring in ink and white. Physics, pace, clock and haptics code untouched.
- Tests: tests/contrast.mjs (new, not shipped); the readability blocks in tests/bricks-sim.mjs (230 checks, was 210) and tests/catch-sim.mjs (186, was 172) replaced by the standard at all 11 states and the four heights, plus checks that the games draw with the measured colours, the pixelBody rim, the brick pairwise check and a theme.css mirror check; tests/check.py (238, was 205): the hub standard at three heights, the drawn colours of the hub, Bricks and Catch at sunset, step 5 and step 10, Bricks at dusk against the standard (rally in ink). With the old token values every new standard check fails (bricks-sim 13, catch-sim 13, the browser checks 16 with the old values under the new names). All three suites pass; check.py passed twice in full.
- Service worker cache rlx-v9 (rlx-v10 after the review fixes). README updated (token note, test text).
- X9 (brick row 7 at dusk) and X11 (the sail's cream fill) are resolved by this row and removed from Proposed.

Not verifiable headless: real screen brightness, outdoor glare and OLED rendering on Pedro's phone; whether the edges and the ink read as too heavy for the pastel look (X17).

Review findings and fixes (verdict fix):
1. Hull keel (should-fix), fixed. The hull's rows in sea band 1 failed the standard: its edge #9C455E there was 2.90 down to 2.25 on the plain sea from step 5 and 2.36 down to 1.66 on the inked dusk sea; its delta E against band 1 was 50 to 68 (the 76 in X14 and in the catch-sim log line was the coral fill's, not the edge's; both are gone). The hull's rows at and below the horizon are now redrawn, same stepped shape, in the new keel #241E38: 3.25 on the inked sea band 1 at full dusk, 9.46 on the sunset sea, at least 3.93 on every plain sea band at all 11 states. Against the inked sea bands 2 and 3, where the hull never reaches, it would be 2.55. The hull now meets (a) everywhere, no exception.
2. Hub tile labels (nit), fixed. White on coral was 3.30:1. Active tile labels are now white in a 1 px outline of the coral's edge, as the wordmark: 6.13 against the outline. The outline takes the place of the drop shade, so the label sizes are unchanged (2 on the test phones, 1 at logical H 240); labelSizeFor counts the outline, and the labels fit their boxes. At size 1 the outline fills the 1 px gaps between letters, so the label reads as white on a plum band. The wordmark's 1 px growth leaves the tiles at or below H/2 (first tile at 120, 152 and 252 for H 240, 300 and 400; the wordmark ends at 41).
3. Sampled label pixel (nit), fixed. tests/check.py no longer measures the tile label with a constant: it samples the drawn glyph and outline pixels from a screenshot at three heights and measures those.
4. Effects (Pedro wants everything visible), fixed. Glint and spray: #FFA2CE (white was delta E 16.25 on the sun, 0 on a cloud, 8 on the pale sky); now at least 45.50 (glint) and 21.24 (spray). Ink cloud: #483080 mixed 0.45 (was the blue's shade mixed 0.35, 7.45 to 16.41 from the sea); now at least 20.85. tests/catch-sim.mjs measures all three at all 11 states and four heights, and tests/check.py samples the keel, the inked sea and the glint as drawn at sunset, step 5 and step 10 on three heights. With the old values restored temporarily (keel #9C455E, glint white, ink cloud #57557F at 0.35, labels with the drop shade), catch-sim failed 8 checks and check.py 23 (the catch-sim run, the bricks-sim run on its theme mirror check, 6 hub label checks, 15 Catch ink and glint checks; white on the dusk sea passes); restored, all pass.
5. X13 flake, fixed. The failing check was '[catch 360x800] haptics off: zero vibrate calls over 0 catches and a bite': no catch came in the 6 s tracking window. The haptics-off check now seeds the save with a thing just above the deck over the boat and a nasty in the air, holds until a catch and a bite (polled, 10 s each), and needs at least one of each, so the zero-calls check cannot pass on no events; the 8 ms catch-tick check tracks until a catch (at most 30 s).
Reviewer's note, kept: the pause ring, chevrons and haptics toggle pass by their fill; X17 (the phone check) stays.

Suites after the review fixes: bricks-sim 230 checks, 0 failures; catch-sim 189 (was 186), 0 failures; check.py 268 (was 238), 0 failures in five full runs. Service worker cache rlx-v10.

Deferred: X15 (PLAN text for the new values), X16 (effects still outside the standard: the ball trail, a pop particle's highlight bit, the splash's white top), X17 (device pass).

## 2026-11-25: plan update 2: new hard rules (full screen, no points, no saved state, back gesture), rows U1, B2, S1, X1

Models that ran: written in the design chat on Fable; applied to the repo in a docs-only session by Sonnet 5.5 (claude-sonnet-5-5), no agents. No code changed.

Changed: docs/PLAN.md merged, not replaced. Sections 2 (hard rules), 2a (evidence) and 2b (wind-down rules) replaced by the update's; section 6a (row B2) replaced by the update's Bricks fix; new sections 6c U1 Putt, 6d S1 Stack, 6e X1 Strip-down added after 6b; section 8 Parked is now P3 only. Sections 3, 4, 5, 6 and 6b are kept as they were, each with one line under its heading saying it is superseded in part by the hard rules of update 2 and that row X1 brings the build in line. docs/style-reference-putt.jpg added. BACKLOG: Queue is U1, S1, X1, then B3; P2 Stack removed from Parked (now S1); P3 kept.

B2 was already Done (the wind-down build, 2026-11-25), so it was not re-queued and C1 was left as it is. The update's B2 adds the thumb-travel fraction (50 percent of the screen width moves the paddle end to end, one shared config value) which is not built: it needs its own small row.

## 2026-11-25: U1 Putt

Models that ran: main chat Sonnet 5.5 (claude-sonnet-5-5); builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; fixes applied by a second Opus 5.5 agent (claude-opus-5-5).

Built: games/putt/ (index.html, putt.js, sim.js, gen.js; sim.js and gen.js have no DOM) per PLAN §6c: pull-back-and-release shot with a dotted guide and power bar, 120 Hz swept physics (220 px/s top speed, 55 px/s^2, 85 percent bounce, sand, water back to the shot's origin, hole capture under 140 px/s), a seeded level generator with a solver on the same sim.js and a fallback after 30 rejects, levels built in a worker ahead of play, the dusk draw of level 1 only from minute 10, haptics 10, 6 and 24 ms, no text, no storage, edge touches under 24 CSS px ignored. PUTT tile on the hub (tiles step down to 15 px at logical height 240). sw.js adds games/putt/ and its four files, cache rlx-v11. README updated. Tests: tests/putt-sim.mjs (new, 69 checks, 200 levels per difficulty on five heights, 3000 random shots with no tunnelling), tests/check.py 305 (was 268), bricks-sim 230 and catch-sim 189 unchanged; all pass. shared/, Bricks and Catch unchanged.

Plan conflict: PLAN §6c's Gesture section said closing the app saves and reopening resumes; the hard rules and "No saved state" say nothing is stored. Putt stores nothing, and the sentence was struck from §6c.

Review findings and fixes (no blockers; verdict fix, minor):
1. should-fix, Putt play time never reaches the shared clock, so reopening restarts the ramp. Not changed: Pedro said a later row removes the clock. No row.
2. should-fix, the first opening drew an empty sea until the worker returned (a level-3 draw takes about 170 to 500 ms on desktop). Level 1 and 2 draws are now built on the page at the first frame; a level-3 request goes out at module load. Equal odds kept. New browser check: a level-1 or 2 opening has its course in the first frame (fails without the fix); a level-3 opening lands within 3 s. Fixed in part: a level-3 opening still shows the sea alone until the worker lands (262 ms headless); phone check in X19.
3. nit, the fallback ignored its seed. Hole x, block size and place now follow the seed; 40 seeds give 40 different courses (was 1), 171 fallbacks solved within 1 to 2 strokes and keep the placement rules. Fixed.
4. nit, diagonals could be 19.80 px. The leg is now 15 to 35 px, so 21.2 to 49.5 px; test tolerance tightened to 1e-6. Fixed.
5. nit, the 24 ms sink tick could be swallowed by the 40 ms gap after a bounce near the hole. A bounce within 8 steps before the drop no longer ticks, and a sink tick that still lands in the gap goes out when it ends. 178 test shots lose the sink tick with the old rule and none with the new one. Fixed.
6. nit, up to 20 s after the last touch counts as active play. The fix agent's edit was refused by the permission system; not made. X18.
Judged acceptable by the reviewer: no drawScene (sea full height, no sun or stars; matches the reference), Putt's own buzz() in place of shared tick(), the smaller hub tiles.

Not verifiable headless: no wait on the first opening and between holes on the phone, the three ticks by feel, Chrome's vibrate gate, the back gesture, touch feel, fps, reduced motion in a browser.

Deferred: X18 (idle window), X19 (device pass), X20 (PLAN amendments for the choices made where it is silent), X21 (rule number in §6c).

## 2026-11-26: S1 Stack

Models that ran: main chat Sonnet 5.5 (claude-sonnet-5-5); builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; fixes applied by the builder agent, Opus 5.5.

Built: games/stack/ (index.html, stack.js, sim.js; sim.js has no DOM and no imports) per PLAN §6d: tap anywhere drops the sliding block, overhang breaks into pixel bits, near-perfect drop within 2 px snaps and regains 2 px up to 60, a complete miss plops and the same block returns, a floor under 12 px is followed by a fresh 60 px block, the camera slides the tower down one floor per drop past mid-screen, pace 40 to 80 from 50 with the dusk ceiling falling 80 to 40 over minutes 10 to 12, haptics 8 ms landed and 16 ms near-perfect with the shared 40 ms gap. No HUD, no text, nothing stored; touches within 24 CSS px of an edge are ignored. Shared clock, scene and tokens reused and unchanged (git diff shared/ empty). Hub STACK tile is active; service worker rlx-v12. Tests: tests/stack-sim.mjs (109 checks, 15 simulated minutes), Stack checks in tests/check.py (354 in all), bricks-sim 230, catch-sim 189, putt-sim 69, all passing.

Review findings and fixes (no blockers):
1. should-fix, a block already sliding never followed the dusk ceiling down, so an idle player was still at 80 at minute 13. The sliding block's speed and the pace are now clamped to the ceiling every step; a test covers an untapped block through minutes 10 to 13. Fixed.
2. should-fix, a taller screen after the tower had been trimmed left the tower floating above the horizon. Resize now also lowers the tower until its lowest kept floor reaches the horizon; four resize round trips are tested. Fixed.
3. nit, a second finger dropped an unaimed block. Non-primary pointers are ignored; real two-touch check added. Fixed.
4. nit, after a clock reset a sliding block keeps its old speed until the next drop. Kept, as in Bricks X8(c); proposed in X22.
5. nit, the horizon was a literal H - 42. Now SEA_HEIGHT from shared/pixel.js. Fixed.
6. nit, Stack's time is in memory only and is lost on return to the hub, as in Putt. Left to X1.

Not verifiable headless: tap-to-drop latency and feel, the 8 and 16 ms ticks told apart by feel, Chrome's vibrate gate, fps, the camera slide, the back gesture, the look at dusk and outdoors, reduced motion on a device, split screen and rotation.

Deferred: X22 (PLAN amendments), X23 (device pass).

## 2026-11-26: X1 strip-down

Models that ran: main chat Sonnet 5.5; builder Opus 5.5 (claude-opus-5-5); reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build; fixes applied by the main chat, Sonnet 5.5.

Built: PLAN §6e across the hub, Bricks, Catch, Putt and Stack. No HUD anywhere (no back control, score, count, rally or run, no font import in any game; the Bricks pause-ring chevrons are pixel masks). All saving, restoring and stored counts removed; shared/settings.js and shared/store.js deleted; haptics always on; stored rlx.* keys cleared on every start. Manifest display fullscreen. Shared INPUT {thumbTravel 0.5, edgeIgnoreCssPx 24}, atSideEdge() and thumbSensitivity() in shared/pixel.js; Catch's boat now moves end to end over 50 percent of the screen width; every game ignores touches beginning within 24 CSS px of a side edge. Hub: four active tiles, nothing else. Architecture (not in PLAN, proposed X24): the hub opens each game in a fullscreen iframe with one history entry, so the in-memory session clock survives across games and the back gesture is the only way home. README, PLAN §4, §5, §6 and §6b brought in line. Tests: bricks-sim 215, catch-sim 181, putt-sim 70, stack-sim 109 (the edge key checks removed), tests/check.py with new checks (storage empty after play, no text or button on any game, hub tiles only, fullscreen manifest, edge touches, back gesture, one clock across games, the 5-minute reset, the real-vibrate activation check). Service worker rlx-v14.

Review findings and fixes:
1. should-fix, Stack ran inside the not-yet-shown frame and advanced the session clock while the tile was held: Stack counts play only once its frame is shown. Fixed.
2. should-fix (process), the frame architecture is the builder's choice, not PLAN's: kept, proposed as X24 for Pedro's veto.
3. should-fix (process), PLAN §4 and §6b were edited beyond "sections 5 and 6", and the old Proposed row X1 clashed with the Queue row: the §4 edit closes that Proposed row (removed); stale rows marked in X19 and X29.
4. note, Bricks still drags at 1.2 and PLAN §6 now says so: proposed as X26.
5. nit, Putt and Stack kept their own 24 px edge code: both use atSideEdge from shared/pixel.js now, their CONFIG key and its test check removed. Fixed.
6. note, a game opened by its direct URL has no way back: proposed as X31.
7. note, one inert back after a reload on a game entry: the hub steps back one entry instead of replacing it. Fixed; reasoned from code, not run on a device (X25).
8. nit, dead code: not changed. drawTextOutlined is in use (drawFitted calls it for the hub); COLORS.card is read by tests/check.py as a fallback; .sr-only predates X1. Left.
9. note, the first launch after deploy mixes an old hub with new games for one session: harmless.

Not verifiable headless: one edge swipe in the installed fullscreen app (if Android needs two, switch the manifest to standalone), vibrate in the frame on real Chrome for Android, display-cutout insets, a real kill and relaunch, feel and fps. Proposed as X25.

Deferred: X18 (Putt idleS), X21 (§6c rule number), X24 to X31.

## 2026-11-26: B3 thumb travel, and the Proposed rows cleared

Models that ran: main chat Sonnet 5.5 (claude-sonnet-5-5), which did the build itself; reviewer Opus 5.5 (claude-opus-5-5), which had not seen the build. No separate builder agent was used. Fixes applied by the main chat.

Built: Pedro's feel report: Bricks and Catch still need too much thumb amplitude. The shared INPUT.thumbTravel went from 0.5 to 0.35 of the screen width, end to end. Bricks now takes its drag sensitivity from the shared fraction as Catch does (X26); CONFIG.sensitivity is gone (about 2.2 at a 135 px field and a 30 px paddle). Putt's idle window is 10 s (X18). The build choices of X3, X8, X10, X15, X20, X21, X22, X24, X27 and X28 were merged into PLAN (§2b, §3, §5, §6, §6b, §6c, §6d, §6e), with the parts X1 made void left out. sw.js cache rlx-v15. Tests: bricks-sim and catch-sim thumb checks at 35 percent, a Bricks browser check of the sensitivity, putt-sim checks idleS.

Review findings and fixes: PLAN contrast standard stated as delta E 10 (it is 20); stale "sensitivity" in the §6 config line; Putt slide-in timing (starts 800 ms after the drop); §3 intro on the HUD; loop-breaker wording; a Bricks-only serve rule in the shared section; Chrome's vibrate gate now stated for every game; the pause-ring question kept open as X33 instead of dropped; X32 regained items from the rows it replaced; no Bricks browser check of 35 percent (added). All fixed.

Closed without code: X29, X7, X6, X31, X4 (superseded by X1, or accepted and documented). X2, X12, X17, X19, X23 and X25 became X32 (real-device pass). X16 and X30 stay Proposed.

Not verifiable headless: how 35 percent feels on a phone (it may now be too little; it is one value in shared/pixel.js), and everything in X32.

Deferred: X32, X33, X16, X30.

## 2026-11-26: B3a thumb travel 28 percent, Putt pull cap 48 px

Models that ran: main chat Sonnet 5.5; builder Opus 5.5 (claude-opus-5-5), which also reviewed its own diff once. No separate reviewer agent was used.

Built: Pedro's feel report (follow-up to B3): Bricks and Catch still need about 20 percent less thumb travel, and Putt about 20 percent less pull for full power. The shared INPUT.thumbTravel in shared/pixel.js went from 0.35 to 0.28 of the screen width, end to end, still the one value both games read (sensitivity about 2.8 for Bricks, 2.9 for Catch). Putt's CONFIG.pullCapPx went from 60 to 48 logical px. Power is min(pull, cap) / cap in sim.js pullShot, so full power is reached exactly at the cap and the aim still follows the pull vector; the 4 px cancel distance, the power bar (five bars from power), the guide dots (from the shot direction) and the pull ring (at the thumb) have no constant tied to 60, so nothing else changed. PLAN §6a, §6b, §6c and §6e and the README brought in line. sw.js cache rlx-v16. Tests: bricks-sim and catch-sim thumb checks at 28 percent; the Bricks and Catch browser checks at 28 percent; putt-sim checks the 48 px cap, half power at 24 px, full power exactly at 48 px in any direction and not before, and the aim along the pull; the check.py shot planner samples pull lengths at 0.8 of the old ones, so it covers the same powers. bricks-sim 219, catch-sim 181, putt-sim 71, stack-sim 109, tests/check.py 0 failures.

Not verifiable headless: feel on the phone; both are one value each.

Left as is: the X32 Queue row still says "thumb travel at 35 percent (B3)"; this session was told not to touch other rows.
