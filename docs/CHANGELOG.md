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
