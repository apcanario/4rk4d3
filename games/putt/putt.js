// Putt (PLAN §6c): drawing, the thumb, haptics, the level queue. The
// simulation lives in sim.js and the level generator, with its solver, in
// gen.js (no DOM in either); gen.js also runs as a module Web Worker, so the
// next level is built while this one is played.
//
// Hard rules (PLAN §2): no text, number, button or HUD; no back control (the
// Android back gesture goes home); touches that begin within 24 CSS px of the
// left or right edge are ignored; nothing is written to storage, ever;
// opening Putt always starts a fresh level; no sound.

// Play values: one block (PLAN §6c Files). tests/putt-sim.mjs reads it from
// here. The generator's values sit in GEN at the top of gen.js; the ramp
// lengths are shared: SESSION in shared/session.js.
export const CONFIG = Object.freeze({
  launchSpeed: 220, // top launch speed, logical px per second
  decel: 55, // constant deceleration, px per second squared, as on a snooker cloth
  stopSpeed: 4, // the ball stops below this, px per second
  bounce: 0.85, // walls, blocks and pegs return this much of the speed
  sandFactor: 3, // deceleration is tripled in a sand trap
  captureSpeed: 140, // the ball drops if its centre is within the hole radius under this speed
  pullCapPx: 48, // power is the pull length, capped here (logical px)
  cancelPx: 4, // a pull this short or shorter is released as no shot
  hapticReleaseMs: 10,
  hapticBounceMs: 6,
  hapticSinkMs: 24,
  bounceTickMinSpeed: 8, // a bounce ticks only if the ball meets the wall at least this fast (px/s, normal to it)
  guideAfterPx: 12, // the aim guide shows this much of the first rebound
  guideDotPx: 5, // one guide dot every this many px
  dropMs: 240, // the ball's drop into the hole
  nextLevelMs: 800, // the next level starts to slide in this long after the ball drops
  slideMs: 420, // the slide
  splashMs: 300, // the plop in water
  idleS: 10, // the session clock counts play while the ball rolls, the thumb is down, or this long after either
  easyLeadS: 120, // from this long before dusk, a level-1 course is kept ready
});

import {
  LOGICAL_WIDTH, COLORS, BRICK_ROWS, mix, shade, highlight, line, trapOn, scenePalette, tokens, onThemeChange,
} from '../../shared/tokens.js';
import { createScreen, initPage, atSideEdge, pixelBody, ditherRow, reducedMotion, MIN_HEIGHT } from '../../shared/pixel.js';
import { MIN_GAP_MS, canVibrate, send } from '../../shared/haptics.js';
import { sessionClock, addPlay, phaseOf, sceneStep, SESSION } from '../../shared/session.js';
import * as S from './sim.js';
import * as G from './gen.js';

initPage();

const PLAY = Object.freeze({
  launchSpeed: CONFIG.launchSpeed, decel: CONFIG.decel, stopSpeed: CONFIG.stopSpeed, bounce: CONFIG.bounce,
  sandFactor: CONFIG.sandFactor, captureSpeed: CONFIG.captureSpeed,
});

/* ---------- colours (tokens only) ---------- */

// From the active token set; retheme() makes them again when the phone
// switches between light and dark (row D1).
let WALL, BLOCKS, PEG, HOLE, HOLE_RIM, FLAG, POLE, BALL;
function retheme() {
  WALL = COLORS.coral;
  BLOCKS = [BRICK_ROWS[2], BRICK_ROWS[4]]; // salmon and pink
  PEG = BRICK_ROWS[5];
  HOLE = COLORS.keel; // the deep plum
  HOLE_RIM = mix(COLORS.keel, COLORS.white, 0.35);
  FLAG = COLORS.coral;
  POLE = line(COLORS.coral); // the edge colour in light, a lighter line in dark (row D1)
  BALL = COLORS.blue;
}
retheme();
const DROP_AMOUNT = 0.2; // the drop shade a solid casts on the floor below it

function palette(step) {
  const t = step / SESSION.sceneSteps;
  const pal = scenePalette(t);
  const sand = pal.sky[0]; // the sky-top token (cream) at this step
  const trap = trapOn(sand); // the sand mixed toward brick row 4's peach (shared/tokens.js TRAP_AMOUNT, dark TRAP_AMOUNT_DARK)
  const water = pal.sea[1];
  return {
    sea: pal.sea,
    sand,
    trap,
    trapDot: mix(trap, COLORS.shadeTarget, 0.15),
    water,
    glint: mix(COLORS.sun, water, 0.15),
    seaGlint: mix(COLORS.sun, pal.sea[0], 0.15),
    guide: BALL,
    guideAfter: mix(BALL, sand, 0.45),
    powerOn: COLORS.coral,
    powerOff: mix(COLORS.coral, sand, 0.6),
  };
}

/* ---------- the course, rasterised once per level ---------- */

// Pixel classes.
const C_NONE = 0;
const C_SAND = 1;
const C_WALL = 2;
const C_BLOCK0 = 3;
const C_BLOCK1 = 4;
const C_PEG = 5;
const C_TRAP = 6;
const C_WATER = 7;
const SOLID = (c) => c >= C_WALL && c <= C_PEG;

/**
 * Classify every logical pixel of the screen by its centre, with the same
 * geometry the physics uses: the wall is the band WALL_T wide outside the
 * course polygon; bars, blocks and traps are their rectangles, diagonals the
 * pixels within DIAG_HALF of their line (a stair-step), pegs within PEG_R.
 */
function rasterise(level, W, H) {
  const cls = new Uint8Array(W * H);
  const obj = new Int16Array(W * H); // which solid a pixel belongs to (walls are all 1)
  const planes = S.halfPlanes(level.poly);
  const cornerCut = (x, y, b) => (x === b.x || x === b.x + b.w - 1) && (y === b.y || y === b.y + b.h - 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = S.insideDist(planes, px, py);
      let c = d >= 0 ? C_SAND : d >= -S.WALL_T ? C_WALL : C_NONE;
      let o = c === C_WALL ? 1 : 0;
      if (c === C_SAND) {
        for (const b of level.bars) if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { c = C_WALL; o = 1; }
        for (const g of level.diags) if (S.pointSegDist(px, py, g.ax, g.ay, g.bx, g.by) <= S.DIAG_HALF) { c = C_WALL; o = 1; }
        level.blocks.forEach((b, i) => {
          if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h && !cornerCut(x, y, b)) { c = b.c ? C_BLOCK1 : C_BLOCK0; o = 10 + i; }
        });
        level.pegs.forEach((g, i) => {
          if (Math.hypot(px - g.x, py - g.y) <= S.PEG_R) { c = C_PEG; o = 100 + i; }
        });
        for (const t of level.traps) if (px >= t.x && px <= t.x + t.w && py >= t.y && py <= t.y + t.h && !cornerCut(x, y, t)) c = C_TRAP;
        for (const t of level.water) if (px >= t.x && px <= t.x + t.w && py >= t.y && py <= t.y + t.h && !cornerCut(x, y, t)) c = C_WATER;
      }
      cls[y * W + x] = c;
      obj[y * W + x] = o;
    }
  }
  return { cls, obj, W, H };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The course layer (transparent outside the wall) at a scene step. */
function paintCourse(level, ras, step) {
  const { cls, obj, W, H } = ras;
  const p = palette(step);
  const solidColour = { [C_WALL]: WALL, [C_BLOCK0]: BLOCKS[0], [C_BLOCK1]: BLOCKS[1], [C_PEG]: PEG };
  const floorColour = { [C_SAND]: p.sand, [C_TRAP]: p.trap, [C_WATER]: p.water };
  const memo = new Map();
  const rgb = (hex) => {
    let v = memo.get(hex);
    if (!v) memo.set(hex, (v = hexRgb(hex)));
    return v;
  };
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const data = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = cls[i];
      if (k === C_NONE) continue;
      let hex;
      const above = y > 0 ? i - W : -1;
      if (SOLID(k)) {
        const base = solidColour[k];
        const topEdge = above < 0 || obj[above] !== obj[i];
        const below = y < H - 1 ? i + W : -1;
        const bottomEdge = below < 0 || obj[below] !== obj[i];
        if (topEdge) hex = highlight(base);
        else if (bottomEdge && k !== C_WALL) hex = shade(base);
        else hex = base;
      } else {
        hex = floorColour[k];
        if (k === C_TRAP && (x * 7 + y * 13) % 23 === 0) hex = p.trapDot;
        if (above >= 0 && SOLID(cls[above])) hex = mix(hex, COLORS.shadeTarget, DROP_AMOUNT);
      }
      const [r, gg, b] = rgb(hex);
      data[i * 4] = r;
      data[i * 4 + 1] = gg;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Water: a glint dash or two.
  g.fillStyle = p.glint;
  for (const t of level.water) {
    g.fillRect(t.x + 3, t.y + 3, Math.max(3, Math.floor(t.w / 3)), 1);
    g.fillRect(t.x + Math.floor(t.w / 2), t.y + t.h - 4, Math.max(2, Math.floor(t.w / 4)), 1);
  }
  drawHole(g, level.hole, level);
  return c;
}

function drawHole(g, h, level) {
  for (let y = Math.floor(h.y - h.r); y < h.y + h.r; y++) {
    for (let x = Math.floor(h.x - h.r); x < h.x + h.r; x++) {
      const d = Math.hypot(x + 0.5 - h.x, y + 0.5 - h.y);
      if (d > h.r) continue;
      g.fillStyle = d > h.r - 1 ? HOLE_RIM : HOLE;
      g.fillRect(x, y, 1, 1);
    }
  }
  // The flag: a pole and a small coral pennant beside the hole.
  const right = h.x + h.r + 6 <= level.x1;
  const px = right ? h.x + h.r : h.x - h.r - 1;
  const top = h.y - 9;
  g.fillStyle = POLE;
  g.fillRect(px, top, 1, 9);
  g.fillStyle = FLAG;
  const rows = [4, 3, 1];
  rows.forEach((w, r) => g.fillRect(right ? px + 1 : px - w, top + r, w, 1));
}

/** The sea around the course: three bands down the screen, dither seams, pale glint dashes. */
function paintSea(W, H, step) {
  const p = palette(step);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { alpha: false });
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const y1 = Math.round(((i + 1) * H) / 3);
    g.fillStyle = p.sea[i];
    g.fillRect(0, y, W, y1 - y);
    if (i > 0) ditherRow(g, 0, y, W, p.sea[i], p.sea[i - 1], i);
    y = y1;
  }
  g.fillStyle = p.seaGlint;
  for (const [x, f, len] of [[1, 0.2, 3], [1, 0.51, 3], [131, 0.34, 3], [131, 0.68, 3], [2, 0.84, 2]]) g.fillRect(x, Math.round(H * f), len, 1);
  for (const [x, dy, len] of [[14, 17, 6], [40, 8, 5], [78, 14, 7], [104, 5, 5], [120, 19, 4], [60, 3, 4]]) g.fillRect(x, H - dy, len, 1);
  return c;
}

/* ---------- state ---------- */

const canvas = document.getElementById('screen');
let screenGeo = null; // { W, H, top, bottom } the current levels are built for
let level = null;
let world = null;
let ras = null;
let ball = null;
let levelNo = 0;
let courseCache = { key: '', canvas: null };
let seaCache = { key: '', canvas: null };
let aim = null; // { id, x0, y0, x, y } logical px
let sinkAt = 0; // performance.now() of the drop, or 0
let slide = null; // { t0, from: { level, ras }, to: { level, ras } }
let splash = null; // { x, y, t0 }
let raf = 0;
let last = 0;
let acc = 0;
let lastBuzz = -Infinity;

/* ---------- the session clock: shared, in memory, never written to storage ---------- */

const clock = sessionClock(); // the one shared clock (shared/session.js): the hub's, or this page's own
let engagedUntil = 0; // performance.now() until which play counts as active
let lastAccrue = performance.now();
let stepTimer = 0;

function accrue(now) {
  const end = Math.min(now, engagedUntil);
  if (end > lastAccrue) addPlay(clock, (end - lastAccrue) / 1000);
  lastAccrue = now;
}

/** Something happened (a touch, a rolling ball): play is active for idleS more. */
function engage(now) {
  accrue(now);
  engagedUntil = Math.max(engagedUntil, now + CONFIG.idleS * 1000);
  if (!stepTimer) stepTimer = setTimeout(stepCheck, 2000);
}

function stepCheck() {
  stepTimer = 0;
  if (document.hidden) return;
  const now = performance.now();
  const before = currentStep();
  accrue(now);
  if (currentStep() !== before) redraw();
  if (now < engagedUntil) stepTimer = setTimeout(stepCheck, 2000);
  if (clock.active >= SESSION.rampMin * 60 - CONFIG.easyLeadS) want('easy');
}

function currentStep() {
  return sceneStep(phaseOf(clock.active));
}

const dusk = () => clock.active >= SESSION.rampMin * 60;

/* ---------- haptics: Putt vibrates whenever the device can (native in the app, navigator.vibrate on the web) ---------- */

// The sink tick always goes out. stepTicks (sim.js) already drops a bounce
// tick when the ball drops within SINK_LOOK_STEPS steps after it: the 40 ms
// gap plus 25 ms for the time between a step and the frame that handles it.
// If a frame stall still leaves the sink inside the gap, it is sent the moment
// the gap ends (must), so the 40 ms limit holds between every two ticks.
const SINK_LOOK_STEPS = Math.ceil(((MIN_GAP_MS + 25) / 1000) * S.STEP_HZ);
let mustTimer = 0;

function buzz(ms, must = false) {
  if (!canVibrate()) return false;
  const now = performance.now();
  const wait = MIN_GAP_MS - (now - lastBuzz);
  if (wait > 0) { // at most one call per 40 ms (shared limit)
    if (must && !mustTimer) mustTimer = setTimeout(() => { mustTimer = 0; buzz(ms, true); }, Math.ceil(wait) + 1);
    return false;
  }
  lastBuzz = now;
  return send(ms); // the app's native plugin, or navigator.vibrate (shared/haptics.js)
}

/* ---------- the level queue: built in the background ---------- */

const ready = { random: null, easy: null };
const pending = { random: 0, easy: 0 }; // request id, or 0
let worker = null;
let mode = 'worker';
let nextId = 1;
const jobs = new Map(); // id -> { kind, msg }

function newSeed() {
  return ((Math.random() * 0x100000000) >>> 0) || 1;
}

function startWorker() {
  try {
    worker = new Worker(new URL('./gen.js', import.meta.url), { type: 'module' });
  } catch (err) {
    worker = null;
  }
  if (!worker) {
    mode = 'slices';
    return;
  }
  worker.onmessage = (e) => done(e.data.id, e.data.level);
  worker.onerror = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    // No module workers here: build the waiting levels in small slices instead.
    try { worker.terminate(); } catch (err) { /* already gone */ }
    worker = null;
    mode = 'slices';
    for (const [id, job] of jobs) slices(id, job.msg);
  };
}

function want(kind) {
  if (ready[kind] || pending[kind] || !screenGeo) return;
  request(kind, kind === 'easy' ? 1 : G.pickDifficulty(Math.random, dusk()), screenGeo);
}

function request(kind, diff, geo) {
  const id = nextId++;
  const msg = { id, seed: newSeed(), diff, H: geo.H, top: geo.top, bottom: geo.bottom, play: PLAY };
  pending[kind] = id;
  jobs.set(id, { kind, msg });
  if (mode === 'worker' && worker) worker.postMessage(msg);
  else slices(id, msg);
}

/** Build a level on this thread a few milliseconds at a time, so play never stalls. */
function slices(id, m) {
  const it = G.generateSteps(m.seed, m.diff, m.H, m.play, m.top, m.bottom);
  const run = () => {
    if (!jobs.has(id)) return;
    const t0 = performance.now();
    for (;;) {
      const r = it.next();
      if (r.done) {
        done(id, r.value);
        return;
      }
      if (performance.now() - t0 > 6) break;
    }
    setTimeout(run, 0);
  };
  setTimeout(run, 0);
}

function done(id, lv) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  if (pending[job.kind] !== id) return;
  pending[job.kind] = 0;
  if (!screenGeo) { // back before the first frame: the first frame checks its size
    ready[job.kind] = lv;
    return;
  }
  if (lv.H !== screenGeo.H || lv.top !== screenGeo.top || lv.bottom !== screenGeo.bottom) {
    want(job.kind); // built for another screen size
    return;
  }
  ready[job.kind] = lv;
  if (!level) {
    install(take());
    opening.landedMs = performance.now() - opening.t0;
  }
}

/** The next course: from the dusk phase on, level 1 only. Never waits. */
function take() {
  let lv = null;
  if (dusk()) {
    if (ready.easy) { lv = ready.easy; ready.easy = null; }
    else if (ready.random && ready.random.diff === 1) { lv = ready.random; ready.random = null; }
    else lv = G.fallbackLevel(screenGeo.H, screenGeo.top, screenGeo.bottom, newSeed());
  } else if (ready.random) {
    lv = ready.random;
    ready.random = null;
  } else {
    lv = G.fallbackLevel(screenGeo.H, screenGeo.top, screenGeo.bottom, newSeed());
  }
  return lv;
}

function install(lv) {
  level = lv;
  world = S.buildWorld(lv);
  ras = rasterise(lv, screenGeo.W, screenGeo.H);
  ball = S.newBall(lv.tee.x, lv.tee.y);
  levelNo++;
  sinkAt = 0;
  aim = null;
  want('random');
  if (clock.active >= SESSION.rampMin * 60 - CONFIG.easyLeadS) want('easy');
  redraw();
}

/* ---------- drawing ---------- */

function seaFor(W, H, step) {
  const key = `${W}x${H}:${step}:${tokens().name}`;
  if (seaCache.key !== key) seaCache = { key, canvas: paintSea(W, H, step) };
  return seaCache.canvas;
}

function courseFor(lv, r, step, no) {
  const key = `${no}:${step}:${tokens().name}`;
  if (courseCache.key !== key) courseCache = { key, canvas: paintCourse(lv, r, step) };
  return courseCache.canvas;
}

function drawBall(ctx, x, y) {
  pixelBody(ctx, Math.round(x - S.BALL_R), Math.round(y - S.BALL_R), 5, 5, BALL, 1);
}

function drawDrop(ctx, now) {
  const u = (now - sinkAt) / CONFIG.dropMs;
  if (u >= 1) return;
  const h = level.hole;
  const size = u < 0.34 ? 5 : u < 0.67 ? 3 : 1;
  ctx.fillStyle = BALL;
  const o = Math.floor(size / 2);
  ctx.fillRect(Math.round(h.x - 0.5) - o, Math.round(h.y - 0.5) - o, size, size);
}

function drawGuide(ctx, p) {
  const shot = S.pullShot(aim.x0, aim.y0, aim.x, aim.y, CONFIG);
  if (!shot) return;
  const path = S.aimPath(world, ball.x, ball.y, shot.dx, shot.dy, CONFIG.guideAfterPx);
  for (let i = CONFIG.guideDotPx - 1; i < path.pts.length; i += CONFIG.guideDotPx) {
    const [x, y] = path.pts[i];
    if (Math.hypot(x - ball.x, y - ball.y) < S.BALL_R + 3) continue;
    ctx.fillStyle = i < path.leg ? p.guide : p.guideAfter;
    ctx.fillRect(Math.round(x - 1), Math.round(y - 1), 2, 2);
  }
  // Power: five short bars by the ball, lit from the bottom.
  const lit = Math.ceil(shot.power * 5 - 1e-9);
  const bx0 = Math.round(ball.x - S.BALL_R) - 7;
  const bx = bx0 - 1 < level.x0 ? Math.round(ball.x + S.BALL_R) + 3 : bx0;
  const by = Math.round(ball.y + S.BALL_R);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < lit ? p.powerOn : p.powerOff;
    ctx.fillRect(bx, by - 2 - i * 3, 4, 2);
  }
}

function ring(ctx, x, y, r, fill, outline) {
  const disc = (rr, color) => {
    ctx.fillStyle = color;
    for (let dy = -rr; dy <= rr; dy++) {
      const half = Math.floor(Math.sqrt((rr + 0.5) * (rr + 0.5) - dy * dy));
      ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
    }
  };
  if (outline) disc(r + 1, outline);
  disc(r, fill);
  return disc;
}

/** The pull: a small ring where the thumb went down, a ring under the thumb, dots between. */
function drawPull(ctx, step) {
  const pal = palette(step);
  const ax = Math.round(aim.x0);
  const ay = Math.round(aim.y0);
  const tx = Math.round(aim.x);
  const ty = Math.round(aim.y);
  const len = Math.hypot(tx - ax, ty - ay);
  ctx.fillStyle = COLORS.white;
  for (let d = 6; d < len - 7; d += 4) ctx.fillRect(Math.round(ax + ((tx - ax) * d) / len), Math.round(ay + ((ty - ay) * d) / len), 1, 1);
  const inner = (x, y, r, c) => ring(ctx, x, y, r, c, null);
  inner(ax, ay, 3, highlight(pal.sea[0]));
  inner(ax, ay, 2, COLORS.ink);
  inner(ax, ay, 1, highlight(pal.sea[0]));
  ring(ctx, tx, ty, 6, COLORS.white, COLORS.ink);
  inner(tx, ty, 5, COLORS.ink);
  inner(tx, ty, 4, pal.sea[1]);
}

function drawSplash(ctx, now) {
  const u = (now - splash.t0) / CONFIG.splashMs;
  if (u >= 1) { splash = null; return; }
  const x = Math.round(splash.x);
  const y = Math.round(splash.y);
  ctx.fillStyle = COLORS.white;
  const r = u < 0.5 ? 2 : 3;
  ctx.fillRect(x - r, y, 1, 1);
  ctx.fillRect(x + r, y, 1, 1);
  ctx.fillRect(x, y - r, 1, 1);
}

function draw(ctx, s) {
  const geo = { W: s.W, H: s.H, top: s.safe.top, bottom: s.safe.bottom };
  if (!screenGeo || geo.H !== screenGeo.H || geo.top !== screenGeo.top || geo.bottom !== screenGeo.bottom) resize(geo);
  const now = performance.now();
  const step = currentStep();
  canvas.dataset.scene = String(step);
  ctx.drawImage(seaFor(s.W, s.H, step), 0, 0);
  if (!level) return;
  if (slide) {
    const u = Math.min(1, (now - slide.t0) / CONFIG.slideMs);
    const off = Math.round(u * s.H);
    ctx.drawImage(courseFor(slide.from.level, slide.from.ras, step, slide.from.no), 0, off);
    if (slide.to.step !== step || slide.to.theme !== tokens().name) {
      slide.to = { ...slide.to, step, theme: tokens().name, canvas: paintCourse(slide.to.level, slide.to.ras, step) };
    }
    ctx.drawImage(slide.to.canvas, 0, off - s.H);
    return;
  }
  ctx.drawImage(courseFor(level, ras, step, levelNo), 0, 0);
  const p = palette(step);
  if (aim && !ball.moving && !ball.sunk) drawGuide(ctx, p);
  if (!ball.sunk) drawBall(ctx, ball.x, ball.y);
  else if (sinkAt) drawDrop(ctx, now);
  if (splash) drawSplash(ctx, now);
  if (aim) drawPull(ctx, step);
}

const sameGeo = (a, b) => a.H === b.H && a.top === b.top && a.bottom === b.bottom;

/**
 * The first frame. The opening course is drawn with equal odds (level 1 only
 * at dusk) at module load. Levels 1 and 2 are built here, on the page, in
 * about 20 ms, so the first frame already has its course. A level 3 takes
 * about 170 ms (up to 500 ms on a desktop, more on a phone): building it here
 * would hold the first frame that long, and showing an easier course in its
 * place would break the equal odds. So it is asked of the worker at module
 * load, for the screen size measured then, before the canvas is set up; if it
 * is not back by the first frame, that frame and the few after it draw the
 * sea alone until it lands. A screen measured differently from the first frame
 * asks again. Between holes nothing changes: the next course is always ready.
 */
function openFirst(geo) {
  if (opening.diff < 3) {
    install(G.generate(newSeed(), opening.diff, geo.H, PLAY, geo.top, geo.bottom));
    opening.atFirstFrame = true;
    return;
  }
  if (ready.random && !sameGeo(ready.random, geo)) ready.random = null;
  if (ready.random) {
    install(take());
    opening.atFirstFrame = true;
    return;
  }
  const job = jobs.get(pending.random);
  if (job && sameGeo(job.msg, geo)) return; // on its way: the sea until it lands
  if (job) jobs.delete(pending.random);
  request('random', opening.diff, geo);
}

function resize(geo) {
  const first = !screenGeo;
  screenGeo = geo;
  if (first && !level) {
    openFirst(geo);
    return;
  }
  // Levels are built for one screen size: drop the queue and start a fresh course.
  ready.random = null;
  ready.easy = null;
  pending.random = 0;
  pending.easy = 0;
  jobs.clear();
  slide = null;
  if (level) install(G.fallbackLevel(geo.H, geo.top, geo.bottom, newSeed()));
  else want('random');
}

/* ---------- the loop: runs only while something moves ---------- */

function busy(now) {
  return (ball && ball.moving) || !!slide || (sinkAt && now - sinkAt < CONFIG.nextLevelMs + 50) || !!splash;
}

function frame(now) {
  raf = 0;
  if (document.hidden) return;
  if (ball && ball.moving) {
    engage(now);
    acc += Math.min(0.1, Math.max(0, (now - last) / 1000));
    while (acc >= S.DT && ball.moving) {
      acc -= S.DT;
      handle(S.step(world, ball, PLAY), now);
    }
    if (!ball.moving) acc = 0;
  }
  last = now;
  if (sinkAt && !slide && now - sinkAt >= CONFIG.nextLevelMs) {
    const to = take();
    if (reducedMotion()) install(to);
    else {
      slide = { t0: now, from: { level, ras, no: levelNo }, to: { level: to, ras: rasterise(to, screenGeo.W, screenGeo.H), step: -1, canvas: null } };
      sinkAt = 0;
    }
  }
  if (slide && now - slide.t0 >= CONFIG.slideMs) {
    const to = slide.to.level;
    slide = null;
    install(to);
  }
  screen.render();
  if (busy(now)) raf = requestAnimationFrame(frame);
}

function handle(ev, now) {
  const ticks = S.stepTicks(world, ball, ev, PLAY, CONFIG.bounceTickMinSpeed, SINK_LOOK_STEPS);
  if (ticks.bounce) buzz(CONFIG.hapticBounceMs);
  if (ev & S.EV_WATER) splash = { x: lastPos.x, y: lastPos.y, t0: now };
  if (ticks.sink) {
    buzz(CONFIG.hapticSinkMs, true);
    sinkAt = now;
  }
  lastPos.x = ball.x;
  lastPos.y = ball.y;
}
const lastPos = { x: 0, y: 0 };

function redraw() {
  if (!raf && !document.hidden) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

/* ---------- the opening course: drawn and asked for at module load ---------- */

/** The screen size the first frame will have, measured as createScreen (shared/pixel.js) does. */
function predictGeo() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (!w || !h) return null;
  let scale = Math.max(1, Math.floor(w / LOGICAL_WIDTH));
  while (scale > 1 && Math.floor(h / scale) < MIN_HEIGHT) scale--;
  const probe = document.createElement('div');
  probe.className = 'safe-probe';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const conv = (v) => Math.ceil(((parseFloat(v) || 0) * dpr) / scale);
  const geo = { W: LOGICAL_WIDTH, H: Math.max(1, Math.floor(h / scale)), top: conv(cs.paddingTop), bottom: conv(cs.paddingBottom) };
  probe.remove();
  return geo;
}

const opening = { diff: G.pickDifficulty(Math.random, dusk()), t0: performance.now(), atFirstFrame: false, landedMs: null };
startWorker();
if (opening.diff === 3) {
  const geo = predictGeo();
  if (geo) request('random', 3, geo);
}

/* ---------- input: pull back, aim, release ---------- */

const screen = createScreen(canvas, draw);

function nearEdge(e) {
  return atSideEdge(e); // shared: shared/pixel.js INPUT.edgeIgnoreCssPx
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (aim || !level || !ball || ball.moving || ball.sunk || slide || nearEdge(e)) return;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
  const p = screen.toLogical(e.clientX, e.clientY);
  aim = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y };
  engage(performance.now());
  redraw();
});

canvas.addEventListener('pointermove', (e) => {
  if (!aim || e.pointerId !== aim.id) return;
  const p = screen.toLogical(e.clientX, e.clientY);
  aim.x = p.x;
  aim.y = p.y;
  redraw();
});

canvas.addEventListener('pointerup', (e) => {
  e.preventDefault();
  if (!aim || e.pointerId !== aim.id) return;
  const p = screen.toLogical(e.clientX, e.clientY);
  aim.x = p.x;
  aim.y = p.y;
  const shot = S.pullShot(aim.x0, aim.y0, aim.x, aim.y, CONFIG);
  aim = null;
  const now = performance.now();
  engage(now);
  if (shot && ball && !ball.moving && !ball.sunk) {
    S.shoot(ball, shot.dx, shot.dy, shot.speed);
    lastPos.x = ball.x;
    lastPos.y = ball.y;
    buzz(CONFIG.hapticReleaseMs);
    acc = 0;
  }
  redraw();
});

canvas.addEventListener('pointercancel', (e) => {
  if (aim && e.pointerId === aim.id) {
    aim = null;
    redraw();
  }
});

/* ---------- lifecycle ---------- */

// Row D1: the phone switched between light and dark. Only the colours change:
// the caches are keyed by theme, so the next frame paints the same course and ball in the other set.
onThemeChange(() => {
  retheme();
  redraw();
});

document.addEventListener('visibilitychange', () => {
  const now = performance.now();
  if (document.hidden) {
    accrue(now);
    engagedUntil = Math.min(engagedUntil, now); // hidden time never counts
    aim = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else {
    lastAccrue = now;
    redraw();
  }
});
addEventListener('pageshow', () => { aim = null; redraw(); });

// Read-only hook for tests/check.py; the game never reads it.
Object.defineProperty(window, '__putt', {
  value: Object.freeze({
    snapshot: () => ({
      level: level ? JSON.parse(JSON.stringify(level)) : null,
      levelNo,
      ball: ball ? { ...ball } : null,
      aiming: !!aim,
      sliding: !!slide,
      sinking: !!sinkAt,
      raf: !!raf,
      clock: { ...clock },
      step: currentStep(),
      ready: { random: ready.random ? ready.random.diff : null, easy: ready.easy ? ready.easy.diff : null },
      pending: { ...pending },
      mode,
      opening: { diff: opening.diff, atFirstFrame: opening.atFirstFrame, landedMs: opening.landedMs },
      geo: screenGeo ? { ...screenGeo, scale: screen.scale } : null,
    }),
    /** The shot a pull from one client point to another would give (as the game computes it). */
    shotFor: (cx0, cy0, cx1, cy1) => {
      const a = screen.toLogical(cx0, cy0);
      const b = screen.toLogical(cx1, cy1);
      return S.pullShot(a.x, a.y, b.x, b.y, CONFIG);
    },
  }),
});
