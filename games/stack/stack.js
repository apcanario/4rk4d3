// Stack (PLAN §6d): drawing, the tap, haptics, the session clock. The
// simulation (the sliding block, the drop and its cut, the tower, the camera,
// the pace) lives in sim.js, which has no DOM.
//
// Hard rules (PLAN §2): no text, number, button or HUD; no back control (the
// Android back gesture goes home); touches that begin within 24 CSS px of the
// left or right edge are ignored; nothing is written to storage, ever;
// opening Stack always starts a new tower; no sound.

// Play values: one block (PLAN §6d Files). tests/stack-sim.mjs reads it from
// here. The ramp lengths are shared: SESSION in shared/session.js.
export const CONFIG = Object.freeze({
  blockH: 8, // every floor is this tall, logical px
  startW: 60, // the first floor, already in place
  maxW: 60, // a near-perfect drop regrows the next block up to this
  resetW: 60, // after a floor narrower than minFloorW, the next block is this wide (a fresh platform)
  minFloorW: 12,
  snapPx: 2, // within this of aligned (centre over centre): snap, nothing breaks off
  regainPx: 2, // width the next block regains after a near-perfect drop
  speedMin: 40, // slide speed, logical px per second (the pace)
  speedStart: 50,
  speedMax: 80,
  gainOverlap: 0.8, // a drop with this much overlap or more...
  gain: 1, // ...adds this
  lossOverlap: 0.5, // a drop with less overlap than this, or a complete miss...
  loss: 8, // ...takes off this
  hapticLandMs: 8,
  hapticSnapMs: 16,
  // Where PLAN §6d is silent (listed for a Proposed row):
  camSpeed: 64, // the camera slides the tower down one floor in 125 ms
  missGravity: 360, // a missed block falls into the sea, px per second squared
  returnS: 0.35, // the same block comes back this long after it plops in
  bitsMax: 6, // the overhang breaks into at most this many bits (none under reduced motion)
  bitGravity: 300, // px per second squared
  splashMs: 300, // the plop in the sea
});

import { COLORS, BRICK_ROWS, edge } from '../../shared/tokens.js';
import { createScreen, initPage, atSideEdge, drawScene, pixelBody, steppedRect, reducedMotion, SEA_HEIGHT } from '../../shared/pixel.js';
import { MIN_GAP_MS } from '../../shared/haptics.js';
import { sessionClock, watchReset, addPlay, phaseOf, sceneStep, slowdownOf, SESSION } from '../../shared/session.js';
import * as S from './sim.js';

initPage();

/* ---------- colours (tokens only) ---------- */

const FLOORS = BRICK_ROWS; // one per floor, cycling
const SPLASH = COLORS.cloud;
const colourOf = (i) => FLOORS[S.colourOf(i, FLOORS.length)];

/* ---------- state ---------- */

const canvas = document.getElementById('screen');
let game = null; // sim state, made at the first frame (it needs the screen height)
let bits = []; // { x, y, vx, vy, c } overhang bits, cosmetic only
let splash = null; // { x, y, t0 }
let lastDrop = null; // the last drop's result, for the test hook
let raf = 0;
let last = 0;
let acc = 0;
let lastBuzz = -Infinity;
let sceneCache = { key: '', canvas: null };

/* ---------- the session clock: shared, in memory, never written to storage ---------- */

// While the page is visible the block slides, so all visible time is active play.
const clock = sessionClock(); // the one shared clock (shared/session.js): the hub's, or this page's own
const clockWasReset = watchReset(clock); // true once after each reset: the pace starts again

const slow = () => slowdownOf(clock.active);
const currentStep = () => sceneStep(phaseOf(clock.active));

/* ---------- haptics: Stack vibrates whenever navigator.vibrate exists ---------- */

function buzz(ms) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  const now = performance.now();
  if (now - lastBuzz < MIN_GAP_MS) return false; // at most one call per 40 ms (shared limit)
  lastBuzz = now;
  try {
    return navigator.vibrate(ms);
  } catch (err) {
    return false;
  }
}

/* ---------- drawing ---------- */

function sceneFor(W, H, step) {
  const key = `${W}x${H}:${step}`;
  if (sceneCache.key !== key) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    drawScene(c.getContext('2d', { alpha: false }), W, H, { phase: step / SESSION.sceneSteps });
    sceneCache = { key, canvas: c };
  }
  return sceneCache.canvas;
}

/** One floor: a rounded body with its highlight line and drop shade, in a 1 px edge all round. */
function drawFloor(ctx, x, y, w, colour) {
  const x0 = Math.round(x);
  const x1 = Math.round(x + w);
  const dw = Math.max(1, x1 - x0);
  const yy = Math.round(y);
  if (dw < 5) {
    // Too narrow for a body inside its edge: a sliver in the edge colour with a fill core.
    steppedRect(ctx, x0, yy, dw, CONFIG.blockH, edge(colour), 1);
    if (dw >= 3) {
      ctx.fillStyle = colour;
      ctx.fillRect(x0 + 1, yy + 1, dw - 2, CONFIG.blockH - 2);
    }
    return;
  }
  pixelBody(ctx, x0, yy, dw, CONFIG.blockH, colour, dw >= 10 ? 2 : 1, edge(colour));
}

function drawBits(ctx) {
  for (const b of bits) {
    const x = Math.round(b.x);
    const y = Math.round(b.y);
    ctx.fillStyle = b.c;
    ctx.fillRect(x, y, 2, 1);
    ctx.fillStyle = edge(b.c);
    ctx.fillRect(x, y + 1, 2, 1);
  }
}

function drawSplash(ctx, now) {
  const u = (now - splash.t0) / CONFIG.splashMs;
  if (u >= 1) { splash = null; return; }
  const x = Math.round(splash.x);
  const y = Math.round(splash.y);
  const r = u < 0.5 ? 2 : 4;
  ctx.fillStyle = SPLASH;
  ctx.fillRect(x - r, y, 1, 1);
  ctx.fillRect(x + r, y, 1, 1);
  ctx.fillRect(x, y - 1 - (u < 0.5 ? 1 : 2), 1, 1);
}

function draw(ctx, s) {
  const geo = { W: s.W, H: s.H, horizon: s.H - SEA_HEIGHT };
  if (!game) game = S.create(geo, CONFIG);
  else if (game.H !== geo.H || game.W !== geo.W) S.resize(game, CONFIG, geo);
  const now = performance.now();
  const step = currentStep();
  canvas.dataset.scene = String(step);
  const scene = sceneFor(s.W, s.H, step);
  ctx.drawImage(scene, 0, 0);
  // The tower: only floors that can show above the sea.
  for (let j = 0; j < game.floors.length; j++) {
    const i = game.base + j;
    const y = S.floorTop(game, CONFIG, i);
    if (y >= game.horizon) continue;
    const f = game.floors[j];
    drawFloor(ctx, f.x, y, f.w, colourOf(i));
  }
  const b = game.block;
  if (b.mode !== 'gone') drawFloor(ctx, b.x, S.blockTop(game, CONFIG), b.w, colourOf(b.i));
  drawBits(ctx);
  // The sea in front: the lowest floors, bits and a missed block disappear behind it.
  ctx.drawImage(scene, 0, game.horizon, s.W, s.H - game.horizon, 0, game.horizon, s.W, s.H - game.horizon);
  if (splash) drawSplash(ctx, now);
}

/* ---------- the loop: runs whenever the page is visible ---------- */

function frame(now) {
  raf = 0;
  if (document.hidden) return;
  if (!game) { // the screen is not measured yet
    last = now;
    raf = requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  // Made on the tile's touch but not yet shown: not play, so the clock waits.
  const fe = window.frameElement;
  if (!fe || fe.classList.contains('shown')) addPlay(clock, dt);
  const sl = slow();
  const instant = reducedMotion();
  acc += dt;
  while (acc >= S.DT) {
    acc -= S.DT;
    const ev = S.step(game, CONFIG, sl, instant);
    if (ev & S.EV_PLOP) splash = { x: game.block.x + game.block.w / 2, y: game.horizon + 1, t0: now };
  }
  // Bits fall into the sea and are gone once behind it.
  for (const p of bits) {
    p.vy += CONFIG.bitGravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  bits = bits.filter((p) => p.y < game.horizon);
  screen.render();
  raf = requestAnimationFrame(frame);
}

function run() {
  if (raf || document.hidden) return;
  last = performance.now();
  acc = 0;
  raf = requestAnimationFrame(frame);
}

function pause() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/* ---------- input: a tap anywhere drops the block ---------- */

const screen = createScreen(canvas, draw);

function nearEdge(e) {
  return atSideEdge(e); // shared: shared/pixel.js INPUT.edgeIgnoreCssPx
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!e.isPrimary || !game || !raf || nearEdge(e)) return; // one thumb: a second finger drops nothing
  const top = S.floorTop(game, CONFIG, game.block.i);
  const r = S.drop(game, CONFIG, slow());
  if (!r) return;
  lastDrop = { kind: r.kind, ratio: r.ratio, at: performance.now() };
  if (r.kind === 'snap') buzz(CONFIG.hapticSnapMs);
  else if (r.kind === 'land' || r.kind === 'fresh') buzz(CONFIG.hapticLandMs);
  if (r.cut.length && !reducedMotion()) {
    // The overhang breaks into a few bits that fall into the sea.
    const total = r.cut.reduce((a, p) => a + p.w, 0);
    const c = colourOf(r.cut[0].i);
    for (const p of r.cut) {
      const n = Math.max(1, Math.min(CONFIG.bitsMax, Math.round((CONFIG.bitsMax * p.w) / Math.max(total, 1)), Math.ceil(p.w / 2)));
      const away = p.x + p.w / 2 < r.floor.x + r.floor.w / 2 ? -1 : 1;
      for (let k = 0; k < n; k++) {
        bits.push({
          x: p.x + ((k + 0.5) * p.w) / n - 1,
          y: top + 1 + ((k * 3) % (CONFIG.blockH - 2)),
          vx: away * (6 + Math.random() * 18),
          vy: -10 - Math.random() * 20,
          c,
        });
      }
    }
  }
  screen.render();
});

/* ---------- lifecycle: hidden means paused ---------- */

function show() {
  if (document.hidden) return;
  // If the clock has started again (the page was hidden 5 minutes or more), so does the pace.
  if (clockWasReset() && game) S.resetPace(game, CONFIG);
  run();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
  else show();
});
addEventListener('pagehide', pause);
addEventListener('pageshow', show);
run();

// Read-only hook for tests/check.py; the game never reads it.
Object.defineProperty(window, '__stack', {
  value: Object.freeze({
    snapshot: () => ({
      game: game ? JSON.parse(JSON.stringify(game)) : null,
      top: game ? S.topIndex(game) : null,
      blockTop: game ? S.blockTop(game, CONFIG) : null,
      ceiling: S.ceilingOf(CONFIG, slow()),
      bits: bits.length,
      splash: !!splash,
      lastDrop: lastDrop ? { ...lastDrop } : null,
      raf: !!raf,
      clock: { ...clock },
      step: currentStep(),
      geo: game ? { W: game.W, H: game.H, horizon: game.horizon, scale: screen.scale, ox: screen.ox, oy: screen.oy } : null,
      now: performance.now(),
    }),
  }),
});
