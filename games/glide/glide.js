// Glide (PLAN §6i): beach air hockey against a crab. Drawing, the thumb,
// pause, haptics and the session clock. The table, the puck and the hitting
// live in sim.js, the crab's mind in bot.js; neither touches the DOM.
//
// Hard rules (PLAN §2): no text, number, button or HUD; nothing counted or
// stored; the Android back gesture goes home; touches that begin within 24
// CSS px of the left or right edge are ignored; opening Glide always starts a
// fresh table, paused, the puck on the centre spot; haptics always on; no sound.

// Play values: one block. tests/glide-sim.mjs reads it from here. The table and
// physics values are SIM in sim.js, the crab's BOT in bot.js; the thumb travel
// and the edge band are shared (INPUT in shared/pixel.js), the ramp lengths too
// (SESSION in shared/session.js).
export const CONFIG = Object.freeze({
  resumeDelayMs: 250, // finger down to play (as Bricks)
  hapticHitMinMs: 8, // a mallet hit: 8 ms for a soft one...
  hapticHitMaxMs: 14, // ...up to 14 ms for a hard one
  hitSoft: 20, // px/s along the normal: at or under this a hit ticks hapticHitMinMs...
  hitHard: 200, // ...at or over this hapticHitMaxMs, linear between
  hapticWallMs: 6,
  hapticGoalMs: 24, // either end
  wallTickMinSpeed: 8, // a wall touch slower than this (px/s along the normal) does not tick
  puckOutS: 0.35, // after a goal the puck shows this long running out
  pulseS: 0.45, // the soft pulse at the goal mouth (none under reduced motion)
  waveS: 0.9, // the small wave over the goal mouth
});

import * as TK from '../../shared/tokens.js';
import { tokens, onThemeChange } from '../../shared/tokens.js';
import { createScreen, initPage, atSideEdge, thumbSensitivity, reducedMotion, ditherRow, seaSplit } from '../../shared/pixel.js';
import { MIN_GAP_MS, canVibrate, send } from '../../shared/haptics.js';
import { sessionClock, watchReset, addPlay, phaseOf, sceneStep, slowdownOf, SESSION } from '../../shared/session.js';
import * as S from './sim.js';
import * as B from './bot.js';

initPage();

/* ---------- sprites: masks made once, coloured from the active token set ---------- */

const { PUCK_MASK, RING_MASK, CRAB_MASK } = S;

function paintMask(ctx, mask, keys, x, y) {
  for (let r = 0; r < mask.length; r++) {
    const row = mask[r];
    for (let c = 0; c < row.length; c++) {
      const k = row[c];
      if (k === '.') continue;
      ctx.fillStyle = keys[k];
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}

function spriteOf(mask, keys) {
  const c = document.createElement('canvas');
  c.width = mask[0].length;
  c.height = mask.length;
  paintMask(c.getContext('2d'), mask, keys, 0, 0);
  return c;
}

let SPR = null;
function retheme() {
  const k = S.pieceColours(TK);
  SPR = { puck: spriteOf(PUCK_MASK, k.puck), ring: spriteOf(RING_MASK, k.ring), crab: spriteOf(CRAB_MASK, k.crab) };
}
retheme();

// Decor on the sand: [kind, x, fraction of the table from the goal line down]. Clear of the lines, the
// circle, the goals and the side bands; small, in pale tints of the sand (never the tracked colours).
const DECOR = [
  ['star-blue', 104, 0.22], ['dot', 34, 0.3], ['star-pink', 18, 0.39], ['dot', 98, 0.62],
  ['shell', 20, 0.7], ['dot', 28, 0.86], ['star-pink', 110, 0.84], ['dot', 64, 0.34], ['dot', 74, 0.9],
];

const canvas = document.getElementById('screen');
let game = null;
let bot = null;
let geo = null;
let layoutKey = '';
let sensitivity = 1;
let bg = null;
let bgKey = '';
const target = { x: 0, y: 0 }; // where the thumb wants the ring
const clock = sessionClock();
const clockWasReset = watchReset(clock);
let mode = 'paused'; // 'paused' | 'resuming' | 'running'
let resumeAt = 0;
let raf = 0;
let last = 0;
let acc = 0;
const pointers = new Map(); // pointerId -> last logical point
let driver = null;
let goalFx = null; // { by, t } the pulse and the wave over a goal mouth
let rng = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
const rnd = () => {
  rng = (rng + 0x6D2B79F5) >>> 0;
  let t = Math.imul(rng ^ (rng >>> 15), rng | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ---------- the background: sand, sea strip, goals, lines, decor ---------- */

function paintBackground(s, k) {
  const c = document.createElement('canvas');
  c.width = s.W;
  c.height = s.H;
  const g = c.getContext('2d', { alpha: false });
  const col = S.tableColours(TK, k / SESSION.sceneSteps);
  const W = s.W;
  const { T, G, yB, xL, xR } = geo;
  const mx0 = Math.round(geo.mx0);
  const mx1 = Math.round(geo.mx1);
  g.fillStyle = col.ground;
  g.fillRect(0, 0, W, s.H);

  // The sea strip, its three bands with dither seams, and the inlet down to the goal line.
  const hs = seaSplit(T);
  let y = 0;
  hs.forEach((h, i) => {
    g.fillStyle = col.sea[i];
    g.fillRect(0, y, W, h);
    if (i > 0 && h > 0) ditherRow(g, 0, y, W, col.sea[i], col.sea[i - 1], i);
    y += h;
  });
  g.fillStyle = col.inlet;
  g.fillRect(mx0, T, mx1 - mx0, G - T);
  // The sun's (in dark, the moon's) reflection: dashes down the strip, shorter as it sinks.
  const fade = 1 - 0.5 * (k / SESSION.sceneSteps);
  g.fillStyle = col.glint;
  [[2, 14], [4, 10], [6, 12], [8, 7], [10, 9], [12, 5]].forEach(([dy, len]) => {
    const L = Math.max(2, Math.round(len * fade));
    if (dy < T - 1) g.fillRect(Math.round(geo.cx - L / 2), dy, L, 1);
  });
  for (const [gx, gy, len] of [[10, 3, 6], [26, 7, 4], [104, 5, 5], [120, 9, 4], [42, 11, 3], [90, 11, 3]]) {
    if (gy < T - 1) g.fillRect(gx, gy, len, 1);
  }

  // The tide line: foam along the sand's edge and round the inlet, wet sand under it.
  g.fillStyle = col.wet;
  g.fillRect(xL, T + 1, mx0 - 1 - xL, 2);
  g.fillRect(mx1 + 1, T + 1, xR - mx1 - 1, 2);
  g.fillRect(mx0 - 3, T + 1, 2, G - T + 2);
  g.fillRect(mx1 + 1, T + 1, 2, G - T + 2);
  g.fillRect(mx0 - 1, G + 1, mx1 - mx0 + 2, 2);
  g.fillStyle = col.foam;
  for (let x = 0; x < W; x++) {
    if (x >= mx0 - 1 && x <= mx1) continue;
    g.fillRect(x, T, 1, 1);
    if (x % 8 === 3 || x % 8 === 4) g.fillRect(x, T + 1, 1, 1); // a gentle scallop
  }
  g.fillRect(mx0 - 1, T, 1, G - T + 1); // the inlet's sides
  g.fillRect(mx1, T, 1, G - T + 1);
  g.fillRect(mx0 - 1, G, mx1 - mx0 + 2, 1); // the goal line: a rope between the buoys

  // The walls: a darker band down each side and along the bottom; the player's goal is a gap in it.
  g.fillStyle = col.wall;
  g.fillRect(0, T, xL, s.H - T);
  g.fillRect(xR, T, W - xR, s.H - T);
  g.fillRect(0, yB, W, S.SIM.band);
  g.fillStyle = col.gap;
  g.fillRect(mx0, yB, mx1 - mx0, S.SIM.band);

  // The centre line and circle, dashed and thin.
  const my = Math.round(geo.mid);
  g.fillStyle = col.line;
  for (let x = xL + 2; x < xR - 1; x += 7) g.fillRect(x, my, Math.min(4, xR - 1 - x), 1);
  const cr = 16;
  for (let a = 0; a < 360; a += 2) {
    const px = Math.round(geo.cx - 0.5 + cr * Math.cos((a * Math.PI) / 180));
    const py = Math.round(my + cr * Math.sin((a * Math.PI) / 180));
    g.fillRect(px, py, 1, 1);
  }

  // Decor: little starfish, a shell and pebbles.
  for (const [kind, dx, fy] of DECOR) {
    const dy = Math.round(G + 10 + (yB - G - 24) * fy);
    if (kind === 'dot') { g.fillStyle = col.pebble; g.fillRect(dx, dy, 1, 1); continue; }
    if (kind === 'shell') {
      g.fillStyle = col.pebble;
      g.fillRect(dx, dy, 3, 1);
      g.fillRect(dx + 1, dy - 1, 1, 1);
      continue;
    }
    g.fillStyle = kind === 'star-pink' ? col.pink : col.blue;
    g.fillRect(dx - 1, dy, 3, 1);
    g.fillRect(dx, dy - 1, 1, 3);
  }

  // The buoys at the inlet's corners: coral with a white band and the edge all round.
  for (const bx of [geo.mx0, geo.mx1]) {
    const x0 = Math.round(bx) - 3;
    const y0 = G - 3;
    for (let r = 0; r < 7; r++) {
      for (let q = 0; q < 7; q++) {
        const d = Math.hypot(q - 3, r - 3);
        if (d > 3.5) continue;
        g.fillStyle = d > 2.5 ? col.buoyEdge : r === 3 ? col.buoyBand : col.buoy;
        g.fillRect(x0 + q, y0 + r, 1, 1);
      }
    }
  }
  // The sandcastles either side of the player's goal: a tower with crenels and a pink flag.
  for (const bx of [geo.mx0, geo.mx1]) {
    const x0 = Math.round(bx) - 3;
    const top = yB - 6;
    g.fillStyle = col.castle;
    g.fillRect(x0, top + 1, 7, yB + S.SIM.band - top - 1);
    g.fillRect(x0, top, 2, 1);
    g.fillRect(x0 + 5, top, 2, 1);
    g.fillRect(x0 + 3, top, 1, 1);
    g.fillStyle = col.castleHi;
    g.fillRect(x0 + 1, top + 2, 5, 1);
    g.fillStyle = col.pole;
    g.fillRect(x0 + 3, top - 4, 1, 4);
    g.fillStyle = col.flag;
    g.fillRect(x0 + 4, top - 4, 2, 1);
    g.fillRect(x0 + 4, top - 3, 1, 1);
  }
  return c;
}

/* ---------- drawing ---------- */

function drawShadow(ctx, mask, x, y, colour) {
  ctx.fillStyle = colour;
  for (let r = 0; r < mask.length; r++) {
    const row = mask[r];
    for (let c = 0; c < row.length; c++) if (row[c] !== '.') ctx.fillRect(x + c + 1, y + r + 2, 1, 1);
  }
}

function layout(s) {
  geo = S.geometry(s.W, s.H, s.safe);
  // Thumb travel (PLAN §6a, §6i): a drag across INPUT.thumbTravel of the screen width carries the ring from
  // one side of its travel to the other; the same gain up and down.
  sensitivity = thumbSensitivity(geo.ring.x1 - geo.ring.x0, canvas.width / s.scale);
  if (!game) {
    game = S.create(geo, rnd() * 0x7fffffff); // a fresh table on every opening
    bot = B.createBot();
    target.x = game.ring.x;
    target.y = game.ring.y;
  } else {
    S.setGeometry(game, geo);
    target.x = game.ring.x;
    target.y = game.ring.y;
  }
}

function draw(ctx, s) {
  const key = `${s.W}x${s.H}@${s.scale}:${s.safe.top},${s.safe.right},${s.safe.bottom},${s.safe.left}`;
  if (key !== layoutKey || !game) {
    layout(s);
    layoutKey = key;
    bg = null;
  }
  const k = sceneStep(phaseOf(clock.active));
  const bk = `${key}:${k}:${tokens().name}`;
  if (!bg || bk !== bgKey) {
    bg = paintBackground(s, k);
    bgKey = bk;
    canvas.dataset.scene = String(k);
  }
  ctx.drawImage(bg, 0, 0);
  const col = S.tableColours(TK, k / SESSION.sceneSteps);
  const at = (p, mask) => [Math.round(p.x) - (mask[0].length >> 1), Math.round(p.y) - (mask.length >> 1)];

  const [cx, cy] = at(game.crab, CRAB_MASK);
  const [rx, ry] = at(game.ring, RING_MASK);
  const showPuck = game.phase !== 'goal' || game.goal.t < CONFIG.puckOutS;
  const [px, py] = at(game.puck, PUCK_MASK);
  drawShadow(ctx, CRAB_MASK, cx, cy, col.shadow);
  drawShadow(ctx, RING_MASK, rx, ry, col.shadow);
  if (showPuck) drawShadow(ctx, PUCK_MASK, px, py, col.shadow);
  ctx.drawImage(SPR.crab, cx, cy);
  ctx.drawImage(SPR.ring, rx, ry);
  if (showPuck) ctx.drawImage(SPR.puck, px, py);

  if (goalFx) drawGoalFx(ctx, col);
  // No pause marker: a paused frame is the table and the pieces only (PLAN §6i, §2).
}

// The soft pulse (a foam ring opening from the mouth) and the small wave over the goal mouth.
function drawGoalFx(ctx, col) {
  const top = goalFx.by === 'player';
  const mx0 = Math.round(geo.mx0);
  const mx1 = Math.round(geo.mx1);
  const yLine = top ? geo.G : geo.yB;
  const t = goalFx.t;
  ctx.fillStyle = col.foam;
  if (!reducedMotion() && t < CONFIG.pulseS) {
    const r = 3 + (t / CONFIG.pulseS) * 12;
    for (let a = 0; a < 360; a += 12) {
      const x = Math.round(geo.cx + r * Math.cos((a * Math.PI) / 180));
      const y = Math.round(yLine + (top ? 1 : -1) * Math.abs(r * Math.sin((a * Math.PI) / 180)));
      if (((a / 12) & 1) === 0) ctx.fillRect(x, y, 1, 1);
    }
  }
  if (t < CONFIG.waveS) {
    const shift = reducedMotion() ? 0 : Math.floor((t / CONFIG.waveS) * 12);
    const y0 = top ? yLine - 4 : yLine - 3;
    const crest = ['..##......', '.#..#.....', '#....#....'];
    for (let r = 0; r < 3; r++) {
      for (let x = mx0 + 1; x < mx1; x++) {
        if (crest[r][(x - mx0 + shift) % 10] === '#') ctx.fillRect(x, y0 + r, 1, 1);
      }
    }
  }
}

/* ---------- haptics: always on, at most one call per 40 ms; the goal tick always goes out ---------- */

let lastBuzz = -Infinity;
let mustTimer = 0;

function buzz(ms, must = false) {
  if (!canVibrate()) return false;
  const now = performance.now();
  const wait = MIN_GAP_MS - (now - lastBuzz);
  if (wait > 0) {
    if (must && !mustTimer) mustTimer = setTimeout(() => { mustTimer = 0; buzz(ms, true); }, Math.ceil(wait) + 1);
    return false;
  }
  lastBuzz = now;
  return send(ms); // shared/haptics.js: the native plugin in the app, the web vibrate call otherwise
}

/** The tick for a hit at a speed (px/s along the contact normal): 8 to 14 ms. */
export function hitMs(speed) {
  const f = Math.max(0, Math.min(1, (speed - CONFIG.hitSoft) / (CONFIG.hitHard - CONFIG.hitSoft)));
  return Math.round(CONFIG.hapticHitMinMs + f * (CONFIG.hapticHitMaxMs - CONFIG.hapticHitMinMs));
}

function handle(events) {
  // One tick per step at most: a goal first, then the hardest hit, then a wall.
  let goal = null;
  let hit = null;
  let wall = false;
  for (const e of events) {
    if (e.type === 'goal') {
      goal = e;
      B.onGoal(bot, e.by); // the silent rubber band
      goalFx = { by: e.by, t: 0 };
    } else if (e.type === 'hit') {
      if (!hit || e.speed > hit.speed) hit = e;
      if (e.by === 'crab') B.onHit(bot);
    } else if (e.type === 'wall' && e.speed >= CONFIG.wallTickMinSpeed) {
      wall = true;
    }
  }
  if (goal) buzz(CONFIG.hapticGoalMs, true);
  else if (hit) buzz(hitMs(hit.speed));
  else if (wall) buzz(CONFIG.hapticWallMs);
}

/* ---------- loop: runs only while playing or resuming ---------- */

function frame(now) {
  raf = 0;
  if (document.hidden || !game) return;
  if (mode === 'resuming' && now >= resumeAt) {
    mode = 'running';
    last = now;
    acc = 0;
    if (clockWasReset()) B.reset(bot); // the clock started again: so does the crab's rubber band
  }
  if (mode === 'running') {
    acc += Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    while (acc >= S.DT) {
      acc -= S.DT;
      addPlay(clock, S.DT); // only running steps advance the session clock
      const ease = slowdownOf(clock.active);
      const crab = B.think(bot, game, S.DT, ease, rnd, S.SIM.puckR + S.SIM.malletR);
      handle(S.step(game, { ring: target, crab }, ease));
      if (game.ring.yield > 0) { target.x = game.ring.x; target.y = game.ring.y; } // the ring gave way
      if (goalFx && (goalFx.t += S.DT) >= Math.max(CONFIG.pulseS, CONFIG.waveS)) goalFx = null;
    }
  }
  screen.render();
  if (mode !== 'paused') raf = requestAnimationFrame(frame);
}

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

/* ---------- input: relative drag anywhere but the side edges, both ways ---------- */

const screen = createScreen(canvas, draw);

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!game || atSideEdge(e)) return; // an edge swipe is the back gesture: it moves nothing
  const p = screen.toLogical(e.clientX, e.clientY);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
  pointers.set(e.pointerId, p);
  if (driver === null) driver = e.pointerId;
  if (mode === 'paused') {
    mode = 'resuming';
    resumeAt = performance.now() + CONFIG.resumeDelayMs;
    redraw();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = screen.toLogical(e.clientX, e.clientY);
  const q = pointers.get(e.pointerId);
  pointers.set(e.pointerId, p);
  if (e.pointerId !== driver || !geo) return;
  // The ring is never under the thumb: the drag moves it by the finger's movement, on the shared gain.
  target.x = Math.max(geo.ring.x0, Math.min(geo.ring.x1, target.x + (p.x - q.x) * sensitivity));
  target.y = Math.max(geo.ring.y0, Math.min(geo.ring.y1, target.y + (p.y - q.y) * sensitivity));
});

function lift(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (e.pointerId === driver) driver = pointers.size ? pointers.keys().next().value : null;
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

// The phone switched between light and dark: only the colours change.
onThemeChange(() => {
  retheme();
  bg = null;
  redraw();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sleep();
  else redraw();
});
addEventListener('pagehide', sleep);
addEventListener('pageshow', () => { mode = 'paused'; redraw(); });

// Hook for tests/check.py; the game never reads it. snapshot() is a copy; live() is the state itself.
Object.defineProperty(window, '__glide', {
  value: Object.freeze({
    live: () => game,
    target: () => target,
    snapshot: () => ({
      mode,
      raf: !!raf,
      fingers: pointers.size,
      sensitivity,
      view: { W: screen.W, H: screen.H, scale: screen.scale, ox: screen.ox, oy: screen.oy },
      safe: { ...screen.safe },
      clock: { ...clock },
      step: Number(canvas.dataset.scene || 0),
      level: bot ? bot.level : 0,
      target: { ...target },
      goalFx: goalFx ? { ...goalFx } : null,
      game: game ? JSON.parse(JSON.stringify({ ...game, geo: undefined })) : null,
      geo: geo ? JSON.parse(JSON.stringify(geo)) : null,
    }),
  }),
});
