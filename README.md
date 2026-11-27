# RLX

A one-thumb arcade for an Android phone: two small endless games to pick up and put down. Bricks, and Pool (a beach billiards table). It exists to replace doom scrolling.

v1 (five games) is at branch `archive/v1` (commit `b8209ba`). The spec for v2 is `docs/V2.md`; open rows are in `docs/BACKLOG.md`; each session is logged in `docs/CHANGELOG.md`. The look follows `docs/style-reference.jpg` (Pool: `docs/style-reference-pool.jpg`).

## Hard rules

- Android only, portrait, one thumb. Vanilla HTML, CSS and JS, ES modules, no dependencies, no build step.
- Full screen. No text, number, button or HUD anywhere, the hub included. No points. No sound. Haptics always on. No settings.
- Nothing is stored. Opening a game always starts it fresh.
- Home is the Android back gesture. A touch that begins within 24 CSS px of a side edge is ignored.
- No fail state. When a game ends it just starts again.
- Light and dark follow the phone, live, no toggle.

## Layout

- `index.html`, `hub/cards.js`, `hub/life.js`: the hub: two framed cards side by side (Bricks, Pool), low on the screen, under the sunset sky, alive (drifting clouds, gulls, a boat, a swell under the cards, a bouncing ball, a crab; still under reduced motion). A tap opens the game full screen in a frame over the hub; the back gesture returns.
- `shared/`: `tokens.js` and `theme.css` (colours, light and dark), `pixel.js` (canvas, integer scaling, scene, input values), `haptics.js` (the shared `tick()`, 40 ms gate), `native.js` (Android plugin bridge), `session.js` (the in-memory session clock; Bricks reads it, Pool does not).
- `games/bricks/`: Bricks (`bricks.js` drawing and thumb, `physics.js` simulation).
- `games/pool/`: Pool (`pool.js` drawing, thumb, haptics, `CONFIG`; `sim.js` simulation, no DOM).
- `manifest.webmanifest`, `sw.js` (cache-first service worker; `FILES` lists every shipped file), `icons/`.
- `android-app/`: the Capacitor shell with these files bundled (`tools/build-www.mjs` copies `sw.js` FILES). Build and release: `docs/PLAY.md`; CI: `.github/workflows/android.yml`.
- `docs/play/`, `docs/social/`, `privacy-policy.html`: store listing and teasers (the Play screenshots and text are still v1).
- `tools/`, `tests/`: helper scripts and tests, not shipped.

All paths are relative, so the site works at a domain root or under `/4rk4d3/`.

## Run and deploy

    python3 -m http.server 8000   # open http://localhost:8000/ in Chrome, device mode 360 to 412 px

GitHub Pages serves `main`, repo root. Before a deploy that changes a shipped file, run `tools/bump-sw-version.sh`; add any new shipped file to `FILES` in `sw.js`.

## Portfolio

`portfolio/` is this project's case study, fetched daily by `apcanario/portfolio` (its `docs/CONTRACT.md` is the shape). It is not shipped in the app. A row that changes anything stated in `portfolio/` updates it in the same commit; a decision worth telling goes into `portfolio/notes.md`. Fetch and rebase before every push.

## Checks

    node tests/bricks-sim.mjs
    node tests/pool-sim.mjs
    node tests/contrast.mjs
    node tests/haptics-native.mjs
    python3 tests/check.py          # headless Chromium (Playwright); --only a,b runs named parts

Screenshots go to `tests/out/` (ignored by git).
