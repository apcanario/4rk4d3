// Catch (PLAN §6b): rendering, input, pause and save, haptics. The simulation
// and the input rules live in sim.js (no DOM); this file draws the game and
// feeds it the thumb. The input code is Catch's own: Bricks keeps its own
// immediate pause in bricks.js, untouched.

// Tuning: one block (PLAN §6b Files). tests/catch-sim.mjs reads it from here.
// The ramp, slowdown and reset-gap lengths are shared: SESSION in shared/session.js.
export const CONFIG = Object.freeze({
  paceStart: 0.3, // hidden pace, 0 to 1: a new launch or a session-clock reset starts here
  gainPerCatch: 0.02,
  lossPerMiss: 0.15, // a missed item; a nasty landing uneaten changes nothing
  fallMin: 32, // fall speed at pace 0, logical px per second
  fallMax: 48, // fall speed at pace 1
  gapMax: 1.7, // spawn gap at pace 0, seconds
  gapMin: 1.1, // spawn gap at pace 1
  spawnSpreadPx: 70, // a spawn lands no further than this from the previous one
  maxItems: 3, // things to catch in the air at once
  swayPx: 3, // gentle sway either side
  nastyMinS: 20, // one nasty every 20 to 30 s of play, in place of a normal spawn
  nastyMaxS: 30,
  nastySpeed: 30, // px per second, not following the pace
  treatMinS: 90, // the rare treat on its parachute
  treatMaxS: 150,
  treatSpeed: 20,
  fishSpeed: 220, // a fish leaping at a nasty, px per second
  kindsStart: 2, // kinds of things to catch at the start...
  kindEvery: 40, // ...one more every 40 catches, then the order reshuffles
  fishKindsStart: 2, // fish kinds at the start...
  fishKindEvery: 5, // ...one more every 5 nasties eaten...
  fishKindsMax: 6, // ...up to 6
  tapMs: 200, // a tap: down and up within this...
  tapMovePx: 4, // ...moving less than this, in logical px
  graceMs: 400, // play goes on this long after the last finger lifts, then pauses
  resumeDelayMs: 250, // finger down while paused: play starts after this
  sensitivity: 1.2, // boat px per finger px, relative drag
  hapticCatchMs: 8,
  hapticBiteMs: 16,
});

import { COLORS, BRICK_ROWS, SEA_BANDS, mix, shade, highlight, edge, scenePalette, INK_CLOUD_AMOUNT } from '../../shared/tokens.js';
import { drawFitted } from '../../shared/font.js';
import {
  createScreen, drawScene, drawBackControl, BACK_SIZE, initPage, hitTest, publishHits, goToHub,
  pixelBody, steppedRect, SEA_HEIGHT, SUN_RADIUS, reducedMotion,
} from '../../shared/pixel.js';
import { load, save } from '../../shared/store.js';
import { tick } from '../../shared/haptics.js';
import {
  readClock, saveClock, beginPlay, addPlay, isStale, phaseOf, sceneStep, slowdownOf, SESSION,
} from '../../shared/session.js';
import * as S from './sim.js';

initPage();

const SAVE_NAME = 'catch'; // rlx.v<STATE_VERSION>.catch: the full state
const COUNT_NAME = 'catch-count'; // rlx.v1.catch-count: { caught, eaten } alone
const PAD = 6; // thumb-friendly hit area around the back control
const RING_R = 7;
const SUN_X = 96; // drawScene's default
const SEA_H = [13, 14, SEA_HEIGHT - 27]; // drawScene's sea bands
const SPLASH_S = 0.3;
const LANDED_S = 0.25; // a caught thing shows on the deck this long
const MISS_SPLASH = ['#.#', '.#.']; // 3 px
const DIVE_SPLASH = ['#.....#', '.#.#.#.', '..###..'];
const BITS = 6;
const BIT_S = 0.3;
const SPRAY = 3; // spray dots under a leaping fish (a trail: off with reduced motion)

const canvas = document.getElementById('screen');
let game = null;
let rects = null;
let layoutKey = '';
let bg = null;
let bgStep = -1;
let clock = null;
let clockReset = false;
let run = 0; // catches since the last miss; never saved
const ctl = S.createControl();
let raf = 0;
let last = 0;
let acc = 0;
let backPointer = null;
let backPressed = false;
const fx = { bits: [], splashes: [], landed: [] };

/* ---------- colours and sprites ---------- */

function colourOf(name) {
  if (name.startsWith('row')) return BRICK_ROWS[Number(name.slice(3))];
  return COLORS[name];
}

function paint(grid, body) {
  const keys = { '#': body, h: highlight(body), s: shade(body), o: edge(body), c: COLORS.sun };
  const c = document.createElement('canvas');
  c.width = grid[0].length;
  c.height = grid.length;
  const g = c.getContext('2d');
  grid.forEach((row, r) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue;
      g.fillStyle = keys[row[x]];
      g.fillRect(x, r, 1, 1);
    }
  });
  return c;
}

const flip = (grid) => grid.map((row) => [...row].reverse().join(''));
const ITEM_SPRITES = S.LOOK.items.map((it) => paint(S.spriteGrid(it.mask, true), colourOf(it.colour)));
const NASTY_SPRITES = S.LOOK.nasties.map((n) => paint(S.spriteGrid(n.mask, false), colourOf(n.colour)));
const FISH_GRID = S.spriteGrid(S.LOOK.fish.mask, true);
const FISH_SPRITES = S.LOOK.fish.colours.map((name) => {
  const c = colourOf(name);
  return { right: paint(FISH_GRID, c), left: paint(flip(FISH_GRID), c), up: paint(S.turnUp(FISH_GRID), c) };
});
// B4 contrast pass: the hull and the outlines carry a deep 1 px edge; the
// sail is its own pale token (it was the sun's cream), the jib the deeper pink.
const HULL = COLORS.coral;
const HULL_EDGE = edge(COLORS.coral);
const KEEL = COLORS.keel; // B4 review: the hull's rows below the horizon, so they clear every sea band
const MAST = edge(COLORS.coral);
const SAIL = COLORS.sail;
const SAIL_EDGE = edge(COLORS.sail);
const JIB = BRICK_ROWS[5];
const JIB_EDGE = edge(BRICK_ROWS[5]);
const CANOPY = colourOf(S.LOOK.treatCanopy);
const CANOPY_HI = highlight(CANOPY);
const STRING = shade(CANOPY);
const INK = COLORS.inkCloud;
const GLINT = COLORS.glint; // B4 review: the glint and the spray, pink so they read on the sun and the sea
const GULL = shade(COLORS.blue);
const DOLPHIN = COLORS.blue;
const SPLASH_TOP = COLORS.cloud;
const SPLASH_BODY = highlight(SEA_BANDS[0]);
const RING_FILL = highlight(SEA_BANDS[1]);

/* ---------- save and restore ---------- */

function storedCounts() {
  const c = S.readCounts(load(COUNT_NAME, null, 1));
  return { caught: c.caught ?? 0, eaten: c.eaten ?? 0 };
}

function loadClock() {
  const r = readClock(Date.now());
  clock = r.clock;
  clockReset = r.reset;
}

function newSeed() {
  return ((Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0) || 1;
}

function loadGame(geo) {
  const raw = load(SAVE_NAME, null, S.STATE_VERSION);
  const kept = storedCounts();
  const s = S.restore(raw, geo, CONFIG);
  if (s) {
    s.caught = Math.max(s.caught, kept.caught);
    s.eaten = Math.max(s.eaten, kept.eaten);
    if (clockReset) S.resetPace(s, CONFIG); // a new session starts at paceStart
    return s;
  }
  // No save, or a corrupt or old-version one: a fresh scene, the counts kept if readable.
  const fromRaw = S.readCounts(raw);
  return S.create(geo, CONFIG, {
    caught: Math.max(kept.caught, fromRaw.caught ?? 0),
    eaten: Math.max(kept.eaten, fromRaw.eaten ?? 0),
  }, newSeed());
}

function persist() {
  if (!game) return;
  save(SAVE_NAME, game, S.STATE_VERSION);
  save(COUNT_NAME, { caught: game.caught, eaten: game.eaten }, 1);
  if (clock) saveClock(clock);
}

/* ---------- layout and drawing ---------- */

function layout(s) {
  const side = Math.max(s.safe.left, s.safe.right);
  const back = { x: 4 + side, y: 5 + s.safe.top, w: BACK_SIZE.w, h: BACK_SIZE.h };
  const sx = back.x + back.w + 6;
  // Count on the back control's top line, the run under it (as in Bricks).
  const count = { x: sx, y: back.y, w: s.W - 4 - side - sx, h: 7 };
  const runBox = { x: sx, y: back.y + 9, w: count.w, h: 7 };
  const horizon = s.H - SEA_HEIGHT;
  const geo = S.geometry(s.W, back.y + back.h + 5, horizon);
  const ring = { x: Math.floor(s.W / 2), y: Math.min(horizon + 21, s.H - s.safe.bottom - RING_R - 2) };
  return { back, count, run: runBox, geo, ring };
}

function paintBackground(s, phase) {
  const c = document.createElement('canvas');
  c.width = s.W;
  c.height = s.H;
  const g = c.getContext('2d', { alpha: false });
  const open0 = rects.geo.top + 6;
  const open1 = Math.max(open0, rects.geo.horizon - SUN_RADIUS - 14);
  const at = (f) => Math.round(open0 + (open1 - open0) * f);
  drawScene(g, s.W, s.H, { clouds: [[92, at(0.12)], [10, at(0.42)], [44, at(0.8)]], phase, stars: [open0, open1] });
  return c;
}

// The ink cloud: the sea bands darkened, full for INK_S, then two dither stages.
function drawInk(ctx, step) {
  const left = game.ink;
  if (left <= 0) return;
  const pal = scenePalette(step / SESSION.sceneSteps);
  const level = left > S.INK_FADE_S ? 0 : left > S.INK_FADE_S / 2 ? 1 : 2;
  let y = game.geo.horizon;
  const W = game.geo.W;
  SEA_H.forEach((h, i) => {
    ctx.fillStyle = mix(pal.sea[i], INK, INK_CLOUD_AMOUNT);
    if (level === 0) ctx.fillRect(0, y, W, h);
    else {
      for (let r = 0; r < h; r++) {
        for (let x = 0; x < W; x++) {
          const keep = level === 1 ? ((x + r) & 1) === 0 : (x % 2 === 0 && r % 2 === 0);
          if (keep) ctx.fillRect(x, y + r, 1, 1);
        }
      }
    }
    y += h;
  });
}

function drawSky(ctx, step) {
  const e = game.sky;
  if (!e) return;
  const g = game.geo;
  const u = e.t / S.SKY_S[e.k];
  if (e.k === 'gull') {
    const x = Math.round(-6 + (g.W + 12) * u);
    const y = Math.round(g.top + (g.horizon - g.top) * 0.3);
    const up = Math.floor(e.t * 6) % 2 === 0;
    ctx.fillStyle = GULL;
    ctx.fillRect(x + 2, y + 1, 1, 1);
    ctx.fillRect(x, y + (up ? 0 : 1), 2, 1);
    ctx.fillRect(x + 3, y + (up ? 0 : 1), 2, 1);
  } else if (e.k === 'dolphin') {
    const x = Math.round(18 + 44 * u);
    const y = Math.round(g.horizon - 3 - Math.sin(Math.PI * u) * 10);
    const rows = u < 0.5 ? ['...##', '.####', '##...'] : ['##...', '####.', '...##'];
    ctx.fillStyle = DOLPHIN;
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === '#' && y + r < g.horizon) ctx.fillRect(x + c, y + r, 1, 1);
    });
  } else {
    // A glint on the sun, or on the sea once the sun is down.
    const sink = Math.round((step / SESSION.sceneSteps) * SUN_RADIUS);
    const y = step < SESSION.sceneSteps ? g.horizon - (SUN_RADIUS - sink) + 3 : g.horizon + 4;
    const r = Math.floor(e.t * 8) % 2 === 0 ? 2 : 1;
    ctx.fillStyle = GLINT;
    ctx.fillRect(SUN_X - r, y, r * 2 + 1, 1);
    ctx.fillRect(SUN_X, y - r, 1, r * 2 + 1);
  }
}

function drawTreat(ctx) {
  const t = game.treat;
  if (!t) return;
  const x = Math.round(S.swayX(t, CONFIG));
  const y = Math.round(t.y);
  // Parachute: a small dome with two strings down to the thing.
  ctx.fillStyle = CANOPY;
  ctx.fillRect(x + 1, y - 7, 5, 1);
  ctx.fillRect(x, y - 6, 7, 2);
  ctx.fillStyle = CANOPY_HI;
  ctx.fillRect(x + 2, y - 6, 3, 1);
  ctx.fillStyle = STRING;
  ctx.fillRect(x, y - 4, 1, 3);
  ctx.fillRect(x + 6, y - 4, 1, 3);
  ctx.drawImage(ITEM_SPRITES[t.k], x, y);
}

function drawFish(ctx) {
  const still = reducedMotion();
  for (const f of game.fish) {
    const spr = FISH_SPRITES[f.k] || FISH_SPRITES[0];
    if (f.m === 'leap') {
      const x = Math.round(f.cx - S.FISH_H / 2);
      const y = Math.round(f.y);
      if (!still) {
        ctx.fillStyle = GLINT;
        for (let i = 1; i <= SPRAY; i++) if (y + S.FISH_W + i * 4 < game.geo.horizon + 4) ctx.fillRect(x + 2, y + S.FISH_W + i * 4, 1, 1);
      }
      ctx.drawImage(spr.up, x, y);
    } else {
      ctx.drawImage(f.vx < 0 ? spr.left : spr.right, Math.round(f.cx - S.FISH_W / 2), Math.round(f.y));
    }
  }
}

function drawBoat(ctx) {
  const g = game.geo;
  const rock = game.rock > 0 ? (Math.floor(game.rock * 8) % 2 === 0 ? 1 : -1) : 0;
  const x = Math.round(game.boatX) + rock;
  const deck = g.deckY + (game.dip > 0 ? 1 : 0);
  // Mast, 11 px; the sail, 9 px tall, to its right; a small pink jib to its left.
  const mx = x + 11;
  for (let r = 0; r < 9; r++) {
    const w = r + 1;
    const y = deck - 10 + r;
    ctx.fillStyle = SAIL;
    ctx.fillRect(mx + 1, y, w, 1);
    ctx.fillStyle = SAIL_EDGE;
    ctx.fillRect(mx + w, y, 1, 1);
  }
  ctx.fillStyle = SAIL_EDGE;
  ctx.fillRect(mx + 1, deck - 2, 9, 1);
  for (let r = 0; r < 6; r++) {
    const w = Math.floor(r / 2) + 1;
    ctx.fillStyle = JIB;
    ctx.fillRect(mx - w, deck - 8 + r, w, 1);
    ctx.fillStyle = JIB_EDGE;
    ctx.fillRect(mx - w, deck - 8 + r, 1, 1);
  }
  ctx.fillStyle = MAST;
  ctx.fillRect(mx, deck - 11, 1, 11);
  pixelBody(ctx, x, deck, S.BOAT_W, S.BOAT_H, HULL, 2, HULL_EDGE);
  // The keel: the hull's rows at and below the horizon redrawn in the keel colour, same shape.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, g.horizon, S.BOAT_W, S.BOAT_H);
  ctx.clip();
  steppedRect(ctx, x, deck, S.BOAT_W, S.BOAT_H, KEEL, 2);
  ctx.restore();
  for (const l of fx.landed) ctx.drawImage(ITEM_SPRITES[l.k], x + Math.round(l.x - S.ITEM / 2), deck - S.ITEM + 1);
}

function drawSplash(ctx, sp) {
  const rows = sp.big ? DIVE_SPLASH : MISS_SPLASH;
  const x0 = Math.round(sp.x) - Math.floor(rows[0].length / 2);
  rows.forEach((row, r) => {
    ctx.fillStyle = r === 0 ? SPLASH_TOP : SPLASH_BODY;
    for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x0 + c, game.geo.horizon - rows.length + r, 1, 1);
  });
}

function drawRing(ctx) {
  const { x, y } = rects.ring;
  const disc = (r, color) => {
    ctx.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt((r + 0.5) * (r + 0.5) - dy * dy));
      ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
    }
  };
  disc(RING_R + 1, COLORS.ink); // B4: the white ring in a 1 px ink ring
  disc(RING_R, COLORS.cloud);
  disc(RING_R - 1, SEA_BANDS[1]);
  ctx.fillStyle = RING_FILL;
  ctx.fillRect(x - 2, y - 2, 5, 5);
}

function draw(ctx, s) {
  const key = `${s.W}x${s.H}@${s.scale}:${s.safe.top},${s.safe.right},${s.safe.bottom},${s.safe.left}`;
  if (!clock) loadClock();
  const phase = isStale(clock, Date.now()) ? 0 : phaseOf(clock.active);
  if (key !== layoutKey || !rects) {
    rects = layout(s);
    if (!game) game = loadGame(rects.geo);
    else S.setGeometry(game, rects.geo);
    bgStep = -1;
  }
  const step = sceneStep(phase);
  if (step !== bgStep) {
    bg = paintBackground(s, phase);
    bgStep = step;
    canvas.dataset.scene = String(bgStep);
  }
  ctx.drawImage(bg, 0, 0);
  drawInk(ctx, step);
  drawSky(ctx, step);
  drawTreat(ctx);
  for (const it of game.items) ctx.drawImage(ITEM_SPRITES[it.k], Math.round(S.swayX(it, CONFIG)), Math.round(it.y));
  if (game.nasty) ctx.drawImage(NASTY_SPRITES[game.nasty.k], Math.round(game.nasty.x), Math.round(game.nasty.y));
  drawFish(ctx);
  for (const b of fx.bits) {
    ctx.fillStyle = b.color;
    ctx.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
  }
  drawBoat(ctx);
  for (const sp of fx.splashes) drawSplash(ctx, sp);
  if (ctl.mode === 'paused') drawRing(ctx);

  const hud = {
    count: drawFitted(ctx, String(game.caught), rects.count, COLORS.ink, { align: 'right', maxSize: 1 }),
    run: drawFitted(ctx, String(run), rects.run, COLORS.ink, { align: 'right', maxSize: 1 }),
  };
  drawBackControl(ctx, rects.back.x, rects.back.y, backPressed);
  if (key !== layoutKey) {
    layoutKey = key;
    publishHits(canvas, s, { back: rects.back, count: rects.count, run: rects.run });
  }
  canvas.dataset.hud = JSON.stringify(hud); // drawn text sizes (0: did not fit)
}

/* ---------- effects, advanced with the simulation ---------- */

function burst(x, y) {
  for (let i = 0; i < BITS; i++) {
    const a = ((i + 0.5) / BITS) * Math.PI * 2;
    fx.bits.push({ x, y, vx: Math.cos(a) * 26, vy: Math.sin(a) * 26, t: 0, color: i % 2 ? COLORS.blue : COLORS.cloud });
  }
}

function fxStep(dt) {
  if (reducedMotion()) fx.bits.length = 0;
  for (const b of fx.bits) {
    b.t += dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vy += 60 * dt;
  }
  if (fx.bits.length) fx.bits = fx.bits.filter((b) => b.t < BIT_S);
  for (const sp of fx.splashes) sp.t += dt;
  if (fx.splashes.length) fx.splashes = fx.splashes.filter((sp) => sp.t < SPLASH_S);
  for (const l of fx.landed) l.t += dt;
  if (fx.landed.length) fx.landed = fx.landed.filter((l) => l.t < LANDED_S);
}

function handle(events) {
  run = S.runAfter(run, events);
  for (const e of events) {
    if (e.type === 'catch') {
      tick(CONFIG.hapticCatchMs);
      fx.landed.push({ x: e.x - game.boatX, k: e.k, t: 0 }); // x on the deck
    } else if (e.type === 'bite') {
      tick(CONFIG.hapticBiteMs);
      if (!reducedMotion()) burst(e.x, e.y);
    } else if (e.type === 'miss') {
      fx.splashes.push({ x: e.x, t: 0, big: false });
    } else if (e.type === 'dive') {
      fx.splashes.push({ x: e.x, t: 0, big: true });
    }
  }
}

/* ---------- loop: runs only while playing, resuming or in the grace ---------- */

function frame(now) {
  raf = 0;
  if (document.hidden || !game) return;
  const change = S.ctlTick(ctl, now);
  if (change === 'start') {
    last = now;
    acc = 0;
    // Active play starts: after the reset gap the clock and the pace start again.
    if (beginPlay(clock, Date.now())) S.resetPace(game, CONFIG);
  } else if (change === 'pause') {
    pause();
    return;
  }
  if (ctl.mode === 'running') {
    acc += Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const wall = Date.now();
    while (acc >= S.DT) {
      acc -= S.DT;
      addPlay(clock, S.DT, wall); // the grace is play too; paused time never counts
      handle(S.step(game, CONFIG, slowdownOf(clock.active)));
      fxStep(S.DT);
    }
  }
  screen.render();
  if (ctl.mode !== 'paused') raf = requestAnimationFrame(frame);
}

function redraw() {
  if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
}

function pause() {
  acc = 0;
  persist();
  redraw();
}

/* ---------- input: relative drag anywhere, taps for the fish ---------- */

const screen = createScreen(canvas, draw);

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!rects || !game) return;
  const p = screen.toLogical(e.clientX, e.clientY);
  if (ctl.pointers.size === 0 && backPointer === null && hitTest(p, rects.back, PAD)) {
    backPointer = e.pointerId;
    backPressed = true;
    redraw();
    return;
  }
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
  S.ctlDown(ctl, e.pointerId, performance.now(), p.x, p.y, CONFIG);
  redraw();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === backPointer) {
    const on = hitTest(screen.toLogical(e.clientX, e.clientY), rects.back, PAD);
    if (on !== backPressed) {
      backPressed = on;
      redraw();
    }
    return;
  }
  if (!ctl.pointers.has(e.pointerId)) return;
  const p = screen.toLogical(e.clientX, e.clientY);
  const dx = S.ctlMove(ctl, e.pointerId, p.x, p.y, CONFIG);
  if (dx) S.moveBoat(game, dx);
});

function lift(e, cancelled) {
  if (e.pointerId === backPointer) {
    const hit = !cancelled && hitTest(screen.toLogical(e.clientX, e.clientY), rects.back, PAD);
    backPointer = null;
    backPressed = false;
    if (hit) {
      persist();
      goToHub();
      return;
    }
    redraw();
    return;
  }
  if (!ctl.pointers.has(e.pointerId)) return;
  const before = ctl.mode;
  if (S.ctlUp(ctl, e.pointerId, performance.now(), CONFIG, cancelled)) handle(S.tap(game, CONFIG));
  if (before !== 'paused' && ctl.mode === 'paused') pause(); // lifted before play resumed
  else redraw();
}

canvas.addEventListener('pointerup', (e) => { e.preventDefault(); lift(e, false); });
canvas.addEventListener('pointercancel', (e) => lift(e, true));

/* ---------- lifecycle: hidden or closed means paused and saved ---------- */

function sleep() {
  S.ctlSleep(ctl);
  backPointer = null;
  backPressed = false;
  acc = 0;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  persist();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sleep();
  else redraw();
});
addEventListener('pagehide', sleep);
addEventListener('pageshow', () => { S.ctlSleep(ctl); redraw(); });

// Read-only hook for tests/check.py; the game never reads it.
Object.defineProperty(window, '__catch', {
  value: Object.freeze({
    snapshot: () => ({
      mode: ctl.mode,
      grace: ctl.graceEnd !== null,
      raf: !!raf,
      fingers: ctl.pointers.size,
      run,
      clock: clock ? { ...clock } : null,
      step: bgStep,
      bits: fx.bits.length,
      game: game ? JSON.parse(JSON.stringify(game)) : null,
    }),
  }),
});
