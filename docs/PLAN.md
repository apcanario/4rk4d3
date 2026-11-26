# RLX: plan

## 1. What it is

A one-thumb arcade for Pedro's Android phone: a hub of small endless games to pick up and put down. Relaxed engagement, no thinking required. The first game is Bricks. It exists to replace doom scrolling.

## 2. Hard rules (every game, every screen)

- Android only: Chrome on the Pages URL, and the same files bundled in the Android app for Google Play (row P3, §6f). No iOS or Safari work of any kind.
- Portrait, one thumb. Each game defines its own gesture and its own pause behaviour in its row.
- Full screen. No game shows a title, a number, a button, a pause marker or any other HUD (X33: no pause marker anywhere; a paused game shows its frozen scene only). The manifest's display mode is fullscreen.
- Going home: the Android back gesture (a swipe in from the side edge) returns from a game to the hub. There is no on-screen back control. Every game ignores a touch that begins within 24 CSS px of the left or right edge of the screen, so an edge swipe never moves anything in the game.
- No points of any kind: no score, count, rally, strokes, level number or difficulty marker, neither on screen nor stored.
- No saved game state. Nothing about a game is written to storage. Opening a game from the hub always starts it fresh. If Android kept the app alive in the background it carries on where it was; if not, it opens at the hub. Nothing at all is stored.
- No fail state: no lives, no game over, no timers, no streaks, no daily goals, no notifications, no leaderboards, no accounts, no ads, no network calls.
- No sound at all. Haptics are always on. There are no settings and no options anywhere: the hub is the four game cards and nothing else.
- Vanilla HTML, CSS and JS, ES modules, no build step, no dependencies, no CDN. Static files on GitHub Pages. The Android app (§6f) copies these same files unchanged into a Capacitor shell; the shell's npm packages and Gradle build are the app's packaging, and no page loads anything from them.
- No text anywhere: no page draws a letter or a digit, the hub included (row H2). The app's name lives only in the manifest and the icons.
- Theme follows the phone (update 3, row D1): dark mode on the phone means the dark theme in RLX, on the hub and in every game. No toggle, no stored preference.
- Every colour is a token with a light and a dark value. No colour literal in a game or in the hub.
- Contrast holds in both themes: anything the player has to track (ball, puck, paddle, mallets, bricks, things to catch, boat, hole, blocks, obstacles) meets the §3 B4 standard against what is behind it, in light and in dark, at every step of the exit ramp.
- Row A1 adds a fifth game card to the hub; "the four game cards" above then reads five.

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

Choices made in the build (in force)
- The session clock counts active play only and lives in memory, never saved. It resets when the app starts and when the page has been hidden for 5 minutes or more, and also if the device clock went backwards while hidden. A game left open but paused no longer resets it. After a reset the pace restarts at the next play start (Bricks, Catch) or on show (Stack); a ball or block already moving keeps its speed until its next paddle bounce or drop.
- The scene has sunset plus 10 steps, one per whole minute of active play, full dusk at minute 10. The sun sinks round(24 x step / 10) px. Stars are 3 x 3 white crosses, 2, 4 and 6 at steps 8, 9 and 10, spread over the open sky. Clouds and glints stay.
- The dusk ceiling falls linearly over minutes 10 to 12. In Bricks a new serve after a miss takes the current pace, and both a miss and a serve are clamped to the falling ceiling.
- Chrome lets a page vibrate only after a tap on it. A game opened from its hub card gets that tap from the card; a game page loaded on its own (or reloaded) cannot vibrate until its first lift. Accepted for every game; the headless tests cannot see Chrome's gate (they use a stub), only the activation check in tests/check.py does.
- The hub holds the one clock in memory and each game it opens uses it, so there is one clock for all games. A game page opened on its own URL has a clock of its own and no way back to the hub (the back gesture leaves the app); this is accepted.
- Stored rlx.* keys are cleared on every start; other keys on the origin are kept.

## 3. Look

The hard rules of update 2 removed every HUD, score and count, so the HUD and score parts below are void; since row H2 the hub draws no text either, so the lettering applied to the app icons only (tools/make-icons.py), and since P3 the icons have none. The B4 contrast pass changed some values (list at the end of this section).

Light summer sunset, rounded 8-bit. docs/style-reference.jpg is the approved reference; match it.

Pixel grid
- Logical width is 135 px. Scale is the largest integer that fits the screen width in device pixels; the canvas is centred. Logical height is whatever the screen gives at that scale (design for 240 and up).
- Nearest-neighbour only, no smoothing. Positions may be fractional in the simulation and are rounded when drawn.
- Layout anchors: HUD and bricks to the top, horizon, paddle and sea to the bottom. Extra height goes into the open sky between them. (The hub is the exception since row H2: its horizon sits just above the card grid, §5a.)

Tokens (shared/tokens.js, mirrored in shared/theme.css)
- sky-top #FFF7EC, sky-bottom #FFCDC0
- coral #F05A68 (paddle, hub card frames), blue #4A6FA5 (ball, score)
- brick rows, top to bottom: #F05A68 #F77476 #FF8C7A #FFA38C #FF96B2 #F57DA8 #FFB2C4 #78B4D8 #A0D0E8
- sun #FFF4D6, cloud #FFFFFF
- sea bands #96D0E6 #84C4DE #74B8D6
- shade: any colour mixed 35 to 40 percent toward #783C5A. Highlight: mixed 45 to 50 percent toward white.

Rounded 8-bit shapes
- Every shape is a rectangle with stepped corners. Brick: 15 x 7 with 1 px corners cut. Paddle: 30 x 6 pill with 2-step corners. Ball: 5 x 5 with corners cut.
- Each has a 1 px highlight line just inside the top edge and a 1 px drop shade below it.

Scene (static in v1)
- Sky: 10 flat bands from sky-top to sky-bottom, with a 1 px checker dither seam between bands.
- Sun: a pale half-disc, radius 24, sitting on the horizon, right of centre (on the hub it grows with the sky, §5a).
- Sea: three blue bands below the horizon with short pale glint dashes. The sea is the thumb zone.
- Two or three small white pixel clouds in the open sky.

Lettering
- One hand-drawn rounded pixel font in shared/font.js: capitals and digits, with rounded outer corners. No web fonts anywhere. Since row H2 no page loads it, and since row P3 the icons are drawn from tools/rlx_art.py with no lettering (X35 proposes removing the font).

Motion
- Only where it helps: brick pop particles (about 8 bits, 300 ms) and a ball trail of 3 fading squares.
- With prefers-reduced-motion: no particles, no trail.

B4 contrast pass (in force; replaces the value above where they differ)
- Blue #436495 (ball, nasty ones). Ink #30486B for small lettering and control edges on the sea. Sail and card #A0D0E8 (the sail is no longer cream). Brick row 7 #FFA2CE; the jib is brick row 6.
- A 1 px edge all round, 70 percent toward #783C5A, on the paddle, hull, mast, the edge round each hub card's window (row H2; before it the tiles and wordmark), and the outlines of things to catch and fish. (The white tile lettering in a 1 px outline went with the tiles in H2.) The hub's card frames sit on the sea, so their outer 1 px edge is the keel colour, as the hull's rows below the horizon. (The pause ring, white in an ink edge, was removed by X33.)
- Keel #241E38 (the hull's rows below the horizon). Glint #FFA2CE (the sky-event glint and the spray). Ink cloud #483080 mixed 0.45 into each sea band.
- Standard in place of "readable": every game piece against every scene step meets CIE76 delta E 20 or better (tests/contrast.mjs), WCAG contrast 3 for edges and fills seen as one shape, and WCAG 4.5 for small lettering.
- Outside the standard (accepted, 2026-11-26, X16): the ball trail (delta E 16.42 from the sky), a pop particle's highlight bit and the splash's white top (their other bits carry them).

Dark theme (update 3; row D1 builds it): the same beach at night
- Sky: deep plum to violet, a crescent moon where the sun is, stars from the first step.
- Sea: navy bands with a pale moon path where the sun glints are.
- Sand: dark violet.
- Pinks, corals and blues stay the object colours, lightened only where the contrast check needs it.
- The exit ramp (§2b) still runs. In dark it starts at night and deepens: the same steps, the same slowing of the games, darker end values. Play behaviour is identical in both themes.
- Starting values. The contrast check decides: a value may move by the smallest step that passes, and every moved value is listed in the changelog.
  - skyTop #141026, skyBottom #3A2152; dark DUSK skyTop #0C0918, skyBottom #241436
  - sun (the moon in dark) #FFE9C9; cloud #4C3A6E; star #FFFFFF
  - sea bands #24406B #1F3760 #1C2F55; dark DUSK sea bands #1A2F52 #162849 #132140
  - coral #FF7385; blue (ball, nasty ones) #8FB8E8; ink #CDD6FF; keel #0A0714; glint #FFA2CE
  - brick rows: unchanged unless the check fails
  - sand #2B2142 and wet sand #3B2C58 (light: #FFE6D2 and #FFCFBA; new tokens, used by U2 and A1); foam and lines #CDD6FF (light #FFFAF3)
  - shade and edge mix target #0A0714 where the piece sits on a light ground, toward white where it sits on the dark ground: the builder picks per piece what meets the standard and writes it here
  - highlight: toward white at about half the light amount
- Values the design chat did not set (sail, card, inkCloud, any token added since): the builder derives them by the same rule and lists them in the changelog.
- Built by row D1: the values in force, and every value the contrast check moved, are listed under §6g "Choices made in the build".

## 4. Repo layout

Brought in line with the hard rules of update 2 by row X1.

- /index.html: the hub. It opens each game in a frame over itself and closes it on the back gesture.
- /hub/cards.js: the hub's card grid (row H2): the layout, and each card's frame and window. No DOM; it reuses the Catch sprite masks from games/catch/sim.js.
- /shared/: tokens.js (row D1: the LIGHT and DARK sets; tokens() returns the one the phone's prefers-color-scheme picks, onThemeChange() tells a page of a switch), theme.css (both sets, the dark one in a prefers-color-scheme block), font.js (no page loads it since H2 and, since P3, the icons do not use it either; X35), native.js (row P3: inside the Android app, inApp() and the native haptics plugin), pixel.js (canvas setup, scaling, stepped-corner rect, dither, scene, the shared input values, clearing old stored keys), haptics.js, session.js (the session clock and scene phase, in memory)
- /games/bricks/: index.html, bricks.js, physics.js
- /games/catch/: index.html, catch.js, sim.js
- /games/putt/: index.html, putt.js, sim.js, gen.js
- /games/stack/: index.html, stack.js, sim.js
- /manifest.webmanifest, /sw.js, /icons/
- /docs/: PLAN.md, BACKLOG.md, CHANGELOG.md, style-reference.jpg, style-reference-catch.jpg, style-reference-putt.jpg
- /android-app/: the Android app for Google Play (row P3, §6f): capacitor.config.json, package.json and its lock, android/ (the Gradle project, the native haptics plugin and MainActivity). android-app/www is a copy made by tools/build-www.mjs and is not in git.
- /docs/PLAY.md and /docs/play/: the release steps and the store listing, Data safety, content rating, privacy policy page source, icon, feature graphic and screenshots. /privacy-policy.html is served by GitHub Pages and not shipped in the app.
- /.github/workflows/android.yml: the app's build (debug APK, and a signed bundle when the signing secrets exist).
- /tools/, /tests/: helper scripts and the headless tests, not shipped. The games expose test hooks (canvas.dataset.scene, window.__bricks and the like) that the games never read.
- README.md

## 5. Row H1: shell and hub (session 1)

Brought in line with the hard rules of update 2 by row X1.

Build
- The shared modules listed above.
- Hub (replaced by row H2, §5a): the sunset scene full screen on the pixel canvas and one card per built game, Bricks, Catch, Putt and Stack, in a 2x2 grid. No wordmark, no text. Cards and nothing else: no switch, no setting. One tap on a card opens its game.
- Opening a game: the hub opens it full screen in a frame over itself, made fresh on every opening, and adds one history entry. The page never leaves the hub, so the session clock stays in memory across games.
- Back: the Android back gesture returns from a game to the hub and removes the game. There is no on-screen back control.
- Nothing is stored. At every start, any rlx.* key an earlier build left in localStorage or sessionStorage is removed.
- Installable app: manifest (name, fullscreen, portrait, colours from tokens, icons 192 and 512 plus a maskable one, drawn in the same pixel style) and a service worker, cache-first with a versioned cache, so it runs offline and updates on a new deploy.
- Page hygiene: touch-action none on the canvas, no pull-to-refresh or overscroll, no text selection, no long-press menu, no zoom, safe-area insets respected.
- README: what it is, the hard rules, how to run it locally with any static server, how it deploys.

Accept
- On the Pages URL in Chrome for Android, at 360 to 412 CSS px wide: crisp pixels, no blur, no scrolling, no sideways overflow.
- Installs to the home screen; opens fullscreen, in portrait, and offline after the first load.
- Hub to each game and back works by tap and by back gesture.
- Storage stays empty.
- No console errors; no requests to any host but its own.

Choice made in the build (X1): the hub creates each game's fullscreen frame on the card's pointerdown and shows it on pointerup, with one history.pushState entry. The back gesture removes the frame, so the page never leaves the hub and its clock lives on. A reload on a game's history entry opens the hub. Safe-area insets inside the frame come from the hub's probe.

## 5a. Row H2: the card grid hub

Superseded in part by update 3; row A1 (§6i) brings the build in line: five cards in a 2 by 3 grid.

Pedro chose option 1 of four hub mockups (2026-11-26): the grid. After the build he asked (2026-11-26) for the cards in the thumb's reach, low on the screen, with the sky above them as the picture; the layout below is that second version.

What it is
- The hub is a 2x2 grid of four big framed cards over the sunset scene, each a small window onto its game, drawn in that game's own scene colours: Bricks top left (three columns of coloured bricks, the ball with its trail, the paddle), Catch top right (the boat, the sun, the sea, things falling, a leaping fish), Putt bottom left (the hole and flag, the ball with its dotted aim guide, a coral bar, a peg, water, a sand trap, a block where the card is tall enough), Stack bottom right (a tower of floors, the next block above, the sea at the base).
- Each card: a coral frame with a 1 px keel-coloured edge all round (the cards sit on the sea; §3 B4), stepped corners (3 px outside, 1 px on the window), a highlight line at the top and a drop shade at the bottom; the window inside its own 1 px coral edge (70 percent toward #783C5A). Every colour is a token or a PLAN §3 mix; the pieces are drawn as their games draw them (the Catch sprites come from games/catch/sim.js).
- No app name, no wordmark, no text of any kind. The cards are static. The windows follow the exit ramp with the scene: their sky, sea, sand and sun step toward dusk with the hub's background (§2b), the pieces keep their colours.
- Behaviour as the hub before it (§5): the frame is made on the card's pointerdown and shown on pointerup with one history entry; the back gesture returns; a touch that slides off a card opens nothing; a touch that begins within 24 CSS px of a side edge opens nothing; the session clock is the hub's. Nothing stored, no settings.
- Code: hub/cards.js (layout, parts, drawing; no DOM) and index.html.

Layout rule (code: hub/cards.js GRID, gridLayout, hubScene)
- Side margin: the larger of 4 px, the 24 CSS px side band in logical px, and each side's safe inset plus 2. The two columns share the rest equally, with a 5 px gap; the rows have the same 5 px gap.
- The grid sits low, in the thumb's reach: its bottom is the larger of 8 px and 5 percent of the logical height above the bottom safe inset.
- The cards are at most 1.3 times as tall as they are wide (the approved mockup is about 1.25) and that tall wherever it fits, which it does from logical height 240 up (with safe insets up to the tested 32 CSS px at the top and 16 at the bottom); they are never under 40 px either way. At 360 CSS px wide (device scale 2.625 or 3) they are 56 x 72; at 412 CSS px, 57 x 74 (2.625) or 58 x 75 (3), the same at logical heights 240, 300 and 400.
- The horizon is 8 px above the grid: the cards sit on the sea, and the sea runs from the horizon to the bottom of the screen behind and below them, in the scene's three sea bands at the game's 13 : 14 : 15 proportions. Only the glints in the 8 px strip above the cards are drawn. The open sky above the horizon is at least 40 px below the top safe inset.
- Everything above the horizon is the picture: the sky bands, the sun on the horizon with a radius of 0.3 of the sky's height (24 to 40 px), sinking with the steps, at x 96 as in the games or further left so the whole disc stays at least 4 px inside the right edge (x = min(96, 135 - radius - 4); review of 7df2da1: at radius 40 the disc ran to the edge); three clouds at 0.1, 0.42 and 0.72 of the sky's height, clear of the sun, and over logical height 300 a fourth at x 58, 0.24 of the sky; the stars of steps 8 to 10 spread over the sky above the sun. The sun never reaches a card: it sits wholly above the horizon, 8 px above the grid.
- The sea round the cards has a few glint dashes of its own (hub/cards.js seaGlints): one in each side margin when the margin is 7 px or more, two 3 px below the grid and a third 7 px below where the sea allows, each at least 2 px clear of every card, so the 1 px ring round each frame stays bare sea. drawScene takes them as an optional list; the games pass none and draw exactly as before.
- Integer logical pixels throughout, one integer scale.
- Bricks card: its bricks are 13 px wide at these card widths (14 at 58 px), three columns in the window, a departure from the game's 15; the card is a picture, not the game.
- Stack card: floor 0's bottom sits on the window's horizon, as in the game (games/stack/sim.js floorTop).
- Note: sw.js still precaches shared/font.js, which no page loads since H2 and nothing reads since P3 (the icons are drawn from tools/rlx_art.py); harmless, its removal is the Proposed row X35.

Accept
- Four equal cards in a 2x2 grid in the order above, 5 px gaps across and down, centred, each at least 40 logical px each way, inside the safe area and clear of the side band, at logical heights 240, 300 and 400, widths 360 and 412 CSS px, device scale 2.625 and 3, with and without safe-area insets.
- The grid's bottom at the margin above; the cards at the stated sizes and at most 1.3 times as tall as wide; the horizon 8 px above the grid; the whole sun, at its radius, on the horizon in the sky and clear of the cards at sunset; sea behind and below the cards.
- The hub draws no text and loads no font.
- Each card opens its own game full screen over the hub; back returns; a touch beginning in the side band opens nothing; a slide off a card opens nothing.
- B4 standard: each card's frame (coral fill or keel edge) against every scene colour under it and in the 1 px ring round it, read from the hub's own scene, and every piece inside a card (fill or edge, by its game's rule) against the window colours behind it, at sunset and all 10 steps. The ball trail stays outside the standard as in the game (§3, X16).
- Each window draws only its own scene colours and its pieces' colours; no two pieces in a card overlap (the parts of the boat and of the hole and flag aside); every piece lies inside its window.
- The hub shows the phase of the session clock as before (sunset, step 5, dusk; the reset after 5 minutes hidden).
- The whole sun at least 4 px clear of both side edges at every tested height; a fourth cloud over logical height 300; the hub's sea glints 2 px clear of every card.
- Crisp pixels, no scrolling. Not verifiable headless: how the cards look and feel on the phone (X34).

## 6. Row B1: Bricks (session 2)

Brought in line with the hard rules of update 2 by row X1.

Field
- 7 columns of 15 x 7 bricks with 2 px gaps, centred. No HUD: the field starts 5 px below the top of the screen (inside the safe area).
- No score and no count of any kind.
- Start with 9 rows, coloured by the brick-row tokens from top to bottom.

Endless refill
- When fewer than 35 bricks remain, every row slides down one row height over 400 ms and a new full row enters at the top. Colours keep cycling through the tokens.
- Bricks never go deeper than 12 rows. If a slide would push a row past that, the lowest row first fades out (no haptic), then the slide happens. The field can never crowd the paddle and can never deadlock.

Ball
- One ball, 5 x 5.
- Ball speed follows the pace (section 2b): minimum 80, starting value 90, maximum 125 logical px per second.
- Each clean paddle return adds 1. Each miss takes off 12. The value is clamped to the range.
- A speed change takes effect only at a paddle bounce, never in mid-flight.
- In the dusk phase (minutes 10 to 12 of the session clock) the ceiling falls from 125 to 80, and the speed follows it down at paddle bounces.
- Opening Bricks, or a reset of the session clock, starts the speed at 90.
- Rows H1 and B1 were built before the pace and dusk rules existed. Row B2 adds them.
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
- Relative drag anywhere on screen: the paddle moves by the finger's horizontal movement on the shared thumb travel (section 6a), clamped to the field. It is never absolute positioning, so the thumb rests in the sea and never covers the paddle. A touch that begins within 24 CSS px of the left or right edge is ignored.

Pause
- No finger on the screen means paused: ball and timers freeze within one frame. Nothing marks the pause on screen (X33, 2026-11-26: the thumb ring with chevrons was removed).
- Finger down resumes after 250 ms. Every opening starts in the same paused state.
- Nothing is saved. The page hidden or closed pauses at once. Opening Bricks always starts a fresh field.

Haptics
- Whenever navigator.vibrate exists: brick 8 ms, paddle 16 ms. Nothing else vibrates.
- At most one vibrate call per 40 ms.

Tuning and performance
- Ball speed, haptic lengths, refill threshold and resume delay sit in one config block at the top of bricks.js.
- Steady 60 fps on a current flagship. No animation loop while the page is hidden; while paused, redraw only on change.

Accept
- Ten minutes of play: no stuck ball, no flat loop, no tunnelling, and the refill never crowds the paddle.
- Lifting the thumb freezes play within one frame. Killing the app and reopening opens the hub; opening Bricks starts a fresh field, paused.
- Brick and paddle ticks can be told apart by feel.
- No text, number or button is on screen. Nothing is written to storage.
- A headless test runs physics.js in Node for 10 simulated minutes with a paddle that tracks the ball: no NaN, the ball stays in bounds, the brick count stays bounded.

After B1, Pedro plays it and reports on feel. Tuning is a follow-up row.

Choices made in the build (in force)
- A new ball is served 10 degrees from vertical, alternating sides. Loop breaker: each launch counts toward a loop when no brick was popped since the last one; from the 3rd the path is nudged, 8 degrees more on each launch, alternating sides, capped at 70 degrees. A wedged ball escapes. The first finger down drives the paddle; a second finger does not move it, and when the first lifts the next takes over from where it is.
- Without the HUD the field starts 5 px below the top plus the safe-area inset.
- No pause marker (X33, 2026-11-26): the ring and chevrons were removed; Pedro found them not needed.
- The ball speed, the pace, 10 degree serve and 8 degree nudge are in CONFIG at the top of bricks.js; the thumb travel is shared (section 6a).
- A Bricks page loaded without a tap from the hub (direct URL, or Chrome reloading it) cannot vibrate until its first lift, because Chrome wants a tap on the page first. Accepted: no in-page fix exists without changing the controls.

## 6a. Row B2: Bricks fix

Bricks was built with a constant ball speed. This row gives it the adaptive pace and the exit ramp, and shortens the thumb travel.

Changes to section 6 (Bricks)
- Replace the constant ball speed with the pace: minimum 80, starting value 90, maximum 125 logical px per second.
- Each clean paddle return adds 1. Each miss takes off 12. The value is clamped to the range.
- A speed change takes effect only at a paddle bounce, never in mid-flight.
- In the dusk phase (minutes 10 to 12 of the session clock) the ceiling falls from 125 to 80, and the speed follows it down at paddle bounces.
- Opening Bricks, or a reset of the session clock, starts the speed at 90.
- Thumb travel: moving the thumb across 28 percent of the screen width carries the paddle from one end of its travel to the other (Pedro's feel reports, 2026-11-26: 50 percent was still too much, then 35 percent was still about 20 percent too much; the first build used about 65 percent). The sensitivity is derived from the fraction, not set as a fixed multiplier: sensitivity = paddle travel / (0.28 x screen width), which is about 2.8 for a 135 px field and a 30 px paddle. The fraction is one named value in shared config, so every drag game uses the same one.
- No rally number and no other number is added.

Build
- If shared code has no session clock and scene phase yet, build them as section 2b describes. If it has, reuse them.
- Bricks: the pace rule, the dusk slowdown, the thumb-travel fraction.
- Minimum, starting and maximum speed, gain per return and loss per miss go in the config block of bricks.js. The thumb-travel fraction, ramp length, slowdown length and reset gap go in shared config.
- The physics module stays free of the DOM. The clock is passed in.

Accept
- Speed never leaves the range of 80 to 125, in play and in the headless test, and never changes in mid-flight.
- After 12 minutes of active play the ball is at 80 and the scene is at full dusk. Paused time does not advance the clock.
- A thumb movement of 28 percent of the screen width moves the paddle exactly end to end, at 360 and at 412 CSS px wide. The paddle can still be placed to the pixel with a slow drag.
- Bricks, paddle and ball are readable in every one of the 10 scene steps.
- Everything B1 accepted about play still holds: no stuck ball, no flat loop, no tunnelling, pause within one frame, haptics unchanged.
- The headless test is extended to 15 simulated minutes with a tracking paddle that misses now and then: speed stays in range, falls to 80 by minute 12, and the brick count stays bounded.

## 6b. Row C1: Catch (session 4)

Brought in line with the hard rules of update 2 by row X1.


Sections 2, 2b, 3 and 7 apply unchanged. Catch reuses the shared kit: tokens, pixel.js, haptics.js, session.js.

docs/style-reference-catch.jpg is the approved look for this game. Its lettering does not apply: nothing is written on screen (§2).

### Idea

A small boat on the sunset sea catches things that fall from the sky. Now and then something nasty falls, and a quick tap sends a fish leaping out of the water to eat it. Nothing can be lost.

### Scene

- The shared sunset scene: banded sky, sun on the horizon, clouds, three-band sea.
- The boat floats on the horizon line. The sea below it is the thumb zone and where the fish come from.
- No HUD: things fall from 5 px below the top of the screen (inside the safe area).

### Boat and control

- Boat: a coral hull, 24 x 7, stepped corners, with a short mast and a cream sail about 9 px tall. Highlight and drop shade as on every shape.
- The catch zone is the deck: the full hull width at its top edge.
- Relative drag anywhere on screen, clamped to the field, on the shared thumb travel: moving the thumb across 28 percent of the screen width carries the boat from one end of the field to the other (section 6a). A touch that begins within 24 CSS px of the left or right edge is ignored.

### Things to catch

- Sprites of about 7 x 7 in the warm tokens (coral, salmon, pinks, cream), all rounded: shell, starfish, pearl, message bottle, coral sprig, sand dollar, seahorse, tiny sun.
- They fall straight down at a speed set by the pace (32 to 48 logical px per second) with a gentle sway of 3 px either side.
- One spawns every 1.1 to 1.7 seconds, as set by the pace, at a random x no more than 70 px from the previous spawn, so every item is reachable. Never more than 3 in the air.
- Caught: it lands on the deck. The boat dips 1 px for 100 ms, haptic 8 ms.
- Missed: it reaches the water with a 3 px splash. No haptic, no message, nothing lost.
- Variety: every opening starts with 2 kinds in the mix. A new kind joins every 40 catches since the opening until all 8 are in, then the order reshuffles. Cosmetic only.

### The nasty ones

- Kinds: sea urchin, jellyfish, ink blob. All in the blue token with its shade, all spiky or ragged. Warm and round means catch it; blue and spiky means send the fish. Shape carries the difference, not colour alone.
- One falls every 20 to 30 seconds, taking the place of a normal spawn. Never more than one in the air.
- It falls slower, at 30 logical px per second, so there is time to react.

### The fish

- A tap is a touch that goes down and up within 200 ms and moves less than 4 logical px. It can land anywhere on screen.
- Tap with a nasty in the air: a fish leaps from the sea directly below it at about 220 logical px per second, eats it where they meet, arcs over and dives back with a splash. Haptic 16 ms on the bite.
- Tap with no nasty in the air: a fish does a small hop beside the boat. No haptic. A tap is never wrong.
- Fish sprites of about 9 x 5, a random kind on each leap. Every opening starts with 2 kinds; a new one joins every 5 nasties eaten since the opening, up to 6.

### If a nasty lands uneaten

- On the boat: the boat rocks 1 px side to side for one second.
- In the water: an ink cloud darkens the sea bands for 4 seconds, then fades.
- No haptic for either. Nothing is lost.

### Rare treat (added by Claude, not asked for; veto freely)

- Every 90 to 150 seconds one slow item drifts down on a tiny parachute.
- Catching it sets off one small sky event: a gull crossing, a dolphin arcing on the horizon, or the sun glinting. Missing it does nothing.

### Pause

- Catch needs a grace period so a tap is not read as a pause: play continues for 400 ms after the finger lifts, then pauses. The boat holds its position during the grace.
- Finger down while paused resumes after 250 ms. That touch never counts as a tap.
- Bricks keeps its immediate pause. If the input handling lives in shared code, the grace becomes a parameter that defaults to zero, and Bricks' behaviour is checked unchanged.
- Nothing is saved. The page hidden or closed pauses at once, with no grace. Opening Catch always starts a fresh scene.

### Counts

- No count is shown or stored. The catches and the nasties eaten since the opening drive the variety only.

### Pace, skill signal and exit ramp

Catch follows the wind-down rules of section 2b. C1 is built after B2, so the session clock, the scene phase and the dusk tokens already exist in shared code.

- Pace is a hidden value from 0 to 1, starting at 0.3 on every opening or after a session-clock reset.
- Each catch adds 0.02. Each missed item takes off 0.15. A nasty landing uneaten does not change it. Clamped to 0 and 1.
- Pace sets two things, both linearly: fall speed from 32 (pace 0) to 48 (pace 1) logical px per second, and the spawn gap from 1.7 down to 1.1 seconds. A new value applies to items spawned after the change, never to items already in the air.
- The nasty ones do not follow the pace: 30 px per second, every 20 to 30 seconds, always.
- Exit ramp: the shared sunset to dusk over 10 minutes of active play. From minute 10 to minute 12 the pace ceiling falls from 1 to 0 and the pace follows it down.
- No sound.

### Haptics

- Catch 8 ms, fish bite 16 ms, nothing else. At most one vibrate call per 40 ms. Whenever navigator.vibrate exists.

### Files

- /games/catch/: index.html, catch.js, sim.js. The simulation in sim.js must not touch the DOM.
- (Superseded by row H2: the hub has no tiles; Catch has its card, §5a.) The hub's CATCH tile becomes active.
- Pace gains and losses, fall-speed range, spawn-gap range, nasty interval, tap thresholds, pause grace, fish speed and haptic lengths sit in one config block at the top of catch.js. The thumb-travel fraction and the edge width are shared values in shared/pixel.js.

### Accept

- Ten minutes of play: every spawned item is reachable, never more than 3 items and 1 nasty in the air, no item stuck or lost off screen.
- A tap with a nasty in the air always produces a bite before the nasty lands, wherever the nasty is.
- A tap is never read as a pause, and a slow lift (over 200 ms) never fires a fish.
- Lifting the thumb pauses after the grace period. Killing the app and reopening opens the hub; opening Catch starts a fresh scene, paused.
- A nasty landing uneaten changes nothing but the cosmetics described.
- Catch and bite ticks can be told apart by feel.
- Bricks behaves exactly as before this row.
- Pace stays between 0 and 1, never changes the speed of an item already falling, and reaches 0 by minute 12 of active play.
- Boat, items, nasties and fish are readable in every one of the 10 scene steps.
- A headless test runs sim.js in Node for 15 simulated minutes with a boat that tracks the nearest item, misses now and then, and taps on every nasty: no NaN, item counts stay within the limits, every nasty is eaten, pace stays in range and is 0 by minute 12.

Choices made in the build (in force)
- A tap that comes as a nasty is about to land holds it at the deck or water line until the fish reaches it, at most 6 steps (50 ms): this guarantees a bite before it lands.
- A nasty spawns the moment its 20 to 30 s timer ends and takes the normal spawn's place; it spawns within 70 px of the last normal item and does not sway. One due while another is in the air waits. A spawn due with 3 items in the air waits for a free slot; the first item comes one spawn gap after a fresh start; things appear 5 px below the top plus the safe-area inset.
- The treat is separate from the 3 items, on its own timer, falls at 20 px/s with the sway, within 70 px of the last normal item. Only normal items move the 70 px reference. Catching it counts as a catch (pace +0.02, 8 ms tick) and sets off one random sky event: a gull crossing (4 s), a dolphin arcing on the horizon (1.6 s) or a glint on the sun (1 s; on the sea once the sun is down). A missed treat makes no splash and changes nothing.
- Caught means the thing's bottom reaches the deck line with its centre over the hull; a thing passing the deck line beside the boat can only reach the water. The caught thing shows on the deck for 250 ms.
- A tap while a fish is already after the nasty is a hop. At most 4 fish at once (hops stop at 3, so a leap always has a slot). The hop is beside the boat on its right (left at the right wall); after a bite the fish arcs toward the middle.
- Kinds spawn cycling through the shuffled order of the unlocked kinds. The catch and eaten counts live in memory only, so every opening starts with 2 item kinds and 2 fish kinds; with all 8 in, the order reshuffles every 40 catches.
- The boat dips 1 px for 100 ms, and rocks 1 px left and right every 125 ms for 1 s. The ink cloud mixes the sea toward the ink cloud colour (section 3) for 4 s, then fades over 0.6 s in two dither stages.
- Items and fish carry a 1 px outline in the edge colour; the nasty ones are bare blue with the shade inside. Bite bits (6, 300 ms) and a 3-dot spray under a leaping fish go away with reduced motion; the miss and dive splashes stay.
- Catch keeps its input code in games/catch (a state machine in sim.js). A touch that starts while paused or resuming is never a tap; a finger down in the grace plays on at once; lifted while resuming, the game stays paused. The grace counts as active play. The page hidden or pagehide pauses at once with no grace.
- No pause marker (X33, 2026-11-26): the ring with a square, as in style-reference-catch.jpg, was removed; the reference's ring does not apply.

## 6c. Row U1: Putt

Superseded in part by update 3; row U2 (§6h) brings the build in line: no drawn frame, the screen edges are the walls, sand and sea levels.

docs/style-reference-putt.jpg is the approved look. Its lettering does not apply: nothing is written on screen.

Putt is a cross between snooker and mini golf, seen from above. The ball starts at the bottom, the hole is at the top, and banked shots off the walls get it there. Levels never end: each one is generated from random parameters.

It reuses the shared kit. If shared code has no session clock and scene phase yet, this row builds them as section 2b describes; if it has, it reuses them.

### Gesture and pause (this game's own)

- Gesture: pull back, aim, release. One thumb.
- Pause: none on lifting the thumb, because the ball rolls after release. Putt is turn-based, so it is idle whenever the ball is at rest. Nothing is saved: opening Putt always starts a fresh level (see No saved state, and the hard rules).

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
- Power is the pull length, capped at 48 logical px (Pedro's feel report, 2026-11-26: 20 percent less pull than the first 60): power rises in proportion to the pull and is full exactly at the cap. A dotted guide runs from the ball to the first wall it would hit, plus the first 12 px of the rebound. A short bar by the ball shows power.
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
- In the dusk phase (minute 10 of the session clock onward) the draw is level 1 only. This is the exit ramp easing the game down, as rule 2 of the wind-down rules asks.
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
- (Superseded by row H2: the hub has no tiles; Putt has its card, §5a.) The hub gets a PUTT tile.
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

### Choices made in the build (in force)

- Putt stores nothing. Its own buzz() vibrates whenever navigator.vibrate exists, with the shared 40 ms gap; a bounce below 8 px/s does not tick, and a bounce within 40 ms before the drop is skipped so the 24 ms sink tick always goes out.
- Putt draws no sky: three sea bands down the full height under the course, colours from the shared scene palette in the same 10 steps, no sun and no stars.
- The first level is built in the worker as well; a level-1 or 2 draw is built on the page at the first frame; a level-3 draw is requested at module load. The worker is gen.js itself (a module worker); if it fails, levels are built on the page in slices of about 6 ms. A level-1 course is kept ready from 2 minutes before dusk, and at dusk Putt takes it, or the instant fallback if the queue is not level 1. If the queued level is not ready when a hole is sunk, the fallback is used, so there is never a wait. The fallback is an open level-1 course varied by its seed (hole x, block size and place).
- The course wall is 3 px, drawn outside the course polygon at the plan's insets. Bars are 3 px thick, grow from the left or right alternately and reach at least 45 percent of the width. Diagonals are 3 px thick with a leg of 15 to 35 px. The 12 px clearance is measured from the ball's and the hole's edges; solids stay 14 px from the wall; traps and water stay 3 px clear; the hole sits at least 10 px below the top.
- The solver tries powers 0.2 to 1.0 of 220 px/s, ranks resting spots by walking distance on a 2 px grid and keeps one per 3 px cell; level 2 almost always needs exactly 2 strokes and level 3 exactly 3.
- Look: blocks are brick rows 3 or 5, pegs row 6, sand traps the sand mixed 55 percent toward row 4 with dots, water is sea band 2 with glint dashes, the hole is the keel plum with a rim 35 percent toward white and a coral flag. The guide is 2 x 2 dots every 5 px, the power bar five 4 x 2 bars, with a pull ring where the thumb went down and a large ring under it.
- Sink drop 240 ms; the next level starts to slide in 800 ms after the drop and arrives over 420 ms (about 1.2 s after the drop); under reduced motion it appears with no slide. The 4 px cancel distance is in logical px.
- Putt reads the shared session clock and advances it in memory only: while the ball rolls, while the thumb is down and for CONFIG.idleS (10 s) after either.
- (Superseded by row H2: the hub has no tiles; its cards are laid out by §5a.)

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
- (Superseded by row H2: the hub has no tiles; Stack has its card, §5a.) The hub's STACK tile becomes active.
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

### Choices made in the build (in force)

- Aligned means the block's centre is over the floor's centre; a near-perfect drop snaps to that centre, clamped inside the screen, and keeps its full width, so a regrown block 2 px wider than the floor lands whole.
- Overlap is the intersection as a share of the block's width; a near-perfect drop counts as 100 percent and adds 1; a block that only touches the floor's edge is a complete miss; "under 12 px" is strictly less than 12. The fresh 60 px block lands whole wherever it is dropped, ticks 8 ms and leaves the pace unchanged.
- Blocks alternate starting walls floor by floor, the first from the right. A missed block falls at 360 px/s squared, a tap while it falls does nothing, and the same block returns 0.35 s after the plop.
- Each block takes its speed when it starts; a sliding block's speed and the pace follow the falling dusk ceiling at once. All visible time counts as active play; hidden or pagehide stops the clock. The drop fires on pointerdown and lands at once; only the primary pointer drops.
- The camera shifts one floor when the top floor's top edge passes H/2, slides at 64 px/s (125 ms per floor), and jumps under reduced motion. Floors more than 2 below the screen are dropped from memory. On a resize the tower is lowered until its lowest kept floor reaches the horizon.
- Look: floors use the 1 px edge rim, 2-step corners at 10 px wide and up, 1-step below, an edge-colour sliver under 5 px; colour is floor index mod 9 over the brick rows; bits are 2 x 2 (up to 6 per cut, 300 px/s squared, away from the tower, none under reduced motion); the plop is a white 3-dot splash for 300 ms, kept under reduced motion; the sun stays at x 96 so the tower base overlaps it.

## 6e. Row X1: Strip-down

Rows built before this update still carry things the new hard rules remove. This row takes them out of everything already built at that point: the hub, Bricks, Catch if it exists, and any other game present.

Build
- Remove every HUD: titles, back controls, scores, counts, rally or run numbers, difficulty markers, restart controls. Each game uses the whole screen.
- Remove all saving and restoring of game state. Remove the stored all-time counts. Remove the haptics setting, its switch on the hub, settings.js and store.js: haptics are always on and nothing is stored. Clear every stored key on first run so nothing stale is left behind.
- Opening a game from the hub starts it fresh, every time.
- Set the manifest's display mode to fullscreen.
- Going home is the Android back gesture only. Every game ignores touches that begin within 24 CSS px of the left or right edge.
- (Superseded by row H2: the hub is four cards, §5a.) Hub: one active tile for every game that exists. No SOON tile for a game that is built.
- Update the README and sections 5 and 6 of PLAN.md so they describe what is now true.
- Check on Pedro's phone, in the installed app: an edge swipe in fullscreen returns to the hub with one swipe. If Android needs two swipes in fullscreen, say so in the reply and switch the manifest to standalone; that is the one thing in this row that cannot be verified from a desktop browser.

Accept
- No game screen shows any text, number or button.
- After play in every game, storage is empty.
- (Superseded by row H2: the hub shows the four cards and nothing else, §5a.) The hub shows the game tiles and nothing else: no switch, no setting.
- Catch and Bricks use the shared thumb-travel fraction: 28 percent of the screen width moves the paddle or boat end to end (set from Pedro's feel reports, 2026-11-26; first 50, then 35).
- Killing the app and reopening it opens the hub; opening a game starts it fresh.
- From every game, the back gesture returns to the hub, and an edge swipe never moves a paddle, a boat or an aim.
- Play itself is unchanged in every game: physics, pace, haptics and the exit ramp behave as before this row.
- The headless tests of every game still pass, with their save and count checks removed.

## 6f. Row P3: Android app for Google Play

Pedro's decision (2026-11-26): ship RLX on the Google Play Store as an Android app. The web app on GitHub Pages stays as it is.

What Google Play asks (Pedro's research, Google Play policy as of November 2026)
- New apps and updates target Android 16, API level 36 (from 2026-08-31). Upload an Android App Bundle (.aab).
- Store listing: app icon 512 x 512 32-bit PNG; feature graphic 1024 x 500 JPG or PNG; 2 to 8 phone screenshots; short description at most 80 characters; full description; a privacy policy URL; the Data safety form; the content rating questionnaire.
- An app that is only a website in a frame risks rejection under the minimum functionality policy. RLX ships its game files inside the app, runs offline and vibrates through a native call, so it is not a framed website.

Decisions
- Capacitor (the latest stable, 8.6.3 at the build) in /android-app/. The game files are bundled in the app and served from the app's own origin (https://localhost/, root path). Nothing is loaded from the Pages site or any other host. Why Capacitor: it is a maintained WebView shell with a local file server, a plugin bridge and a Gradle project Pedro can build in CI; a hand-made WebView shell would need all of that rewritten.
- Package id io.github.apcanario.rlx. App name rlx (lower case, the name on the launcher and in Play).
- targetSdk 36, compileSdk 36, minSdk 24 (Capacitor's minimum).
- Permissions: VIBRATE only (a normal permission, granted at install, no prompt). The INTERNET permission that Capacitor's template declares is removed from the merged manifest: the app loads only bundled files. Cleartext traffic is off. No analytics, no ads, no accounts, no network calls, nothing stored (§2 holds in the app as on the web).
- Native haptics: a small Capacitor plugin, RlxHaptics, in the Android project (Java), with one method vibrate({ ms }) that runs VibrationEffect.createOneShot(ms, DEFAULT_AMPLITUDE) on the device vibrator. shared/haptics.js uses it when window.Capacitor.Plugins.RlxHaptics exists (the hub's, read from a game's frame, or the page's own), and navigator.vibrate exactly as before otherwise. The shared rules stay: always on, no settings, at most one call per 40 ms, the same tick lengths. Putt and Stack, which keep their own buzz(), send through the same function. Why: Chrome's tap-before-vibrate gate (§2b) does not apply to a native call, so a game vibrates from its first event in the app.
- The service worker is not shipped in the app (sw.js is not in its own FILES list) and is not registered there: shared/pixel.js skips the registration when the page runs inside the app. The app's files are in the APK, so it is offline by construction.
- Paths: every path in the pages is relative (README), so the same files work at /4rk4d3/ on Pages and at the root of the app. The hub's cards open games/<game>/index.html (until P3, games/<game>/): Capacitor's local server answers a folder URL with the app's index.html, so a folder URL would have opened the hub again inside the frame. The app's server runs with html5mode off, so a missing file is an error, never the hub.
- Back: Android's back gesture or button. Inside a game the WebView has the hub's history entry (§5), so back goes back in the WebView, which removes the game frame exactly as on the web. At the hub there is no entry to go back to, so back falls through to Android, which closes the app (moves it to the background). It cannot trap: the only entries are the ones the hub pushes when a game opens, and each back removes one. Code: MainActivity (an OnBackPressedCallback; no extra plugin).
- Full screen: immersive. Status and navigation bars hidden; they show for a moment on a swipe from the edge and hide again (transient bars). The window is edge to edge and the content runs into a display cutout (cutout mode shortEdges); the safe area reaches the pages as env(safe-area-inset-*) (Capacitor's SystemBars, insets in css mode) and the existing safe-area probe (§5) does the rest. On a WebView older than 140 Capacitor pads the window instead and the pages see insets of 0; the padding shows the window colour.
- Portrait only (screenOrientation portrait). Android 16 may ignore this on large screens (600 dp and wider) for apps that target API 36; RLX is a phone app and does not handle landscape beyond the web app's own layout.
- Launch: no splash text and no logo. The launch window and the Android 12+ splash screen are a flat sky-top colour (#FFF7EC, the manifest background; at night the dark sky-top #141026, row D1) with a transparent icon.
- Icon: Pedro's approved beach-sunset icon set (2026-11-26): the launcher mipmaps (legacy, round and adaptive with a monochrome layer) in the Android project, the 512 px icon and the feature graphic in docs/play/. The web icons (icons/) are redrawn from the same art by tools/make-icons.py (tools/rlx_art.py holds the art), no lettering; icons/icon-512.png equals docs/play/ic-play-512.png.
- One source of truth for the shipped files: tools/build-www.mjs copies exactly the files in sw.js FILES (folders skipped) into android-app/www; npx cap sync puts them in the APK.

Layout of /android-app/
- package.json, package-lock.json: @capacitor/core, @capacitor/cli and @capacitor/android, pinned.
- capacitor.config.json: app id, name, webDir www, server (https, localhost, html5mode off), android (no mixed content, no WebView debugging), SystemBars (hidden, css insets).
- android/: the Gradle project from Capacitor's template. Changed: app/src/main/AndroidManifest.xml (permissions, portrait, no backup), app/src/main/java/io/github/apcanario/rlx/ (MainActivity, RlxHapticsPlugin), app/src/main/res/ (the icon set, the launch theme and colour; the template's splash images and FileProvider removed), app/build.gradle (version, release signing from the environment).

Build and release
1. node tools/build-www.mjs, then in android-app: npm ci, npx cap sync android, then ./gradlew assembleDebug (a debug APK) or bundleRelease (the .aab).
2. CI does all of it (.github/workflows/android.yml) on every push to main that touches the app or the shipped files, and on demand: a debug APK as a run artifact; a signed release .aab as well when the four signing secrets exist (RLX_KEYSTORE_B64, RLX_KEYSTORE_PASSWORD, RLX_KEY_ALIAS, RLX_KEY_PASSWORD). On a manual run only, a smoke job boots an Android emulator, installs the debug APK, opens the hub, a game and back, and saves screenshots (docs/PLAY.md §5). The APK carries two empty Cordova stubs that Capacitor adds (cordova.js, cordova_plugins.js); no page loads them.
3. versionCode is the CI run number + 100 (app/build.gradle; headroom if the workflow is renamed or recreated, which resets the run number, docs/PLAY.md §4); versionName is 1.0.<run number>.
4. Release: Pedro uploads the .aab to a closed test in the Play Console, then production (docs/PLAY.md).

Accept
- The app's package is io.github.apcanario.rlx, named rlx, targetSdk and compileSdk 36, minSdk 24, portrait, only the VIBRATE permission in the merged manifest, no cleartext traffic (static checks and the CI build).
- android-app/www equals the files in sw.js FILES; sw.js is not in the app; no keystore, key or secret is in git (static checks).
- The web app is unchanged on Pages: tests/check.py passes serving under /4rk4d3/, the card hrefs are games/<game>/index.html.
- haptics.js: the native plugin when present (the hub's or the page's own), navigator.vibrate otherwise, the 40 ms limit and tick lengths unchanged (Node tests with a fake plugin and the stub).
- CI builds a debug APK, green, and checks the APK: package, label rlx, minSdk 24, targetSdk 36, VIBRATE the only user permission, its web files equal to sw.js FILES.
- The manual smoke job (run once in the build, 2026-11-26): on an Android 15 emulator the hub draws, a card opens its game, back returns to the hub, back again leaves the app, and dropping a Stack block logs an 8 ms vibration from the app.
- docs/play/: listing, Data safety, content rating, privacy policy, 512 px icon, feature graphic, 2 to 8 phone screenshots (Play: the long side at most twice the short side), ours 9:16, 1080 x 1920.
- Not verifiable headless (P3's device check, with X34): installing and playing the APK on Pedro's phone: immersive full screen and the transient bars, the cutout, one back from a game to the hub and one more out of the app, haptics in every game from the first event, offline, fps, outdoors brightness.

Only Pedro can do
- Create the Google Play developer account (one-off fee, identity check).
- Make the upload key and add the four secrets to the repo (docs/PLAY.md); never paste a secret into a chat.
- Install the debug APK on his phone and play it (P3's device check, with X34).
- In the Play Console: create the app (rlx, game, free), fill the listing from docs/play/listing.md, the Data safety form from data-safety.md, the content rating questionnaire from content-rating.md, the privacy policy URL, the contact email; upload the .aab to a closed test with the testers Play asks for, run it as long as Play asks, then apply for production.

## 6g. Row D1: dark theme, hub and all four games

Pedro (2026-11-26): an automatic dark theme if the phone is set to dark mode, on the homepage and in every game. The rules are in §2, the look and starting values in §3.

Build
- shared/tokens.js (and its mirror in shared/theme.css): COLORS, DUSK, BRICK_ROWS and SEA_BANDS each get a dark set, and the mix targets (shade, edge, highlight amounts) a dark value where §3 gives one. One function returns the active set; scenePalette() mixes inside it.
- Any colour literal still in the hub, Bricks, Catch, Putt or Stack moves into tokens first.
- The theme is read from `prefers-color-scheme` and from its change event. A switch while the app is open redraws on the next frame and changes no game state.
- shared scene (sky, sun or moon, clouds, stars, sea): dark variant as in part B, on the session clock as today.
- Hub: night sky as the illustration above the cards, cards and their pieces from the dark tokens.
- Bricks, Catch, Putt, Stack: dark by tokens only. No layout, physics, haptics or timing change.
- Page chrome: `theme-color` and the page background follow the theme. The web manifest's colours stay the light ones (a manifest cannot switch).
- Android app (§6f): the pages inside the Capacitor shell must see the phone's dark mode through `prefers-color-scheme`. Check it; if the WebView reports light regardless, fix the shell (an app theme that follows the system night mode, no algorithmic darkening of the page by the WebView). The launch window and splash colour get a night value, the dark sky-top; the window colour behind the insets follows.
- App icon: unchanged.

Accept
- With the phone in dark mode, the hub and each of the four games open dark; in light mode nothing differs from the build before this row (pixel-identical screenshots at step 1).
- Switching the phone's mode with a game open changes the look within a frame; the ball, bricks, course or tower are where they were.
- tests/contrast.mjs and the contrast checks of tests/check.py run every existing check in both themes at every scene step, to the §3 B4 standard, and pass. What X16 accepted outside the standard in light may stay outside it in dark; nothing else may.
- A check fails if any colour literal is drawn outside tokens.
- Nothing is stored. No setting exists.
- Screenshots of the hub and each game, dark, at 360x800, checked by eye. The Play listing screenshots (docs/play/) stay the light ones.
- All existing suites pass.

Only on the phone: how dark reads in a dark room and outdoors, and the switch inside the installed APK.

Choices made in the build (in force)
- Values in force, dark: skyTop #141026, skyBottom #3A2152; dusk skyTop #0C0918, skyBottom #241436; sea bands #24406B #1F3760 #1C2F55, dusk #1A2F52 #162849 #132140; coral #FF7385; ink #CDD6FF; glint #FFA2CE; sun (the moon) #FFE9C9; star #FFFFFF; brick rows as in light; sand #2B2142, wet sand #3B2C58, foam #CDD6FF (light #FFE6D2, #FFCFBA, #FFFAF3; tokens only, unused until U2 and A1). All as §3 set them.
- Moved by the contrast check, each by the smallest step found along one line (steps of 0.005 to 0.01 of a mix):
  - blue #8FB8E8 to #6C8AB1 (0.26 toward #0A0714). The ball (fill only, contrast 3) has to clear both the moon (it needs to be darker than luminance 0.246) and the night sky, a cloud and Putt's sand and trap; no lighter blue clears the moon. The nasty ones and Putt's guide follow (same token).
  - cloud #4C3A6E to #463566 (0.09 toward #0A0714). With the cloud at #4C3A6E no ball colour cleared both the moon and a cloud (the ball needed luminance 0.268 or more for the cloud, 0.246 or less for the moon).
  - keel #0A0714 to #8B898F (0.525 toward white). The hull's rows below the horizon (fill only, contrast 3) must clear the night sea; no dark colour can (black against sea band 1 is 2.02). The same token is the hub cards' outer 1 px edge (the coral frame carries the card) and Putt's hole, which on the near-black course now reads as a pale disc with a paler rim.
- Derived (§3 set no dark value): sail and card #A0D0E8 (unchanged, they clear the night); ink cloud #4F2A8F (the light #483080 moved 0.12 toward #8000FF: mixed 0.45 into the night sea it differs by delta E 20; toward black it could not); white #FFFFFF (new token, both themes: the splash and spray tops, Catch's bite bits, Putt's pull ring and the hole rim's mix, which drew the cloud token, white in light and #463566 at night); edgeTarget (new token: light #783C5A, as before; dark #0A0714).
- Mix targets in dark: shade toward #0A0714 at 0.38 (as light's amount); highlight toward white at 0.24 (half the light 0.48). Edge: §3 left the target to the builder per piece. Every piece's fill clears the night ground on its own, so the dark edge is picked for the light grounds it meets (the moon, the next Stack floor, a coral card frame): toward #0A0714 at 0.7 for every outline. The two pieces drawn in the edge colour alone, the mast and Putt's flag pole (on the hub card too), use line(): the edge in light, toward #0A0714 at only 0.25 in dark, so the line clears both the night sky and the moon.
- Putt's sand trap mixes the course floor toward brick row 4 at 0.55 in light, 0.22 in dark (tokens.js TRAP_AMOUNT_DARK), so the ball clears the trap and the trap still differs from the floor by delta E 20. Putt's floor stays the sky-top token at each step, as built (in dark, near black).
- Scene at night (shared/pixel.js drawScene, sunRuns): the moon is the sun's disc less a disc of 0.95 of its radius set 0.45 radius left and 0.3 radius up, a crescent lit on the right, in the same place and sinking the same way; the hub cards' windows draw it too. Stars: 4 from the first step, the 2 of step 8 and the 2 of step 9 on top (4, then 6); light unchanged. The glints are the moon path (the moon colour mixed into sea band 1, as by day). The dusk ramp, its 10 steps and the games' slowdown are the same in both themes.
- Theme: shared/tokens.js reads prefers-color-scheme once and on its change event. COLORS, DUSK, BRICK_ROWS and SEA_BANDS are live views of the active set; shade(), highlight(), edge(), line() and scenePalette() mix inside it. Each game rebuilds the colours it keeps (sprites, cached backgrounds) on onThemeChange() and asks for a frame; Putt and Stack key their caches by theme; the hub redraws. No game state is touched. Nothing is stored; there is no setting.
- Page chrome: each page has two theme-color metas, media-queried, the light and the dark sky-top, and color-scheme "light dark"; theme.css sets the page background from --sky-top in both. The manifest keeps the light colours.
- Android shell: AppTheme is Theme.AppCompat.DayNight.NoActionBar, so its isLightTheme (what the WebView reports as prefers-color-scheme for apps targeting API 33+) follows the night mode; rlx_sky has a values-night value #141026 (launch window, splash, window); MainActivity turns algorithmic darkening off (androidx.webkit WebSettingsCompat, a new dependency of the app module, version from variables.gradle) and sets the window and WebView background to rlx_sky. uiMode stays in configChanges, so a switch does not recreate the activity or reload the game: onConfigurationChanged rebases the theme (API 29 and up) and sets the colours again. Checked statically only (tests/check.py, and MainActivity compiled against stubs); not built, not run on a phone. Whether the WebView's prefers-color-scheme follows a switch while the app stays open is not known; if it does not, the app follows the mode at its next start.
- Tests: tests/contrast.mjs's users (the four sims) run their readability blocks in both themes (forceTheme in Node); tests/check.py runs contrast-hub, contrast-pages and contrast-stack again in dark (color_scheme dark), adds run_theme (dark opens dark in the hub and each game from its card, the page chrome, a live switch with each game open keeping its state and redrawing within two frames, back to light pixel for pixel, nothing stored) and static checks (no colour literal in shipped code outside tokens.js and theme.css, the theme-color metas, the manifest colours light, prefers-color-scheme read only in tokens.js, the Android night resources). One check was narrowed: Catch's keel is measured in dark against the sea bands and the inked sea, not the pale glint dashes, with a new check that its rows (3 below the horizon at most) end above the first glint row (4); in light it is measured as before.

## 6h. Row U2: Putt, open course and two themes

docs/style-reference-putt-open.jpg is the reference. Pedro on the built Putt: the rectangular frame "looks very locked, like a prison".

Course
- The drawn frame goes. The course is the whole screen and the screen edges are the walls. Nothing is drawn along a plain edge.
- Obstacles can grow out of the edges:
  - perpendicular stubs: a bar from any edge, 20 to 60 px long, 8 to 12 px thick;
  - diagonals, true 45 degree lines drawn as stair-steps as built: a corner cut (a triangle across a corner, equal legs of 20 to 45 px) or a wedge from a side edge (two 45 degree sides meeting at a tip 15 to 30 px in, its base on the edge twice that).
- Free-standing blocks, pegs, sand traps and water stay as built.
- Per level: difficulty 1 draws 1 or 2 edge pieces, difficulty 2 draws 2 to 4, difficulty 3 draws 3 to 5, on top of what the generator places today. Difficulty stays equal-odds and unseen.
- The generator keeps its rules (§6c): the tee at the bottom within 20 px of centre, the hole in the top fifth, every level solved by the solver on the same sim.js, the seeded fallback after 30 rejects, levels built ahead of play. The course is no longer inset 6 px or cut 26 px short of the bottom: it is the screen less the safe-area insets.
- A gap between any two solid pieces, or between a piece and an edge, is either closed or at least 14 px, so the ball cannot wedge.
- Touches that start in the 24 CSS px side band are still ignored. The ball uses the full width.
- The safe area: the top wall sits below a display cutout; the tee zone sits above the bottom inset.

Two themes, alternating every level: sand, sea, sand, sea. The first level of every opening is sand (nothing is stored).
- Sand level: sand ground. Solid pieces are rocks in coral, salmon and pink. Water is a pool in the sea blues; the sand trap is the deeper peach, as built. The hole is the plum disc with its flag. Ball in the ball blue.
- Sea level: shallow sea ground with glint dashes. Solid pieces are sandbanks with a pale edge. Water becomes a patch of deep water (same rule: back to the shot's origin). The sand trap becomes a pink reef (same slowing). The hole is a ring float. Ball pale with a coral edge.
- The theme is drawing only. sim.js sees the same shapes and the same numbers in both.
- Both themes have dark values and obey part A.
- Between levels: the transition built today, in the next level's colours.

Unchanged: the shot gesture and its 48 px pull, the speeds, the haptics, no text, no counts, nothing stored, the dusk ramp.

Accept
- No frame is drawn. On the phone the ball visibly bounces off the glass edge on all four sides.
- 200 generated levels per difficulty at the five tested heights: all solved, every piece inside the rules above, no gap between 0 and 14 px.
- 3000 random shots: no tunnelling through an edge, a stub or a diagonal, and the ball never leaves the screen.
- Levels alternate sand and sea from a sand start; the same seed and height give the same level.
- Contrast passes for both level themes in light and in dark.
- Screenshots: one sand and one sea level, light and dark, at 360x800, checked by eye against the reference.
- Bricks, Catch, Stack and shared/ behave exactly as before this row.

## 6i. Row A1: Glide, air hockey against a crab

Pedro (2026-11-26): a beach themed air hockey game against a bot; on the first mockup, "No need for so much empty space on the top, maximize playing space".

docs/style-reference-glide.jpg is the reference (light and dark). "Glide" is the working name; the app draws no text, so the name lives only in the folder and the docs.

Scene
- The table is the whole screen. A strip of sea across the top, about 5 percent of the height and never more than 16 px, then sand to the bottom edge. No sky. The sun or moon shows only as its reflection on the strip.
- Side and bottom walls are the screen edges, marked by a thin darker sand band.
- Opponent goal: an inlet in the tide line between two buoys, 45 px wide, centred. A goal for the player is the puck going out to sea.
- Player goal: a gap between two small sandcastles on the bottom edge, 45 px wide, centred, above the bottom inset.
- A dashed centre line and circle. Small shells and starfish as decor, never in the tracked colours.
- Puck: a shell disc, radius 5. Player mallet: a life ring, radius 9. Bot: a crab, body about 18 px wide, same collision radius as the ring.

Control
- Relative drag anywhere on screen; the ring is never under the thumb.
- Horizontal: the shared thumb-travel value of Bricks and Catch (28 percent of the screen width moves the ring across the table). Vertical: the same gain.
- The ring stays in the player half, the crab in its half. Neither enters a goal mouth.
- Pause (this game's own, as Bricks): no finger on the screen means paused. Puck, crab and timers freeze within one frame and the frozen scene shows with no marker. Finger down resumes after 250 ms. The first opening starts paused with the puck on the centre spot.

Physics (games/glide/sim.js, no DOM, 120 Hz fixed step, swept collisions)
- Puck top speed 220 px/s. Drag small enough that a full-speed puck crosses the table twice before it would stop.
- A mallet hit adds the mallet's velocity along the contact normal, clamped to the top speed. 90 percent bounce off walls.
- Stall rule: a puck under 15 px/s for 2 s gets a gentle push toward the half it is not in.
- Pin rule: a puck held against a wall or corner by a mallet is pushed out along the wall; the mallet gives way.
- Serve: from the centre at 60 px/s toward whoever conceded. The first serve of a session goes to the player.

Bot (games/glide/bot.js, no DOM)
- Follows the puck's x with a reaction delay of 150 to 300 ms and a speed cap. Steps forward to hit only when the puck is slow and in its half; otherwise holds a line in front of its goal.
- Every hit carries an aim error.
- Silent rubber band, three steps each way from the middle: after the crab scores, one step slower and less accurate; after the player scores, one step sharper. No setting, nothing shown, nothing stored.
- The wind-down rules (§2b) apply: the exit ramp slows the puck's top speed and the crab together, on the shared session clock.

No points, no states
- A goal is not counted, shown or stored. A soft pulse, a small wave over the goal mouth, then the serve.
- No win, no loss, no end, no restart, no pause marker, no HUD, no text, no saved state. The edge swipe goes home.

Haptics (always on, no sound, at most one call per 40 ms)
- Mallet hit: 8 to 14 ms by hit speed. Wall: 6 ms. Goal, either end: 24 ms.

Files
- games/glide/: index.html, glide.js, sim.js, bot.js. sw.js FILES lists them, so the Android app ships them (tools/build-www.mjs).

Hub
- A fifth card, drawn like the others from the game's own pieces (ring, shell, crab).
- hub/cards.js: the grid becomes 2 columns by 3 rows in the thumb-reach zone, by the §5a layout rule, order Bricks, Catch, Putt, Stack, Glide; the sixth cell stays open sand or sky, not a blank card. Every card stays a tap target of at least 40 logical px. If three rows do not fit at the smallest tested height, the sky above gives way first.

Tests
- tests/glide-sim.mjs: ten simulated minutes with a scripted player that tracks the puck: no NaN, the puck never leaves the table except through a goal mouth, no tunnelling through a mallet or wall, no stall longer than 2 s, goals at both ends, median rally of 6 hits or more, the rubber band stays inside its three steps.
- The browser suite: layout at the tested sizes, the sea strip height, both goals inside the safe area, contrast in light and dark, the hub with five cards.

Accept
- Ten minutes of play on the phone: no stuck puck, no pinned puck, the crab can be beaten and can score.
- The table reaches all four screen edges; the sea strip is the only non-table area.
- Ring, shell and crab are easy to follow in light and in dark.
- Mallet, wall and goal haptics can be told apart.
- Nothing is counted or stored. No text on screen.
- sw.js lists the new files and its version is bumped.
- Every other game behaves exactly as before this row.

Only on the phone: thumb travel in two directions, puck speed, how hard the crab feels.

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

- Nothing parked. P3 (an Android app with a native haptics bridge) moved to the Queue on Pedro's decision of 2026-11-26 (§6f).
- What Pedro's 2026-11-26 report did not confirm (X32) is row X34, done on the phone in the browser or the app: tick strengths told apart, vibrate on a game opened from its card, the look at low brightness (are edges, ink and the keel card edge too heavy), reduced motion, kill and reopen opening the hub, the first back after a reload, the hub's card size and tap comfort, the sun and sky look, Putt's first opening and the wait between holes, Stack's tap latency and camera slide, installed-app fullscreen and offline, one edge swipe back to the hub, outdoors brightness, fps, safe-area insets with a display cutout, split screen and rotation.
