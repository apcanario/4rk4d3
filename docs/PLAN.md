# RLX: plan

## 1. What it is

A one-thumb arcade for Pedro's Android phone: a hub of small endless games to pick up and put down. Relaxed engagement, no thinking required. The first game is Bricks. It exists to replace doom scrolling.

## 2. Hard rules (every game, every screen)

- Android only: Chrome now, an APK WebView later. No iOS or Safari work of any kind.
- Portrait, one thumb, one input: a horizontal drag. No second gesture is needed to play.
- No fail state: no lives, no game over, no timers, no streaks, no daily goals, no notifications, no leaderboards, no accounts, no ads, no network calls.
- No sound at all. Haptics only, with one on/off setting.
- Instant in, instant out: lifting the thumb pauses, closing the app saves, reopening resumes the exact state.
- Vanilla HTML, CSS and JS, ES modules, no build step, no dependencies, no CDN. Static files on GitHub Pages.
- Text never wraps or overflows its tile or button: fit the text size to the box.

## 3. Look

Light summer sunset, rounded 8-bit. docs/style-reference.jpg is the approved reference; match it.

Pixel grid
- Logical width is 135 px. Scale is the largest integer that fits the screen width in device pixels; the canvas is centred. Logical height is whatever the screen gives at that scale (design for 240 and up).
- Nearest-neighbour only, no smoothing. Positions may be fractional in the simulation and are rounded when drawn.
- Layout anchors: HUD and bricks to the top, horizon, paddle and sea to the bottom. Extra height goes into the open sky between them.

Tokens (shared/tokens.js, mirrored in shared/theme.css)
- sky-top #FFF7EC, sky-bottom #FFCDC0
- coral #F05A68 (paddle, wordmark), blue #4A6FA5 (ball, score)
- brick rows, top to bottom: #F05A68 #F77476 #FF8C7A #FFA38C #FF96B2 #F57DA8 #FFB2C4 #78B4D8 #A0D0E8
- sun #FFF4D6, cloud #FFFFFF
- sea bands #96D0E6 #84C4DE #74B8D6
- shade: any colour mixed 35 to 40 percent toward #783C5A. Highlight: mixed 45 to 50 percent toward white.

Rounded 8-bit shapes
- Every shape is a rectangle with stepped corners. Brick: 15 x 7 with 1 px corners cut. Paddle: 30 x 6 pill with 2-step corners. Ball: 5 x 5 with corners cut.
- Each has a 1 px highlight line just inside the top edge and a 1 px drop shade below it.

Scene (static in v1)
- Sky: 10 flat bands from sky-top to sky-bottom, with a 1 px checker dither seam between bands.
- Sun: a pale half-disc, radius 24, sitting on the horizon, right of centre.
- Sea: three blue bands below the horizon with short pale glint dashes. The sea is the thumb zone.
- Two or three small white pixel clouds in the open sky.

Lettering
- One hand-drawn rounded pixel font in shared/font.js: capitals and digits, drawn on canvas, with rounded outer corners. No web fonts anywhere.

Motion
- Only where it helps: brick pop particles (about 8 bits, 300 ms) and a ball trail of 3 fading squares.
- With prefers-reduced-motion: no particles, no trail.

## 4. Repo layout

- /index.html: the hub
- /shared/: tokens.js, theme.css, font.js, pixel.js (canvas setup, scaling, stepped-corner rect, dither, scene), haptics.js, store.js (localStorage in try/catch, versioned keys), settings.js
- /games/bricks/: index.html, bricks.js, physics.js
- /manifest.webmanifest, /sw.js, /icons/
- /docs/: PLAN.md, BACKLOG.md, CHANGELOG.md, style-reference.jpg
- README.md

## 5. Row H1: shell and hub (session 1)

Build
- The shared modules listed above.
- Hub: the sunset scene full screen on the pixel canvas. Wordmark RLX at the top. Game tiles as rounded pixel cards in the lower, thumb-reachable half: BRICKS (active), CATCH and STACK (marked SOON, not tappable). One tap on BRICKS opens the game.
- One setting on the hub: HAPTICS ON / OFF, stored. Switching it on fires one test tick.
- A Bricks placeholder page at /games/bricks/ (scene, the word BRICKS, a back control) so navigation can be tested.
- Back: a small control top-left in a game, and the Android back gesture, both return to the hub.
- Installable app: manifest (name, standalone, portrait, colours from tokens, icons 192 and 512 plus a maskable one, drawn in the same pixel style) and a service worker, cache-first with a versioned cache, so it runs offline and updates on a new deploy.
- Page hygiene: touch-action none on the canvas, no pull-to-refresh or overscroll, no text selection, no long-press menu, no zoom, safe-area insets respected.
- README: what it is, the hard rules, how to run it locally with any static server, how it deploys.

Accept
- On the Pages URL in Chrome for Android, at 360 to 412 CSS px wide: crisp pixels, no blur, no scrolling, no sideways overflow.
- Installs to the home screen; opens standalone, in portrait, and offline after the first load.
- Hub to Bricks placeholder and back works by tap and by back gesture.
- The haptics setting survives a reload.
- No console errors; no requests to any host but its own.

## 6. Row B1: Bricks (session 2)

Field
- 7 columns of 15 x 7 bricks with 2 px gaps, centred. A HUD line above: back control on the left, quiet score on the right.
- Score is the all-time count of bricks popped. Nothing ever resets it.
- Start with 9 rows, coloured by the brick-row tokens from top to bottom.

Endless refill
- When fewer than 35 bricks remain, every row slides down one row height over 400 ms and a new full row enters at the top. Colours keep cycling through the tokens.
- Bricks never go deeper than 12 rows. If a slide would push a row past that, the lowest row first fades out (no score, no haptic), then the slide happens. The field can never crowd the paddle and can never deadlock.

Ball
- One ball, 5 x 5. Constant speed of 95 logical px per second. It never accelerates.
- Physics on a fixed 120 Hz step in physics.js, which must not touch the DOM. Rendering on requestAnimationFrame.
- Left, right and top walls bounce.
- Paddle bounce sets the outgoing angle by where the ball lands: centre goes straight up, the edges go 60 degrees from vertical.
- After any bounce the path is never shallower than 20 degrees from horizontal; nudge it if needed. No flat loops.
- No tunnelling: sweep the collision so the ball cannot pass through a brick or the paddle between steps.

Miss
- A ball that falls into the sea makes a small splash. No haptic, no penalty, no message.
- After 600 ms a new ball rises from the centre of the paddle.

Paddle and control
- Paddle is 30 x 6 and sits 16 px above the horizon.
- Relative drag anywhere on screen: the paddle moves by the finger's horizontal movement times a sensitivity of 1.2, clamped to the field. It is never absolute positioning, so the thumb rests in the sea and never covers the paddle.

Pause and save
- No finger on the screen means paused: ball and timers freeze within one frame, and a thumb ring with left and right chevrons shows in the sea.
- Finger down resumes after 250 ms. The first launch starts in the same paused state.
- Save the full state (bricks, ball position and velocity, paddle position, score, colour index) on pause, when the page is hidden and on pagehide. Restore it on load.
- A corrupt or old-version save gives a fresh field and keeps the score if it can be read.

Haptics
- If the setting is on and navigator.vibrate exists: brick 8 ms, paddle 16 ms. Nothing else vibrates.
- At most one vibrate call per 40 ms.

Tuning and performance
- Ball speed, sensitivity, haptic lengths, refill threshold and resume delay sit in one config block at the top of bricks.js.
- Steady 60 fps on a current flagship. No animation loop while the page is hidden; while paused, redraw only on change.

Accept
- Ten minutes of play: no stuck ball, no flat loop, no tunnelling, and the refill never crowds the paddle.
- Lifting the thumb freezes play within one frame. Killing the app mid-flight and reopening shows the same field and ball position, paused.
- Brick and paddle ticks can be told apart by feel. With haptics off there are zero vibrate calls.
- The score survives restarts.
- A headless test runs physics.js in Node for 10 simulated minutes with a paddle that tracks the ball: no NaN, the ball stays in bounds, the brick count stays bounded.

After B1, Pedro plays it and reports on feel. Tuning is a follow-up row.

## 7. Process

- Nothing is built that is not a row of docs/BACKLOG.md, in three lists: Queue, Done, Parked. A done row leaves the Queue.
- Every session: a thin Sonnet 5.5 main chat, one fresh Opus 5.5 builder agent, then one fresh Opus 5.5 reviewer agent that did not see the build. The reviewer checks the row's Accept list and the hard rules. Every finding is fixed before the row closes.
- docs/CHANGELOG.md gets one entry per session: date, row, the models that actually ran, what was built, the review findings and their fixes, anything deferred.
- Anything deferred or newly proposed becomes a Proposed row. Proposals are listed on delivery and carried out in the next session unless Pedro vetoes one.
- The session's one reply ends with the next starter in a code block and any task only Pedro can do.

The starter for every later session:

    Clone apcanario/4rk4d3 (shallow, push access)
    RLX, next row: read docs/PLAN.md and docs/BACKLOG.md, build the first Queue row as written, close it by the Process section.

## 8. Parked

- P1 Catch: things fall, slide to catch them, a miss costs nothing.
- P2 Stack: blocks slide across, tap to drop them.
- P3 APK wrapper, with a native haptics bridge if the web ticks feel mushy.
- P4 A slow sky cycle through the phases of a sunset.
