// Pool (docs/V2.md §4): beach billiards. Drawing, the thumb, haptics. The
// simulation lives in sim.js (no DOM); this file draws it and feeds it the
// thumb. The look is docs/style-reference-pool.jpg.
//
// Hard rules: no text, number, button or HUD; the Android back gesture goes
// home; touches that begin within 24 CSS px of the left or right edge are
// ignored; nothing is stored; opening Pool always starts a fresh rack;
// haptics are always on; no sound. Pool does not read or advance the session
// clock and has no dusk change: there is no sky on screen.

// Play values: one block. tests/pool-sim.mjs reads it from here.
export const CONFIG = Object.freeze({
  launchSpeed: 300, // full-power speed, logical px per second
  powerCurve: 1.5, // speed = launchSpeed * (pull / pullCapPx) ^ powerCurve
  pullCapPx: 30, // full power at this pull (logical px, 22 percent of the screen width); further only steadies the aim
  cancelPx: 4, // a pull this short or shorter is released as no shot
  decel: 45, // constant deceleration, px per second squared
  stopSpeed: 4, // a ball stops under this, px per second
  ballRestitution: 0.96, // ball on ball, equal mass
  cushionRestitution: 0.8,
  ballR: 4, // the drawn ball is 9 px across: its centre pixel and 4 each side
  subStepPx: 1, // no ball moves more than this in one sub-step
  stuckS: 12, // if anything still moves this long after a shot...
  stuckFactor: 3, // ...deceleration is multiplied by this until all is at rest
  cushionPx: 4, // the cushion band along the four edges of the table
  cornerInsetPx: 5, // a corner pocket's centre, in from the table's corner
  cornerPocketR: 9, // a ball is potted when its centre is this close to a corner pocket's centre
  sidePocketR: 8, // the same for a side pocket, centred on the cushion's inner face at mid height
  rackApexAt: 0.32, // the rack's apex, as a share of the table height
  baulkAt: 0.74, // the baulk line, the same
  dRadius: 20, // the D below the baulk line
  spotBelowPx: 9, // the cue ball's spot, below the baulk line
  rackGapPx: 1, // spare room between balls in a new rack
  cueBackMs: 600, // a potted cue ball rises on its spot after this
  rackMs: 900, // a new rack after the last object ball is potted
  potMs: 240, // a potted ball shrinks into the pool over this
  hapticReleaseMs: 10,
  hapticBallMs: 6,
  hapticCushionMs: 4,
  hapticPotMs: 24,
  hapticRackMs: 30,
  tickMinSpeed: 20, // a ball or cushion tick only above this closing speed (px/s)
  guideDotPx: 7, // one guide dot every this many px
  guideStruckPx: 12, // the struck ball's line, drawn this long
  shadeAmount: 0.2, // a ball's drop shade: the sand mixed this far toward shadeTarget
  specks: 14, // sand specks (drawing only)
  starfish: 5, // faint starfish (drawing only)
});

import { LOGICAL_WIDTH, COLORS, BRICK_ROWS, mix, highlight, line, tokens, onThemeChange } from '../../shared/tokens.js';
import { createScreen, initPage, atSideEdge, reducedMotion } from '../../shared/pixel.js';
import { tick } from '../../shared/haptics.js';
import * as S from './sim.js';

initPage();

const canvas = document.getElementById('screen');
// The object balls are drawn at random per rack from brick rows 0, 2, 4, 5, 6, 7, 8 and blue (null).
const refPool = Object.freeze([0, 2, 4, 5, 6, 7, 8, null]);
const fillOf = (ref) => (ref === null ? COLORS.blue : BRICK_ROWS[ref]);

let world = null;
let table = null;
let layoutKey = '';
let refs = []; // colour references of the object balls, by id
let aim = null; // { id, x0, y0, x, y } in logical px
let pots = []; // balls shrinking into a pocket: { x, y, px, py, t0, ref }
let rises = new Map(); // ball id -> t0 of its rise
let raf = 0;
let last = 0;
let acc = 0;

function drawRefs() {
  refs = [];
  for (let id = 1; id <= 10; id++) refs[id] = refPool[Math.floor(Math.random() * refPool.length)];
}

/* ---------- drawing (colours from the active token set only) ---------- */

// Decor: where the specks and starfish sit, as shares of the table; drawing only.
const decor = (() => {
  let s = (Math.random() * 2 ** 32) >>> 0;
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    specks: Array.from({ length: CONFIG.specks }, () => [rnd(), rnd()]),
    starfish: Array.from({ length: CONFIG.starfish }, (_, i) => [rnd(), rnd(), i % 2 ? 7 : 6]),
  };
})();

function rows(ctx, x, y, r, color, hole) {
  // A disc of radius r (the same rows as a 9 px ball for r 4), or its ring when hole > 0.
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt((r + 0.5) * (r + 0.5) - dy * dy));
    if (hole > 0 && Math.abs(dy) <= r - hole) {
      const inner = Math.floor(Math.sqrt((r - hole + 0.5) * (r - hole + 0.5) - dy * dy));
      ctx.fillRect(x - half, y + dy, half - inner, 1);
      ctx.fillRect(x + inner + 1, y + dy, half - inner, 1);
    } else {
      ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
    }
  }
}

function dot(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
}

function drawBall(ctx, b, fill, rim, set, r = CONFIG.ballR) {
  const x = Math.round(b.x);
  const y = Math.round(b.y);
  if (r < 1) return;
  const shade = mix(set.COLORS.sand, set.COLORS.shadeTarget, CONFIG.shadeAmount);
  rows(ctx, x + 1, y + 1, r, shade, 0);
  rows(ctx, x, y, r, rim, 0);
  if (r > 1) rows(ctx, x, y, r - 1, fill, 0);
  if (r >= 3) {
    ctx.fillStyle = highlight(fill, set);
    ctx.fillRect(x - 2, y - 2, 2, 1);
  }
}

function drawTable(ctx, s, set) {
  const c = set.COLORS;
  ctx.fillStyle = c.sandWall;
  ctx.fillRect(0, 0, s.W, s.H);
  ctx.fillStyle = c.sand;
  ctx.fillRect(table.x0, table.y0, table.x1 - table.x0, table.y1 - table.y0);
  ctx.fillStyle = c.wetSand; // the 1 px lip, innermost of the band
  ctx.fillRect(table.x0 - 1, table.y0 - 1, table.x1 - table.x0 + 2, 1);
  ctx.fillRect(table.x0 - 1, table.y1, table.x1 - table.x0 + 2, 1);
  ctx.fillRect(table.x0 - 1, table.y0 - 1, 1, table.y1 - table.y0 + 2);
  ctx.fillRect(table.x1, table.y0 - 1, 1, table.y1 - table.y0 + 2);
  // decor
  const w = table.x1 - table.x0;
  const h = table.y1 - table.y0;
  ctx.fillStyle = c.wetSand;
  for (const [fx, fy] of decor.specks) ctx.fillRect(Math.round(table.x0 + 4 + fx * (w - 8)), Math.round(table.y0 + 4 + fy * (h - 8)), 2, 1);
  for (const [fx, fy, row] of decor.starfish) {
    ctx.fillStyle = mix(c.sand, set.BRICK_ROWS[row], set.decorAmount);
    const x = Math.round(table.x0 + 8 + fx * (w - 16));
    const y = Math.round(table.y0 + 8 + fy * (h - 16));
    ctx.fillRect(x - 2, y, 5, 1);
    ctx.fillRect(x, y - 2, 1, 5);
  }
  // baulk line (dashed) and its D, opening downward
  ctx.fillStyle = c.courtLine;
  const by = Math.round(table.baulkY);
  for (let x = table.x0; x < table.x1; x += 9) ctx.fillRect(x, by, Math.min(5, table.x1 - x), 1);
  const cx = table.cx;
  for (let a = 0; a <= Math.PI; a += 0.02) ctx.fillRect(Math.round(cx + Math.cos(a) * CONFIG.dRadius), Math.round(table.baulkY + Math.sin(a) * CONFIG.dRadius), 1, 1);
  // pockets: tide pools
  for (const p of table.pockets) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    rows(ctx, x, y, p.r, c.poolRing, 0);
    rows(ctx, x, y, p.r - 1, set.SEA_BANDS[1], 0);
    rows(ctx, x, y, p.r - 3, set.name === 'dark' ? c.deep : set.SEA_BANDS[2], 0);
  }
}

function drawGuide(ctx, set) {
  const shot = S.pullShot(aim.x0, aim.y0, aim.x, aim.y, CONFIG);
  const cue = world.balls[0];
  if (!shot || cue.potted) return;
  const path = S.aimPath(world, shot.dx, shot.dy);
  if (!path) return;
  const ux = shot.dx / shot.len;
  const uy = shot.dy / shot.len;
  const ink = set.COLORS.ink;
  for (let d = CONFIG.ballR + 4; d < path.t - CONFIG.ballR - 1; d += CONFIG.guideDotPx) dot(ctx, cue.x + ux * d, cue.y + uy * d, ink);
  rows(ctx, Math.round(path.x), Math.round(path.y), CONFIG.ballR, ink, 1);
  if (path.ball !== null) {
    const b = world.balls[path.ball];
    for (let d = 3; d <= CONFIG.guideStruckPx; d += CONFIG.guideDotPx) dot(ctx, b.x + path.nx * (CONFIG.ballR + d), b.y + path.ny * (CONFIG.ballR + d), ink);
  }
}

/** The pull: a small ring where the thumb went down, a ring under the thumb, dots between (from Putt, v1). */
function drawPull(ctx, set) {
  const ax = Math.round(aim.x0);
  const ay = Math.round(aim.y0);
  const tx = Math.round(aim.x);
  const ty = Math.round(aim.y);
  const len = Math.hypot(tx - ax, ty - ay);
  const coral = set.COLORS.coral;
  for (let d = 6; d < len - 7; d += 4) {
    ctx.fillStyle = coral;
    ctx.fillRect(Math.round(ax + ((tx - ax) * d) / len), Math.round(ay + ((ty - ay) * d) / len), 1, 1);
  }
  rows(ctx, ax, ay, 3, coral, 1);
  rows(ctx, tx, ty, 6, coral, 2);
}

function draw(ctx, s) {
  ensure(s);
  const set = tokens();
  drawTable(ctx, s, set);
  const now = performance.now();
  for (const b of world.balls) {
    if (b.potted) continue;
    const isCue = b.id === 0;
    const fill = isCue ? set.COLORS.foam : fillOf(refs[b.id]);
    const rim = line(isCue ? set.COLORS.coral : fill, set);
    let r = CONFIG.ballR;
    const t0 = rises.get(b.id);
    if (t0 !== undefined) {
      const u = (now - t0) / CONFIG.potMs;
      if (u >= 1) rises.delete(b.id);
      else r = Math.max(1, Math.round(CONFIG.ballR * u));
    }
    drawBall(ctx, b, fill, rim, set, r);
  }
  for (const p of pots) {
    const u = (now - p.t0) / CONFIG.potMs;
    if (u >= 1) continue;
    const isCue = p.ref === 'cue';
    const fill = isCue ? set.COLORS.foam : fillOf(p.ref);
    const rim = line(isCue ? set.COLORS.coral : fill, set);
    drawBall(ctx, { x: p.x + (p.px - p.x) * u, y: p.y + (p.py - p.y) * u }, fill, rim, set, Math.round(CONFIG.ballR * (1 - u)));
    rows(ctx, Math.round(p.px), Math.round(p.py), Math.round(2 + 5 * u), set.COLORS.foam, 1); // the splash ring
  }
  if (aim) {
    drawGuide(ctx, set);
    drawPull(ctx, set);
  }
}

/* ---------- the table for this screen ---------- */

function ensure(s) {
  const key = `${s.H}|${s.safe.top}|${s.safe.right}|${s.safe.bottom}|${s.safe.left}`;
  if (world && key === layoutKey) return;
  layoutKey = key;
  table = S.makeTable(LOGICAL_WIDTH, s.H, s.safe, CONFIG);
  world = S.createWorld(table, CONFIG); // a new screen size starts a fresh rack
  drawRefs();
  pots = [];
  rises = new Map();
  aim = null;
}

/* ---------- the loop: runs only while something moves ---------- */

const busy = (now) => S.busy(world) || pots.some((p) => now - p.t0 < CONFIG.potMs) || rises.size > 0;

function buzz(ms) {
  if (ms > 0) tick(ms);
}

function frame(now) {
  raf = 0;
  if (document.hidden || !world) return;
  acc += Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  let ms = 0;
  while (acc >= S.DT && S.busy(world)) {
    acc -= S.DT;
    for (const e of S.step(world)) {
      if (e.k === 'ball' && e.speed > CONFIG.tickMinSpeed) ms = Math.max(ms, CONFIG.hapticBallMs);
      else if (e.k === 'cushion' && e.speed > CONFIG.tickMinSpeed) ms = Math.max(ms, CONFIG.hapticCushionMs);
      else if (e.k === 'pot') {
        ms = Math.max(ms, CONFIG.hapticPotMs);
        if (!reducedMotion()) pots.push({ x: e.x, y: e.y, px: e.px, py: e.py, t0: now, ref: e.id === 0 ? 'cue' : refs[e.id] });
      } else if (e.k === 'rack') {
        ms = Math.max(ms, CONFIG.hapticRackMs);
        drawRefs();
      } else if (e.k === 'cue' && !reducedMotion()) rises.set(0, now);
    }
  }
  if (!S.busy(world)) acc = 0;
  buzz(ms);
  pots = pots.filter((p) => now - p.t0 < CONFIG.potMs);
  screen.render();
  if (busy(now)) raf = requestAnimationFrame(frame);
}

function redraw() {
  if (!raf && !document.hidden) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

/* ---------- input: pull back anywhere, release to shoot ---------- */

const screen = createScreen(canvas, draw);

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (aim || !world || atSideEdge(e)) return;
  const cue = world.balls[0];
  if (cue.potted || S.anyMoving(world)) return; // a touch while any ball moves is ignored
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
  const p = screen.toLogical(e.clientX, e.clientY);
  aim = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y };
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
  if (shot && world && !world.balls[0].potted && !S.anyMoving(world) && S.shoot(world, shot.dx, shot.dy, shot.speed)) {
    buzz(CONFIG.hapticReleaseMs);
    acc = 0;
  }
  redraw();
  screen.render();
});

canvas.addEventListener('pointercancel', (e) => {
  if (aim && e.pointerId === aim.id) {
    aim = null;
    redraw();
    screen.render();
  }
});

/* ---------- lifecycle ---------- */

onThemeChange(() => { screen.render(); }); // only the colours change: the next frame is the same table in the other set

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    aim = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else {
    redraw();
  }
});
addEventListener('pageshow', () => { aim = null; redraw(); });

// Read-only hook for tests/check.py; the game never reads it.
Object.defineProperty(window, '__pool', {
  value: Object.freeze({
    snapshot: () => ({
      config: { ...CONFIG },
      geo: { W: LOGICAL_WIDTH, H: screen.H, safe: { ...screen.safe }, scale: screen.scale },
      table: table ? JSON.parse(JSON.stringify(table)) : null,
      balls: world ? world.balls.map((b) => ({ ...b })) : [],
      moving: world ? S.anyMoving(world) : false,
      cueAt: world ? world.cueAt : -1,
      rackAt: world ? world.rackAt : -1,
      aiming: !!aim,
      raf: !!raf,
      pots: pots.length,
    }),
    /** Client px of a logical point. */
    toClient: (x, y) => {
      const r = canvas.getBoundingClientRect();
      const dpr = canvas.width / r.width;
      return { x: r.left + (x * screen.scale + screen.ox) / dpr, y: r.top + (y * screen.scale + screen.oy) / dpr };
    },
  }),
});
