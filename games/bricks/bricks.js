// Bricks (PLAN §6): rendering, input, pause and save, haptics. The simulation
// lives in physics.js (no DOM); this file draws it and feeds it the thumb.

// Tuning: one block (PLAN §6 Tuning). tests/bricks-sim.mjs reads it from here.
export const CONFIG = Object.freeze({
  ballSpeed: 95, // logical px per second, constant
  sensitivity: 1.2, // paddle px per finger px, relative drag
  hapticBrickMs: 8,
  hapticPaddleMs: 16,
  refillBelow: 35, // refill when fewer bricks than this remain
  resumeDelayMs: 250, // finger down to play
  serveAngleDeg: 10, // a new ball leaves this far from vertical, left then right
  loopBounces: 3, // paddle bounces in a row with no brick popped, then...
  loopNudgeDeg: 8, // ...the path turns this far, alternating sides
});

import { COLORS, BRICK_ROWS, SEA_BANDS, highlight } from '../../shared/tokens.js';
import { drawFitted, drawText, measure } from '../../shared/font.js';
import {
  createScreen, drawScene, drawBackControl, BACK_SIZE, initPage, hitTest, publishHits, goToHub,
  pixelBody, SEA_HEIGHT, reducedMotion,
} from '../../shared/pixel.js';
import { load, save } from '../../shared/store.js';
import { tick } from '../../shared/haptics.js';
import * as P from './physics.js';

initPage();

const SAVE_NAME = 'bricks'; // rlx.v<STATE_VERSION>.bricks: the full state
const SCORE_NAME = 'bricks-score'; // rlx.v1.bricks-score: the all-time score alone
const PAD = 6; // thumb-friendly hit area around the back control
const PARTICLES = 8;
const PARTICLE_S = 0.3;
const SPLASH_S = 0.3;
const TRAIL = 3;
const TRAIL_SPACING = 4; // px of travel between trail squares
const RING_R = 7;
const SPLASH = ['#.....#', '.#.#.#.', '..###..'];

const canvas = document.getElementById('screen');
let game = null;
let rects = null;
let layoutKey = '';
let bg = null; // the static scene for the current layout
let mode = 'paused'; // 'paused' | 'resuming' | 'running'
let resumeAt = 0;
let raf = 0;
let last = 0;
let acc = 0;
const pointers = new Map(); // pointerId -> last logical x, for every finger down
let driver = null; // the one finger that moves the paddle: the first down
let backPointer = null;
let backPressed = false;
const fx = { particles: [], trail: [], travel: 0, splash: null };

/* ---------- sprites ---------- */

function sprite(w, h, color, steps) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  pixelBody(g, 0, 0, w, h, color, steps);
  return c;
}

const BRICK_SPRITES = BRICK_ROWS.map((c) => sprite(P.BRICK_W, P.BRICK_H, c, 1));
const PARTICLE_HI = BRICK_ROWS.map((c) => highlight(c));
const TRAIL_COLOR = highlight(COLORS.blue);
const RING_FILL = highlight(SEA_BANDS[1]);
const SPLASH_TOP = COLORS.cloud;
const SPLASH_BODY = highlight(SEA_BANDS[0]);

/* ---------- save and restore ---------- */

function storedScore() {
  const n = load(SCORE_NAME, null, 1);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function loadGame(geo) {
  const raw = load(SAVE_NAME, null, P.STATE_VERSION);
  const s = P.restore(raw, geo, CONFIG);
  const kept = storedScore();
  if (s) {
    s.score = Math.max(s.score, kept);
    return s;
  }
  // Corrupt or old-version save: a fresh field, the score kept if readable.
  let score = Math.max(kept, P.readScore(raw) ?? 0);
  for (let v = 1; v < P.STATE_VERSION; v++) score = Math.max(score, P.readScore(load(SAVE_NAME, null, v)) ?? 0);
  return P.create(geo, CONFIG, score);
}

function persist() {
  if (!game) return;
  save(SAVE_NAME, game, P.STATE_VERSION);
  save(SCORE_NAME, game.score, 1);
}

/* ---------- layout and drawing ---------- */

function layout(s) {
  const side = Math.max(s.safe.left, s.safe.right);
  const back = { x: 4 + side, y: 5 + s.safe.top, w: BACK_SIZE.w, h: BACK_SIZE.h };
  const sx = back.x + back.w + 6;
  const score = { x: sx, y: back.y, w: s.W - 4 - side - sx, h: back.h };
  const horizon = s.H - SEA_HEIGHT;
  const geo = P.geometry(s.W, back.y + back.h + 5, horizon);
  const ring = { x: Math.floor(s.W / 2), y: Math.min(horizon + 21, s.H - s.safe.bottom - RING_R - 2) };
  return { back, score, geo, ring };
}

function paintBackground(s) {
  const c = document.createElement('canvas');
  c.width = s.W;
  c.height = s.H;
  const g = c.getContext('2d', { alpha: false });
  // Clouds in the open sky between the deepest possible row and the paddle.
  const open0 = rects.geo.top + P.MAX_ROWS * P.ROW_H + 4;
  const open1 = Math.max(open0, rects.geo.paddleY - 12);
  const at = (f) => Math.round(open0 + (open1 - open0) * f);
  drawScene(g, s.W, s.H, { clouds: [[92, at(0.1)], [10, at(0.45)], [44, at(0.85)]] });
  return c;
}

function drawBricks(ctx) {
  const g = game.geo;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, g.top, g.W, g.horizon - g.top);
  ctx.clip();
  const off = P.slideOffset(game);
  for (let r = 0; r < game.rows.length; r++) {
    const row = game.rows[r];
    if (!row.m) continue;
    const y = Math.round(g.top + r * P.ROW_H + off);
    const spr = BRICK_SPRITES[row.c];
    // A fading row dissolves in three dither stages: full, checker, sparse.
    const level = game.fade && game.fade.row === r ? Math.floor((game.fade.t / P.FADE_S) * 4) : 0;
    if (level >= 3) continue;
    for (let c = 0; c < P.COLS; c++) {
      if (!(row.m & (1 << c))) continue;
      const x = g.left + c * P.COL_W;
      if (level === 0) {
        ctx.drawImage(spr, x, y);
        continue;
      }
      for (let py = 0; py < P.BRICK_H; py++) {
        for (let px = 0; px < P.BRICK_W; px++) {
          const keep = level === 1 ? ((px + py) & 1) === 0 : (px % 2 === 0 && py % 2 === 0);
          if (keep) ctx.drawImage(spr, px, py, 1, 1, x + px, y + py, 1, 1);
        }
      }
    }
  }
  ctx.restore();
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
  disc(RING_R, COLORS.cloud);
  disc(RING_R - 1, RING_FILL);
  const cw = measure('<', 1);
  drawText(ctx, '<', x - RING_R - 8 - cw, y - 3, 1, COLORS.cloud);
  drawText(ctx, '>', x + RING_R + 9, y - 3, 1, COLORS.cloud);
}

function draw(ctx, s) {
  const key = `${s.W}x${s.H}@${s.scale}:${s.safe.top},${s.safe.right},${s.safe.bottom},${s.safe.left}`;
  if (key !== layoutKey || !rects) {
    rects = layout(s);
    if (!game) game = loadGame(rects.geo);
    else P.setGeometry(game, rects.geo);
    bg = paintBackground(s);
  }
  ctx.drawImage(bg, 0, 0);
  drawBricks(ctx);
  const g = game.geo;

  // particles
  for (const p of fx.particles) {
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
  }
  // trail: solid, checker, single pixel
  if (game.ball) {
    fx.trail.slice(1, TRAIL + 1).forEach((q, i) => {
      const x = Math.round(q.x) - 1;
      const y = Math.round(q.y) - 1;
      ctx.fillStyle = TRAIL_COLOR;
      if (i === 0) ctx.fillRect(x, y, 3, 3);
      else if (i === 1) for (let k = 0; k < 9; k += 2) ctx.fillRect(x + (k % 3), y + Math.floor(k / 3), 1, 1);
      else ctx.fillRect(x + 1, y + 1, 1, 1);
    });
    pixelBody(ctx, game.ball.x, game.ball.y, P.BALL, P.BALL, COLORS.blue, 1);
  }
  pixelBody(ctx, game.paddleX, g.paddleY, P.PADDLE_W, P.PADDLE_H, COLORS.coral, 2);

  if (fx.splash) {
    const x0 = Math.round(fx.splash.x) - 3;
    SPLASH.forEach((row, r) => {
      ctx.fillStyle = r === 0 ? SPLASH_TOP : SPLASH_BODY;
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x0 + c, g.horizon - 3 + r, 1, 1);
    });
  }
  if (mode === 'paused') drawRing(ctx);

  drawFitted(ctx, String(game.score), rects.score, COLORS.blue, { align: 'right', maxSize: 1 });
  drawBackControl(ctx, rects.back.x, rects.back.y, backPressed);

  if (key !== layoutKey) {
    layoutKey = key;
    publishHits(canvas, s, { back: rects.back });
  }
}

/* ---------- effects, advanced with the simulation ---------- */

function burst(e) {
  for (let i = 0; i < PARTICLES; i++) {
    const a = ((i + 0.5) / PARTICLES) * Math.PI * 2;
    const v = 24 + (i % 3) * 8;
    fx.particles.push({
      x: e.x - 1, y: e.y - 1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0,
      color: i === 0 ? PARTICLE_HI[e.c] : BRICK_ROWS[e.c],
    });
  }
}

function fxStep(dt) {
  const still = reducedMotion();
  if (still) {
    fx.particles.length = 0;
    fx.trail.length = 0;
  }
  for (const p of fx.particles) {
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 60 * dt;
  }
  if (fx.particles.length) fx.particles = fx.particles.filter((p) => p.t < PARTICLE_S);
  if (fx.splash && (fx.splash.t += dt) >= SPLASH_S) fx.splash = null;
  const b = game.ball;
  if (!b) {
    fx.trail.length = 0;
    fx.travel = 0;
  } else if (!still) {
    fx.travel += CONFIG.ballSpeed * dt;
    if (!fx.trail.length || fx.travel >= TRAIL_SPACING) {
      fx.travel = 0;
      fx.trail.unshift({ x: b.x + P.BALL / 2, y: b.y + P.BALL / 2 });
      if (fx.trail.length > TRAIL + 1) fx.trail.length = TRAIL + 1;
    }
  }
}

function handle(events) {
  for (const e of events) {
    if (e.type === 'brick') {
      tick(CONFIG.hapticBrickMs);
      if (!reducedMotion()) burst(e);
    } else if (e.type === 'paddle') {
      tick(CONFIG.hapticPaddleMs);
    } else if (e.type === 'splash') {
      fx.splash = { x: e.x, t: 0 };
    }
  }
}

/* ---------- loop: runs only while playing or resuming ---------- */

function frame(now) {
  raf = 0;
  if (document.hidden || !game) return;
  if (mode === 'resuming' && now >= resumeAt) {
    mode = 'running';
    last = now;
    acc = 0;
  }
  if (mode === 'running') {
    acc += Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    while (acc >= P.DT) {
      acc -= P.DT;
      handle(P.step(game, CONFIG));
      fxStep(P.DT);
    }
  }
  screen.render();
  if (mode !== 'paused') raf = requestAnimationFrame(frame);
}

/** Paint once on the next frame (used while paused: redraw only on change). */
function redraw() {
  if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
}

function pause() {
  if (mode !== 'paused') {
    mode = 'paused';
    acc = 0;
  }
  persist();
  redraw();
}

/* ---------- input: relative horizontal drag anywhere ---------- */

const screen = createScreen(canvas, draw);

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!rects || !game) return;
  const p = screen.toLogical(e.clientX, e.clientY);
  if (pointers.size === 0 && backPointer === null && hitTest(p, rects.back, PAD)) {
    backPointer = e.pointerId;
    backPressed = true;
    redraw();
    return;
  }
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
  pointers.set(e.pointerId, p.x);
  if (driver === null) driver = e.pointerId;
  if (mode === 'paused') {
    mode = 'resuming';
    resumeAt = performance.now() + CONFIG.resumeDelayMs;
    redraw();
  }
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
  if (!pointers.has(e.pointerId)) return;
  const x = screen.toLogical(e.clientX, e.clientY).x;
  const dx = x - pointers.get(e.pointerId);
  pointers.set(e.pointerId, x);
  if (e.pointerId !== driver || !dx) return;
  // Only a running game bounces the ball or ticks; while resuming the paddle
  // just moves (and stops at the ball).
  const live = mode === 'running';
  const ev = P.movePaddle(game, dx * CONFIG.sensitivity, CONFIG, live);
  if (live) handle(ev);
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
  if (!pointers.delete(e.pointerId)) return;
  if (e.pointerId === driver) {
    // The next finger still down, if any, takes over from where it is.
    driver = pointers.size ? pointers.keys().next().value : null;
  }
  if (pointers.size === 0) pause();
}

canvas.addEventListener('pointerup', (e) => { e.preventDefault(); lift(e, false); });
canvas.addEventListener('pointercancel', (e) => lift(e, true));

/* ---------- lifecycle: hidden or closed means paused and saved ---------- */

function sleep() {
  pointers.clear();
  driver = null;
  backPointer = null;
  backPressed = false;
  mode = 'paused';
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
addEventListener('pageshow', () => { mode = 'paused'; redraw(); });

// Read-only hook for tests/check.py; the game never reads it.
Object.defineProperty(window, '__bricks', {
  value: Object.freeze({
    snapshot: () => ({
      mode,
      raf: !!raf,
      fingers: pointers.size,
      count: game ? P.brickCount(game) : 0,
      particles: fx.particles.length,
      trail: fx.trail.length,
      game: game ? JSON.parse(JSON.stringify(game)) : null,
    }),
  }),
});
