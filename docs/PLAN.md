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

## 2a. Evidence

Pedro asked for the games to fit what research says about winding down. Three findings drive the rules below.

- Flow needs a little challenge. In a 2018 experiment by Sweeny and colleagues, a too-easy Tetris bored players and a too-hard one frustrated them; the adaptive version produced the most flow, and more flow went with less worry.
- Recovery after work runs on detachment and on a sense of mastery (diary study in Applied Psychology, 2024; Collins and Cox, 2013).
- ADHD symptoms are associated with gaming disorder (Koncz and colleagues, 2023, meta-analysis), so the app must make stopping easy.

None of these studies tested casual games as a wind-down for adults with ADHD. The rules are informed by research, not validated by it. RLX is described as a calm game and makes no health claim.

## 2b. Wind-down rules (every game)

1. Gentle adaptive pace. Each game has one hidden pace value. It rises slowly while play is clean and drops after a miss, inside tight bounds. It is never shown and never announced. There is still no fail state.
2. One quiet skill signal. Each game shows the length of the current clean run as a small number. It resets silently on a miss. No best score, no record message, no celebration.
3. A sunset exit ramp, shared by all games.
   - A session clock counts active play time only (not paused time). It lives in shared code and is one clock across all games.
   - Over the first 10 minutes the scene moves from sunset to dusk in 10 visible steps: the sun sinks until it is below the horizon, the sky bands shift to the dusk tokens, the sea darkens, and a few white stars appear in the last steps.
   - From minute 10 to minute 12 the pace of the current game eases down to its minimum and stays there.
   - Nothing locks and nothing is said. Playing on in the dusk is allowed.
   - The clock resets when the app has had no active play for 5 minutes or more. The scene then starts again at sunset.
   - The hub always shows the current phase of the scene.
4. Still banned: streaks across days, daily goals, notifications, leaderboards, variable rewards, anything that argues for one more go.

New tokens (shared/tokens.js and theme.css)
- dusk sky-top #CDB8E0, dusk sky-bottom #F0A9A6
- dusk sea bands #6FA3C4 #5F93B8 #5083AB
- star #FFFFFF
- Each of the 10 steps is a flat mix between the sunset and dusk values. No smooth fades: the change is stepped, in keeping with the pixel look.
- Bricks, paddle, ball and lettering keep their colours in every phase. Check that all of them stay clearly readable against the dusk sky.

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
- One ball, 5 x 5.
- Ball speed follows the pace (section 2b): minimum 80, starting value 90, maximum 125 logical px per second.
- Each clean paddle return adds 1. Each miss takes off 12. The value is clamped to the range.
- A speed change takes effect only at a paddle bounce, never in mid-flight.
- In the dusk phase (minutes 10 to 12 of the session clock) the ceiling falls from 125 to 80, and the speed follows it down at paddle bounces.
- A new launch of the app, or a reset of the session clock, starts the speed at 90.
- Rally: the number of paddle returns since the last miss, shown small under the score in the same blue. It resets silently on a miss and is not stored between sessions.
- Rows H1 and B1 were built before the pace, rally and dusk rules existed. Row B2 adds them.
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

## 6a. Row B2: wind-down rules in Bricks (session 3)

Build
- shared: the session clock, the scene phase (a value from 0 to 1 that pixel.js draws in 10 steps), the dusk tokens, stars.
- Hub: draws the current phase.
- Bricks: the pace rule, the rally number, the dusk slowdown.
- Minimum speed, starting speed, maximum speed, gain per return, loss per miss, ramp length (10 minutes), slowdown length (2 minutes) and reset gap (5 minutes) go in the config blocks: game values in bricks.js, clock and scene values in shared.
- Save and restore: pace, session clock and the time of the last active play, alongside the existing state. Rally is not saved.
- The physics module stays free of the DOM. The clock is passed in, so the headless test can drive it.

Accept
- Speed never leaves the range of 80 to 125, in play and in the headless test.
- A speed change is never applied in mid-flight.
- After 12 minutes of active play the ball is at 80 and the scene is at full dusk. Paused time does not advance the clock.
- After 5 minutes without active play, the next session starts at sunset with the speed at 90.
- The rally number counts up on each paddle return and resets on a miss with no other effect.
- Bricks, paddle, ball and lettering are readable in every one of the 10 scene steps.
- Everything B1 accepted still holds: no stuck ball, no flat loop, no tunnelling, pause within one frame, exact resume, haptics unchanged.
- The headless test is extended: 15 simulated minutes with a tracking paddle that misses now and then; speed stays in range, falls to 80 by minute 12, and the brick count stays bounded.

After B2, Pedro plays it and reports whether the pace change is noticeable. It should not be.

## 6b. Row C1: Catch (session 4)


Sections 2, 2b, 3 and 7 apply unchanged. Catch reuses the shared kit from H1: tokens, pixel.js, font.js, haptics.js, store.js, settings.js.

docs/style-reference-catch.jpg is the approved look for this game. Its lettering is a placeholder; use the shared pixel font.

### Idea

A small boat on the sunset sea catches things that fall from the sky. Now and then something nasty falls, and a quick tap sends a fish leaping out of the water to eat it. Nothing can be lost.

### Scene

- The shared sunset scene: banded sky, sun on the horizon, clouds, three-band sea.
- The boat floats on the horizon line. The sea below it is the thumb zone and where the fish come from.
- HUD line at the top: back control on the left, quiet count on the right.

### Boat and control

- Boat: a coral hull, 24 x 7, stepped corners, with a short mast and a cream sail about 9 px tall. Highlight and drop shade as on every shape.
- The catch zone is the deck: the full hull width at its top edge.
- Relative drag anywhere on screen, sensitivity 1.2, clamped to the field. Same as Bricks.

### Things to catch

- Sprites of about 7 x 7 in the warm tokens (coral, salmon, pinks, cream), all rounded: shell, starfish, pearl, message bottle, coral sprig, sand dollar, seahorse, tiny sun.
- They fall straight down at a speed set by the pace (32 to 48 logical px per second) with a gentle sway of 3 px either side.
- One spawns every 1.1 to 1.7 seconds, as set by the pace, at a random x no more than 70 px from the previous spawn, so every item is reachable. Never more than 3 in the air.
- Caught: it lands on the deck. The boat dips 1 px for 100 ms, haptic 8 ms, count plus one.
- Missed: it reaches the water with a 3 px splash. No haptic, no message, nothing lost.
- Variety: the game starts with 2 kinds in the mix. A new kind joins every 40 catches until all 8 are in, then the order reshuffles. Cosmetic only.

### The nasty ones

- Kinds: sea urchin, jellyfish, ink blob. All in the blue token with its shade, all spiky or ragged. Warm and round means catch it; blue and spiky means send the fish. Shape carries the difference, not colour alone.
- One falls every 20 to 30 seconds, taking the place of a normal spawn. Never more than one in the air.
- It falls slower, at 30 logical px per second, so there is time to react.

### The fish

- A tap is a touch that goes down and up within 200 ms and moves less than 4 logical px. It can land anywhere on screen.
- Tap with a nasty in the air: a fish leaps from the sea directly below it at about 220 logical px per second, eats it where they meet, arcs over and dives back with a splash. Haptic 16 ms on the bite.
- Tap with no nasty in the air: a fish does a small hop beside the boat. No haptic. A tap is never wrong.
- Fish sprites of about 9 x 5, a random kind on each leap. The game starts with 2 kinds; a new one joins every 5 nasties eaten, up to 6.

### If a nasty lands uneaten

- On the boat: the boat rocks 1 px side to side for one second. The count does not change.
- In the water: an ink cloud darkens the sea bands for 4 seconds, then fades.
- No haptic for either. Nothing is lost.

### Rare treat (added by Claude, not asked for; veto freely)

- Every 90 to 150 seconds one slow item drifts down on a tiny parachute.
- Catching it sets off one small sky event: a gull crossing, a dolphin arcing on the horizon, or the sun glinting. Missing it does nothing.

### Pause and save

- Catch needs a grace period so a tap is not read as a pause: play continues for 400 ms after the finger lifts, then pauses. The boat holds its position during the grace.
- Finger down while paused resumes after 250 ms. That touch never counts as a tap.
- Bricks keeps its immediate pause. If the input handling lives in shared code, the grace becomes a parameter that defaults to zero, and Bricks' behaviour is checked unchanged.
- Save on pause, when the page is hidden and on pagehide: items in the air, boat position, counts, spawn timers, which kinds are unlocked. Restore on load. A corrupt or old-version save gives a fresh scene and keeps the counts if they can be read.

### Counts

- The HUD shows the all-time number of things caught. Nothing resets it.
- The number of nasties eaten is stored and drives the fish variety. It is not shown.

### Pace, skill signal and exit ramp

Catch follows the wind-down rules of section 2b. C1 is built after B2, so the session clock, the scene phase and the dusk tokens already exist in shared code.

- Pace is a hidden value from 0 to 1, starting at 0.3 on a new launch or after a session-clock reset.
- Each catch adds 0.02. Each missed item takes off 0.15. A nasty landing uneaten does not change it. Clamped to 0 and 1.
- Pace sets two things, both linearly: fall speed from 32 (pace 0) to 48 (pace 1) logical px per second, and the spawn gap from 1.7 down to 1.1 seconds. A new value applies to items spawned after the change, never to items already in the air.
- The nasty ones do not follow the pace: 30 px per second, every 20 to 30 seconds, always.
- Skill signal: the run of catches since the last miss, shown small under the count, reset silently on a miss, not stored between sessions.
- Exit ramp: the shared sunset to dusk over 10 minutes of active play. From minute 10 to minute 12 the pace ceiling falls from 1 to 0 and the pace follows it down.
- No sound.

### Haptics

- Catch 8 ms, fish bite 16 ms, nothing else. At most one vibrate call per 40 ms. Only if the setting is on and navigator.vibrate exists.

### Files

- /games/catch/: index.html, catch.js, sim.js. The simulation in sim.js must not touch the DOM.
- The hub's CATCH tile becomes active.
- Pace gains and losses, fall-speed range, spawn-gap range, nasty interval, tap thresholds, pause grace, fish speed and haptic lengths sit in one config block at the top of catch.js.

### Accept

- Ten minutes of play: every spawned item is reachable, never more than 3 items and 1 nasty in the air, no item stuck or lost off screen.
- A tap with a nasty in the air always produces a bite before the nasty lands, wherever the nasty is.
- A tap is never read as a pause, and a slow lift (over 200 ms) never fires a fish.
- Lifting the thumb pauses after the grace period. Killing the app and reopening shows the same scene, paused.
- A nasty landing uneaten changes nothing but the cosmetics described.
- Catch and bite ticks can be told apart by feel. With haptics off there are zero vibrate calls.
- Bricks behaves exactly as before this row.
- Pace stays between 0 and 1, never changes the speed of an item already falling, and reaches 0 by minute 12 of active play.
- Boat, items, nasties and fish are readable in every one of the 10 scene steps.
- A headless test runs sim.js in Node for 15 simulated minutes with a boat that tracks the nearest item, misses now and then, and taps on every nasty: no NaN, item counts stay within the limits, every nasty is eaten, pace stays in range and is 0 by minute 12.

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

- P2 Stack: blocks slide across, tap to drop them. When specced it takes the wind-down rules: the pace is the slide speed, the skill signal is the run of clean drops, the exit ramp is the shared sunset.
- P3 APK wrapper, with a native haptics bridge if the web ticks feel mushy.
