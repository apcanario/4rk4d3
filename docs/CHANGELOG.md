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
