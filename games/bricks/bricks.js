// Bricks (PLAN §6): rendering, input, pause, haptics. The simulation lives
// in physics.js (no DOM); this file draws it and feeds it the thumb.
//
// Hard rules (PLAN §2, row X1): no text, number, button or HUD; the Android
// back gesture goes home; touches that begin within 24 CSS px of the left or
// right edge are ignored; nothing is stored; opening Bricks always starts a
// fresh field; haptics are always on; no sound.

// Tuning: one block (PLAN §6 Tuning, §6a). tests/bricks-sim.mjs reads it from
// here. The ramp, slowdown and reset-gap lengths are shared: SESSION in
// shared/session.js; the edge rule is shared: INPUT in shared/pixel.js.
export const CONFIG = Object.freeze({
  speedMin: 80, // ball speed, logical px per second: the pace (PLAN §2b, §6 Ball)
  speedStart: 90, // opening Bricks or a session-clock reset starts here
  speedMax: 125, // the ceiling, which falls to speedMin in the dusk slowdown
  gainPerReturn: 1, // each clean paddle return
  lossPerMiss: 12, // each miss
  hapticBrickMs: 8,
  hapticPaddleMs: 16,
  refillBelow: 35, // refill when fewer bricks than this remain
  resumeDelayMs: 250, // finger down to play
  serveAngleDeg: 10, // a new ball leaves this far from vertical, left then right
  loopBounces: 3, // paddle bounces in a row with no brick popped, then...
  loopNudgeDeg: 8, // ...the path turns this far, alternating sides
});

import { COLORS, BRICK_ROWS, SEA_BANDS, highlight, edge } from '../../shared/tokens.js';
import {
  createScreen, drawScene, initPage, pixelBody, SEA_HEIGHT, reducedMotion, atSideEdge, thumbSensitivity,
} from '../../shared/pixel.js';
import { tick } from '../../shared/haptics.js';
import {
  sessionClock, watchReset, addPlay, phaseOf, sceneStep, slowdownOf,
} from '../../shared/session.js';
import * as P from './physics.js';

initPage();

const TOP = 5; // the field starts this far below the top of the screen (inside the safe area)
const PARTICLES = 8;
const PARTICLE_S = 0.3;
const SPLASH_S = 0.3;
const TRAIL = 3;
const TRAIL_SPACING = 4; // px of travel between trail squares
const SPLASH = ['#.....#', '.#.#.#.', '..###..'];

const canvas = document.getElementById('screen');
let game = null;
let rects = null;
let layoutKey = '';
let sensitivity = 1; // paddle px per finger px: from the shared thumb travel, set in layout()
let bg = null; // the scene for the current layout and scene step
let bgStep = -1;
const clock = sessionClock(); // the one shared session clock, in memory (shared/session.js)
const clockWasReset = watchReset(clock); // true once after each reset: the pace starts again
let mode = 'paused'; // 'paused' | 'resuming' | 'running'
let resumeAt = 0;
let raf = 0;
let last = 0;
let acc = 0;
const pointers = new Map(); // pointerId -> last logical x, for every finger down
let driver = null; // the one finger that moves the paddle: the first down
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
const SPLASH_TOP = COLORS.cloud;
const SPLASH_BODY = highlight(SEA_BANDS[0]);
const PADDLE_EDGE = edge(COLORS.coral); // B4: the paddle's 1 px edge all round

/* ---------- layout and drawing ---------- */

function layout(s) {
  // No HUD: the field takes the whole screen down from the top.
  const horizon = s.H - SEA_HEIGHT;
  const geo = P.geometry(s.W, TOP + s.safe.top, horizon);
  // Thumb travel (PLAN §6a, §6e): a drag across INPUT.thumbTravel of the screen
  // width carries the paddle from one end of the field to the other. The finger
  // is measured in logical px, so the screen width is too.
  sensitivity = thumbSensitivity(geo.W - P.PADDLE_W, canvas.width / s.scale);
  return { geo };
}

function paintBackground(s, phase) {
  const c = document.createElement('canvas');
  c.width = s.W;
  c.height = s.H;
  const g = c.getContext('2d', { alpha: false });
  // Clouds in the open sky between the deepest possible row and the paddle.
  const open0 = rects.geo.top + P.MAX_ROWS * P.ROW_H + 4;
  const open1 = Math.max(open0, rects.geo.paddleY - 12);
  const at = (f) => Math.round(open0 + (open1 - open0) * f);
  drawScene(g, s.W, s.H, {
    clouds: [[92, at(0.1)], [10, at(0.45)], [44, at(0.85)]], phase, stars: [open0, open1],
  });
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

function draw(ctx, s) {
  const key = `${s.W}x${s.H}@${s.scale}:${s.safe.top},${s.safe.right},${s.safe.bottom},${s.safe.left}`;
  const phase = phaseOf(clock.active);
  if (key !== layoutKey || !rects) {
    rects = layout(s);
    if (!game) game = P.create(rects.geo, CONFIG); // a fresh field on every opening
    else P.setGeometry(game, rects.geo);
    bgStep = -1;
  }
  if (sceneStep(phase) !== bgStep) {
    bg = paintBackground(s, phase);
    bgStep = sceneStep(phase);
    canvas.dataset.scene = String(bgStep);
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
  pixelBody(ctx, game.paddleX, g.paddleY, P.PADDLE_W, P.PADDLE_H, COLORS.coral, 2, PADDLE_EDGE);

  if (fx.splash) {
    const x0 = Math.round(fx.splash.x) - 3;
    SPLASH.forEach((row, r) => {
      ctx.fillStyle = r === 0 ? SPLASH_TOP : SPLASH_BODY;
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x0 + c, g.horizon - 3 + r, 1, 1);
    });
  }
  // X33 (2026-11-26): no pause marker; a paused frame is the scene and the pieces only.
  layoutKey = key;
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
    fx.travel += game.speed * dt;
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
    // Active play starts: if the clock has started again since, so does the pace.
    if (clockWasReset()) P.resetPace(game, CONFIG);
  }
  if (mode === 'running') {
    acc += Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    while (acc >= P.DT) {
      acc -= P.DT;
      // Only running steps advance the session clock: paused time never does.
      addPlay(clock, P.DT);
      handle(P.step(game, CONFIG, slowdownOf(clock.active)));
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
  redraw();
}

/* ---------- input: relative horizontal drag anywhere but the side edges ---------- */

const screen = createScreen(canvas, draw);

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!rects || !game || atSideEdge(e)) return; // an edge swipe is the back gesture: it moves nothing
  const p = screen.toLogical(e.clientX, e.clientY);
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
  if (!pointers.has(e.pointerId)) return;
  const x = screen.toLogical(e.clientX, e.clientY).x;
  const dx = x - pointers.get(e.pointerId);
  pointers.set(e.pointerId, x);
  if (e.pointerId !== driver || !dx) return;
  // Only a running game bounces the ball or ticks; while resuming the paddle
  // just moves (and stops at the ball).
  const live = mode === 'running';
  const ev = P.movePaddle(game, dx * sensitivity, CONFIG, live, slowdownOf(clock.active));
  if (live) handle(ev);
});

function lift(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (e.pointerId === driver) {
    // The next finger still down, if any, takes over from where it is.
    driver = pointers.size ? pointers.keys().next().value : null;
  }
  if (pointers.size === 0) pause();
}

canvas.addEventListener('pointerup', (e) => { e.preventDefault(); lift(e); });
canvas.addEventListener('pointercancel', (e) => lift(e));

/* ---------- lifecycle: hidden or closed means paused; nothing is saved ---------- */

function sleep() {
  pointers.clear();
  driver = null;
  mode = 'paused';
  acc = 0;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sleep();
  else redraw();
});
addEventListener('pagehide', sleep);
addEventListener('pageshow', () => { mode = 'paused'; redraw(); });

// Hook for tests/check.py; the game never reads it. snapshot() is a copy;
// live() is the game state itself, so a test can set up a scene.
Object.defineProperty(window, '__bricks', {
  value: Object.freeze({
    live: () => game,
    snapshot: () => ({
      mode,
      raf: !!raf,
      fingers: pointers.size,
      sensitivity,
      count: game ? P.brickCount(game) : 0,
      view: { W: screen.W, H: screen.H, scale: screen.scale, ox: screen.ox, oy: screen.oy },
      clock: { ...clock },
      step: bgStep,
      particles: fx.particles.length,
      trail: fx.trail.length,
      game: game ? JSON.parse(JSON.stringify(game)) : null,
    }),
  }),
});
