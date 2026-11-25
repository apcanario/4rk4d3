# RLX

A one-thumb arcade for an Android phone: a hub of small endless games to pick up and put down. Relaxed engagement, no thinking required. It exists to replace doom scrolling. The first game is Bricks.

The plan is `docs/PLAN.md`; the rows are in `docs/BACKLOG.md`; each session is logged in `docs/CHANGELOG.md`. The look follows `docs/style-reference.jpg`.

## Hard rules

- Android only: Chrome now, an APK WebView later. No iOS or Safari work.
- Portrait, one thumb, one input: a horizontal drag.
- No fail state: no lives, game over, timers, streaks, daily goals, notifications, leaderboards, accounts, ads or network calls.
- No sound. Haptics only, with one on/off setting.
- Instant in, instant out: lifting the thumb pauses, closing saves, reopening resumes.
- Vanilla HTML, CSS and JS, ES modules, no build step, no dependencies, no CDN, no web fonts. Static files on GitHub Pages.
- Text never wraps or overflows its box: its size is fitted to the box.

## Layout

- `index.html`: the hub.
- `shared/`: `tokens.js` (colours, mirrored in `theme.css`), `font.js` (the pixel font), `pixel.js` (canvas, integer scaling, stepped-corner shapes, dither, scene, page hygiene, navigation), `haptics.js`, `store.js` (localStorage, versioned keys), `settings.js`.
- `games/bricks/`: the game (a placeholder until row B1).
- `manifest.webmanifest`, `sw.js`, `icons/`.
- `tools/`, `tests/`: helper scripts. Nothing in them is needed to run the app.

All paths are relative, so the site works at a domain root or under a project subpath such as `/4rk4d3/`.

## Run locally

Serve the repo root with any static server and open it in Chrome:

    python3 -m http.server 8000
    # then open http://localhost:8000/

Use `localhost` (a secure context) so the service worker registers. Use Chrome DevTools device mode at 360 to 412 px wide to see the phone layout.

## Deploy

GitHub Pages serves the static files straight from the `main` branch, repo root. There is no build and no workflow.

1. Once: in the repo on GitHub, Settings, Pages, Source "Deploy from a branch", branch `main`, folder `/ (root)`. The site is then at `https://apcanario.github.io/4rk4d3/`. `.nojekyll` tells Pages to serve the files as they are.
2. Every deploy that changes a shipped file: run `tools/bump-sw-version.sh` (it bumps `VERSION` in `sw.js`), commit, push to `main`. If you added a shipped file, add it to `FILES` in `sw.js` too.

How updates reach the phone: `sw.js` serves every file cache-first from a cache named after `VERSION`, so the app opens offline. On each launch Chrome rechecks `sw.js` (registered with `updateViaCache: 'none'`). A changed `VERSION` installs the new worker, which caches the new files under the new name, takes over and deletes the old cache. The launch after that runs the new version.

Install: open the Pages URL in Chrome for Android, then menu, Add to home screen (or Install app). It opens standalone, in portrait.

## Tools and tests (not shipped)

- `tools/make-icons.py`: redraws `icons/` in the app's pixel style from the font in `shared/font.js`. Needs Pillow.
- `tools/bump-sw-version.sh`: bumps the service worker cache version.
- `tests/check.py`: row H1 checks in headless Chromium (Python Playwright). It serves the repo under `/4rk4d3/`. Full suite at 360x800 and 412x915 CSS px (device scale 2.625): crisp integer pixels, no scrolling, tile layout and one label size, hub to Bricks and back by tap and by history back, the haptics setting across reloads (and a corrupt stored value), the service worker offline, the slash-less `games/bricks` URL online and offline, Chrome's installability report, console errors and requests to other hosts. Layout checks at 360x640, 360x560 (scale 3) and 800x360, a live resize, a cache version bump, `sw.js` FILES against the shipped files, and the font's corner rule. Screenshots go to `tests/out/` (ignored by git). Run: `python3 tests/check.py`, or `python3 tests/check.py --max-age 600` to serve with GitHub Pages' caching header.
