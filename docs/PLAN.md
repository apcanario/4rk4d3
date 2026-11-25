# RLX: plan

## 1. What it is

A one-thumb arcade for Pedro's Android phone: a hub of small endless games to pick up and put down. Relaxed engagement, no thinking required. The first game is Bricks. It exists to replace doom scrolling.

## 2. Hard rules (every game, every screen)

- Android only: Chrome now, an APK WebView later. No iOS or Safari work of any kind.
- Portrait, one thumb. Each game defines its own gesture and its own pause behaviour in its row.
- Full screen. No game shows a title, a number, a button or any other HUD. The manifest's display mode is fullscreen.
- Going home: the Android back gesture (a swipe in from the side edge) returns from a game to the hub. There is no on-screen back control. Every game ignores a touch that begins within 24 CSS px of the left or right edge of the screen, so an edge swipe never moves anything in the game.
- No points of any kind: no score, count, rally, strokes, level number or difficulty marker, neither on screen nor stored.
- No saved game state. Nothing about a game is written to storage. Opening a game from the hub always starts it fresh. If Android kept the app alive in the background it carries on where it was; if not, it opens at the hub. Nothing at all is stored.
- No fail state: no lives, no game over, no timers, no streaks, no daily goals, no notifications, no leaderboards, no accounts, no ads, no network calls.
- No sound at all. Haptics are always on. There are no settings and no options anywhere: the hub is the game tiles and nothing else.
- Vanilla HTML, CSS and JS, ES modules, no build step, no dependencies, no CDN. Static files on GitHub Pages.
- Text on the hub never wraps or overflows its tile or button: fit the text size to the box.

## 2a. Evidence

Pedro asked for the games to fit what research says about winding down. Three findings drive the rules below.

- Flow needs a little challenge. In a 2018 experiment by Sweeny and colleagues, a too-easy Tetris bored players and a too-hard one frustrated them; the adaptive version produced the most flow, and more flow went with less worry.
- Recovery after work runs on detachment and on a sense of mastery (diary study in Applied Psychology, 2024; Collins and Cox, 2013). Pedro chose to drop all points and counts, so mastery here comes from the play itself, not from a number.
- ADHD symptoms are associated with gaming disorder (Koncz and colleagues, 2023, meta-analysis), so the app must make stopping easy.

None of these studies tested casual games as a wind-down for adults with ADHD. The rules are informed by research, not validated by it. RLX is described as a calm game and makes no health claim.

## 2b. Wind-down rules (every game)

Each game's row says how it applies these. A game may replace rule 1 with its own difficulty scheme.

1. Gentle adaptive pace. Each game has one hidden pace value. It rises slowly while play is clean and drops after a miss, inside tight bounds. It is never shown and never announced.
2. A sunset exit ramp, shared by all games.
   - A session clock counts active play time only. It lives in shared code, in memory, and is one clock across all games.
   - Over the first 10 minutes the scene moves from sunset to dusk in 10 visible steps: the sun sinks below the horizon, the sky bands shift to the dusk tokens, the sea darkens, a few white stars appear in the last steps.
   - From minute 10 to minute 12 the current game eases down to its gentlest and stays there.
   - Nothing locks and nothing is said. Playing on in the dusk is allowed.
   - The clock resets when the app starts, and when the page has been hidden for 5 minutes or more.
   - The hub shows the current phase of the scene.
3. Still banned: streaks, daily goals, notifications, leaderboards, variable rewards, anything that argues for one more go.

There is no skill number any more: the rule that asked for one is withdrawn, along with all points.

Dusk tokens (shared/tokens.js and theme.css)
- dusk sky-top #CDB8E0, dusk sky-bottom #F0A9A6
- dusk sea bands #6FA3C4 #5F93B8 #5083AB
- star #FFFFFF
- Each of the 10 steps is a flat mix between the sunset and dusk values. No smooth fades.
- Game pieces keep their colours in every phase and must stay clearly readable against the dusk scene.

Shared pieces, built once
- The session clock, the scene phase (a value from 0 to 1 that pixel.js draws in 10 steps), the dusk tokens and the stars are shared code. The first row that needs them builds them as described here. Every later row reuses them and changes nothing in them.

## 3. Look

Superseded in part by the hard rules of update 2; row X1 brings the build in line.

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

Superseded in part by the hard rules of update 2; row X1 brings the build in line.

- /index.html: the hub
- /shared/: tokens.js, theme.css, font.js, pixel.js (canvas setup, scaling, stepped-corner rect, dither, scene), haptics.js, store.js (localStorage in try/catch, versioned keys), settings.js
- /games/bricks/: index.html, bricks.js, physics.js
- /manifest.webmanifest, /sw.js, /icons/
- /docs/: PLAN.md, BACKLOG.md, CHANGELOG.md, style-reference.jpg
- README.md

## 5. Row H1: shell and hub (session 1)

Superseded in part by the hard rules of update 2; row X1 brings the build in line.

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

Superseded in part by the hard rules of update 2; row X1 brings the build in line.

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

## 6a. Row B2: Bricks fix

Bricks was built with a constant ball speed. This row gives it the adaptive pace and the exit ramp, and shortens the thumb travel.

Changes to section 6 (Bricks)
- Replace the constant ball speed with the pace: minimum 80, starting value 90, maximum 125 logical px per second.
- Each clean paddle return adds 1. Each miss takes off 12. The value is clamped to the range.
- A speed change takes effect only at a paddle bounce, never in mid-flight.
- In the dusk phase (minutes 10 to 12 of the session clock) the ceiling falls from 125 to 80, and the speed follows it down at paddle bounces.
- Opening Bricks, or a reset of the session clock, starts the speed at 90.
- Thumb travel: moving the thumb across 50 percent of the screen width carries the paddle from one end of its travel to the other. The build used about 65 percent, which is a stretch for one thumb. The sensitivity is derived from the fraction, not set as a fixed multiplier: sensitivity = paddle travel / (0.50 x screen width), which is about 1.56 for a 135 px field and a 30 px paddle. The fraction is one named value in shared config, so every drag game uses the same one.
- No rally number and no other number is added.

Build
- If shared code has no session clock and scene phase yet, build them as section 2b describes. If it has, reuse them.
- Bricks: the pace rule, the dusk slowdown, the thumb-travel fraction.
- Minimum, starting and maximum speed, gain per return and loss per miss go in the config block of bricks.js. The thumb-travel fraction, ramp length, slowdown length and reset gap go in shared config.
- The physics module stays free of the DOM. The clock is passed in.

Accept
- Speed never leaves the range of 80 to 125, in play and in the headless test, and never changes in mid-flight.
- After 12 minutes of active play the ball is at 80 and the scene is at full dusk. Paused time does not advance the clock.
- A thumb movement of 50 percent of the screen width moves the paddle exactly end to end, at 360 and at 412 CSS px wide. The paddle can still be placed to the pixel with a slow drag.
- Bricks, paddle and ball are readable in every one of the 10 scene steps.
- Everything B1 accepted about play still holds: no stuck ball, no flat loop, no tunnelling, pause within one frame, haptics unchanged.
- The headless test is extended to 15 simulated minutes with a tracking paddle that misses now and then: speed stays in range, falls to 80 by minute 12, and the brick count stays bounded.

## 6b. Row C1: Catch (session 4)

Superseded in part by the hard rules of update 2; row X1 brings the build in line.


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

## 6c. Row U1: Putt

docs/style-reference-putt.jpg is the approved look. Its lettering does not apply: nothing is written on screen.

Putt is a cross between snooker and mini golf, seen from above. The ball starts at the bottom, the hole is at the top, and banked shots off the walls get it there. Levels never end: each one is generated from random parameters.

It reuses the shared kit. If shared code has no session clock and scene phase yet, this row builds them as section 2b describes; if it has, it reuses them.

### Gesture and pause (this game's own)

- Gesture: pull back, aim, release. One thumb.
- Pause: none on lifting the thumb, because the ball rolls after release. Putt is turn-based, so it is idle whenever the ball is at rest. Closing the app saves, and reopening resumes the exact state.

### Look

- Top-down beach course in the existing palette. The course floor is sand (the cream of sky-top). Walls and cushions are coral with the usual highlight and drop shade. Around the course is sea, in the sea bands.
- Ball: the blue ball token, 5 x 5 with cut corners. Hole: a dark plum disc with a 1 px lighter rim and a tiny coral flag beside it.
- Blocks and pegs in salmon and pink. Sand traps in a deeper peach. Water in the sea blues with a glint dash.
- Diagonal walls are drawn as pixel stair-steps; the physics treats them as true 45 degree lines.
- No HUD: no title, no number, no button, no difficulty marker.
- The sunset exit ramp applies: sand and sea step toward the dusk tokens over 10 minutes, the same 10 steps as the other games.

### Course

- Logical width 135. The course is inset 6 px each side, starts 6 px from the top and ends 26 px above the bottom edge. Its height follows the screen.
- Tee: bottom of the course, within 20 px of centre.
- Hole: in the top fifth of the course, at a random x.

### Shot control

- Touch anywhere, pull back and release, like drawing a cue. The shot goes in the opposite direction to the pull. The drag is relative, so the thumb never has to be on the ball.
- Power is the pull length, capped at 60 logical px. A dotted guide runs from the ball to the first wall it would hit, plus the first 12 px of the rebound. A short bar by the ball shows power.
- Pulling back to within 4 px of the start and releasing cancels the shot.
- No input is taken while the ball is moving.

### Physics

- Fixed 120 Hz step in sim.js, no DOM, swept collisions so the ball cannot pass through a wall.
- Top launch speed 220 logical px per second. Constant deceleration of 55 px per second squared, as on a snooker cloth; the ball stops below 4 px per second. A full-power shot travels about 440 px, enough for two or three banks.
- Walls, blocks and pegs return 85 percent of the speed. Angle in equals angle out.
- Sand trap: deceleration is tripled while the ball is in it.
- Water: the ball plops and returns to where that shot was taken. The stroke still counts. Nothing else is lost.
- Hole: the ball drops if its centre comes within the hole radius at under 140 px per second. Faster than that, it skips over.

### Play

- Any number of tries. No par, no stroke count, no timer, no fail state.
- Starting over: go home and open Putt again. It opens on a new level.
- Sinking the ball: a short drop, then the next level slides in from the top after about 800 ms.

### Level generator (gen.js, no DOM)

Every level comes from a seed and a difficulty. The same seed and screen height always give the same level, which keeps the headless tests repeatable.

Difficulty
- Three levels of difficulty, called 1, 2 and 3 here. Each new course draws one at random with equal odds. The level is not shown on screen.
- In the dusk phase (minute 10 of the session clock onward) the draw is level 1 only. This is the exit ramp easing the game down, as rule 3 of the wind-down rules asks.
- This random draw is Putt's difficulty scheme, in place of the adaptive pace of wind-down rule 1.

Building blocks
- Outline: a rectangle, with 0 to 4 corners cut at 45 degrees (cut size 10 to 24 px).
- Bars: a straight wall from one side that leaves a gap of at least 22 px.
- Diagonals: free-standing 45 degree walls, 20 to 50 px long.
- Blocks: rectangles from 8 x 8 to 24 x 12.
- Pegs: round posts of radius 3.
- Sand traps and water: rectangles from 16 to 30 px a side.

Parameters by difficulty (each drawn at random inside its range)

| | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Cut corners | 0 to 2 | 1 to 3 | 2 to 4 |
| Bars | 0 to 1 | 1 to 2 | 2 to 3 |
| Diagonals | 0 to 1 | 1 to 2 | 2 to 3 |
| Blocks | 1 to 2 | 1 to 3 | 2 to 4 |
| Pegs | 0 | 0 to 2 | 1 to 3 |
| Sand traps | 0 | 0 to 1 | 0 to 1 |
| Water | 0 | 0 to 1 | 1 |
| Hole radius | 5 | 5 | 4 |
| Straight line from tee to hole | allowed | not allowed | not allowed |
| Strokes the solver needs | 1 to 2 | 2 to 3 | 3 to 4 |

Placement rules
- Every passage is at least 14 px wide.
- Nothing sits within 12 px of the tee or the hole.
- Pieces do not overlap each other.

Solvable, always
- Each candidate level is checked by a solver that uses the same sim.js: from the ball's position it tries 96 directions at 5 powers, keeps the best dozen resting spots, and searches up to the stroke limit of that difficulty.
- A level is kept only if the solver sinks the ball within the range in the table. Too easy for its difficulty is rejected as well as too hard.
- After 30 rejected candidates the generator falls back to an open level-1 course, so there is never a dead end.
- The next level is generated in the background while the current one is being played, in a Web Worker or in small slices, so there is never a wait between holes.

### Haptics

- Release 10 ms, wall or peg bounce 6 ms, ball dropping in the hole 24 ms. Nothing else. At most one vibrate call per 40 ms. Whenever navigator.vibrate exists.

### No saved state

- Nothing is stored. Opening Putt from the hub always starts on a new level.

### Files

- /games/putt/: index.html, putt.js, sim.js, gen.js. sim.js and gen.js must not touch the DOM.
- The hub gets a PUTT tile.
- Launch speed, deceleration, bounce, capture speed, pull cap, every range in the table, solver sampling and the reject limit sit in config blocks: play values in putt.js, generator values in gen.js.

### Accept

- 200 generated levels per difficulty in a headless Node run: every one is solved by the solver within its stroke range, none breaks a placement rule, and no level-2 or level-3 course has a straight line from tee to hole.
- The same seed and height give the same level every time.
- The ball never passes through a wall, never leaves the course, and always comes to rest.
- A ball in water returns to the spot the shot was taken from.
- No wait is visible between holes on Pedro's phone.
- Opening Putt from the hub always gives a new level. Nothing is written to storage.
- No text, number or button is on screen.
- From minute 10 of the session clock every new course is level 1.
- The three haptic ticks can be told apart.
- Every other game behaves exactly as before this row.

### Not included, on purpose

- No restart or skip control, no strokes, no counts, no difficulty marker.
- No moving obstacles.

## 6d. Row S1: Stack

A block slides from side to side above a tower. A tap drops it. The tower grows floor by floor and sinks slowly into the sea, so it never ends.

Gesture and pause (this game's own)
- Gesture: a tap anywhere on screen drops the block. One thumb.
- Pause: none on lifting the thumb. The block keeps sliding until it is dropped. The game pauses only when the page is hidden.

Look
- The shared sunset scene. The tower stands on the horizon, in the middle of the screen.
- Each floor is a rounded block 8 px tall, with the usual highlight line and drop shade. Colours cycle through the brick-row tokens, one per floor.
- No HUD of any kind.

Play
- The first floor is 60 px wide and already in place. Each new block starts with the width of the floor below it and slides at the height of the next floor, from wall to wall and back.
- Tap: the block drops straight down.
- The part that lands on the floor below stays. Any overhang breaks off as a few pixel bits that fall into the sea.
- Near-perfect drop (within 2 px of aligned): the block snaps into line, nothing breaks off, and the next block is 2 px wider, up to 60.
- Complete miss (no overlap at all): the block plops into the sea. The same block comes back. Nothing is lost.
- When a floor ends up narrower than 12 px, the next block is quietly 60 px wide again and lands as a fresh platform. There is no game over.
- Camera: once the top of the tower passes the middle of the screen, every drop slides the whole tower down by one floor. The lowest floors disappear behind the sea.

Pace and exit ramp
- Pace is the slide speed: minimum 40, starting value 50, maximum 80 logical px per second.
- A drop with 80 percent overlap or more adds 1. A drop with under 50 percent overlap, or a complete miss, takes off 8. Clamped to the range. A new speed applies from the next block.
- In the dusk phase the ceiling falls from 80 to 40, and the speed follows it down.
- Opening Stack, or a reset of the session clock, starts the speed at 50.

Haptics
- Drop that lands 8 ms, near-perfect drop 16 ms, nothing on a miss. At most one vibrate call per 40 ms. Whenever navigator.vibrate exists.

Files
- /games/stack/: index.html, stack.js, sim.js. sim.js must not touch the DOM.
- The hub's STACK tile becomes active.
- Block height, starting width, reset width, snap distance, width regained, speed range, gains and losses sit in one config block at the top of stack.js.
- If shared code has no session clock and scene phase yet, build them as section 2b describes. If it has, reuse them.

Accept
- 15 simulated minutes in a headless Node run with a player that taps with varying accuracy: no NaN, width stays between 0 and 60, speed stays between 40 and 80 and is 40 by minute 12, the tower never grows off the top of the screen.
- A floor narrower than 12 px is always followed by a 60 px block.
- A complete miss changes nothing but the pace.
- The two haptic ticks can be told apart.
- Opening Stack from the hub always starts a new tower. Nothing is written to storage.
- No text, number or button is on screen.
- Every other game behaves exactly as before this row.

## 6e. Row X1: Strip-down

Rows built before this update still carry things the new hard rules remove. This row takes them out of everything already built at that point: the hub, Bricks, Catch if it exists, and any other game present.

Build
- Remove every HUD: titles, back controls, scores, counts, rally or run numbers, difficulty markers, restart controls. Each game uses the whole screen.
- Remove all saving and restoring of game state. Remove the stored all-time counts. Remove the haptics setting, its switch on the hub, settings.js and store.js: haptics are always on and nothing is stored. Clear every stored key on first run so nothing stale is left behind.
- Opening a game from the hub starts it fresh, every time.
- Set the manifest's display mode to fullscreen.
- Going home is the Android back gesture only. Every game ignores touches that begin within 24 CSS px of the left or right edge.
- Hub: one active tile for every game that exists. No SOON tile for a game that is built.
- Update the README and sections 5 and 6 of PLAN.md so they describe what is now true.
- Check on Pedro's phone, in the installed app: an edge swipe in fullscreen returns to the hub with one swipe. If Android needs two swipes in fullscreen, say so in the reply and switch the manifest to standalone; that is the one thing in this row that cannot be verified from a desktop browser.

Accept
- No game screen shows any text, number or button.
- After play in every game, storage is empty.
- The hub shows the game tiles and nothing else: no switch, no setting.
- Catch uses the shared thumb-travel fraction: 50 percent of the screen width moves the boat end to end.
- Killing the app and reopening it opens the hub; opening a game starts it fresh.
- From every game, the back gesture returns to the hub, and an edge swipe never moves a paddle, a boat or an aim.
- Play itself is unchanged in every game: physics, pace, haptics and the exit ramp behave as before this row.
- The headless tests of every game still pass, with their save and count checks removed.

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

- P3 APK wrapper, with a native haptics bridge if the web ticks feel mushy.
