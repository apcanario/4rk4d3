#!/usr/bin/env node
// RLX row B1 headless checks: runs games/bricks/physics.js in Node (PLAN §6
// Accept). Not needed to run the app. Run: node tests/bricks-sim.mjs
// Uses the tuning block from games/bricks/bricks.js, so it tests what ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../games/bricks/physics.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');
let passed = 0;
const fails = [];
function check(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (cond) passed++;
  else fails.push(msg);
}

/* ---------- the config block and the no-DOM rule ---------- */

const bricksSrc = read('games/bricks/bricks.js');
const m = bricksSrc.match(/export const CONFIG = Object\.freeze\((\{[\s\S]*?\})\);/);
const CONFIG = m ? Function(`return (${m[1]});`)() : null;
check(!!CONFIG, 'bricks.js has one CONFIG block');
check(bricksSrc.indexOf('export const CONFIG') < bricksSrc.indexOf('import '), 'CONFIG block sits at the top of bricks.js');
check(CONFIG && CONFIG.ballSpeed === 95 && CONFIG.sensitivity === 1.2 && CONFIG.hapticBrickMs === 8
  && CONFIG.hapticPaddleMs === 16 && CONFIG.refillBelow === 35 && CONFIG.resumeDelayMs === 250,
  `CONFIG holds the PLAN values ${JSON.stringify(CONFIG)}`);
check(CONFIG && ['serveAngleDeg', 'loopBounces', 'loopNudgeDeg'].every((k) => typeof CONFIG[k] === 'number'),
  'CONFIG also holds the serve angle and the loop-breaker count and nudge');
const physSrc = read('games/bricks/physics.js').replace(/\/\/.*$/gm, '');
check(!/\b(document|window|navigator|localStorage|requestAnimationFrame|HTMLElement|import)\b/.test(physSrc),
  'physics.js touches no DOM and imports nothing');
check(P.STEP_HZ === 120, 'physics steps at a fixed 120 Hz');
const hexIn = (src) => (src.replace(/\/\/.*$/gm, '').match(/#[0-9A-Fa-f]{6}\b/g) || []);
check(hexIn(bricksSrc).length === 0 && hexIn(physSrc).length === 0, 'no colour literals in the game: tokens only');

/* ---------- geometry ---------- */

// Logical height 240 (the smallest design height) and a tall phone, with and
// without a status-bar inset at the top.
const GEOS = [
  ['H240', P.geometry(135, 23, 240 - 42)],
  ['H240-safe', P.geometry(135, 33, 240 - 42)],
  ['H330', P.geometry(135, 23, 330 - 42)],
];
for (const [tag, g] of GEOS) {
  const bottom = g.top + P.MAX_ROWS * P.ROW_H - P.GAP;
  check(g.left === 9 && g.left * 2 + 7 * 15 + 6 * 2 === 135, `[${tag}] 7 columns of 15 px with 2 px gaps, centred`);
  check(g.horizon - (g.paddleY + P.PADDLE_H) === 16, `[${tag}] paddle sits 16 px above the horizon`);
  check(g.paddleY - bottom >= 20, `[${tag}] 12 rows end ${g.paddleY - bottom} px above the paddle`);
}

/* ---------- the long run ---------- */

const SIN20 = Math.sin((20 * Math.PI) / 180);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function overlaps(ax, ay, aw, ah, bx, by, bw, bh, e = 1e-6) {
  return ax < bx + bw - e && ax + aw > bx + e && ay < by + bh - e && ay + ah > by + e;
}

/** Does the ball's top-left moving p0 -> p0 + d enter the box (shrunk by e)? */
function segmentHits(p0, d, bx, by, bw, bh, e = 1e-6) {
  let t0 = 0;
  let t1 = 1;
  const lo = [bx - P.BALL + e, by - P.BALL + e];
  const hi = [bx + bw - e, by + bh - e];
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-15) {
      if (p0[k] <= lo[k] || p0[k] >= hi[k]) return false;
    } else {
      let a = (lo[k] - p0[k]) / d[k];
      let b = (hi[k] - p0[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 >= t1) return false;
    }
  }
  return true;
}

/**
 * Simulate `minutes` of play. tracker(s, t) returns the paddle move for this
 * step (already scaled). Returns stats; every per-step check counts failures.
 */
function run(tag, geo, cfg, minutes, tracker, onEvents = () => {}) {
  const s = P.create(geo, cfg, 0);
  const steps = Math.round(minutes * 60 * P.STEP_HZ);
  const st = {
    nan: 0, outOfBounds: 0, insidePaddle: 0, sweptThrough: 0, still: 0, speedOff: 0, flat: 0, tunnelBrick: 0, tunnelPaddle: 0, tooDeep: 0, countBad: 0,
    pops: 0, paddleHits: 0, splashes: 0, refills: 0, fades: 0, maxGap: 0, maxCount: 0, minCount: Infinity,
    maxDeepest: 0,
  };
  let lastPop = 0;
  let wasSliding = false;
  let wasFading = false;
  for (let i = 0; i < steps; i++) {
    const t = i * P.DT;
    const dx = tracker(s, t);
    const evPaddle = P.movePaddle(s, dx, cfg);
    const prev = s.ball ? { ...s.ball } : null;
    const off0 = P.slideOffset(s);
    const live0 = s.rows.map((r, k) => (s.fade && s.fade.row === k ? 0 : r.m));
    const sliding0 = s.slide !== null;
    const ev = P.step(s, cfg).concat(evPaddle);
    onEvents(ev, t);
    for (const e of ev) {
      if (e.type === 'brick') { st.pops++; lastPop = t; }
      if (e.type === 'paddle') st.paddleHits++;
      if (e.type === 'splash') st.splashes++;
    }
    st.maxGap = Math.max(st.maxGap, t - lastPop);
    if (s.slide !== null && !wasSliding) st.refills++;
    if (s.fade && !wasFading) st.fades++;
    wasSliding = s.slide !== null;
    wasFading = !!s.fade;

    const b = s.ball;
    const nums = [s.paddleX, s.score, s.time, s.respawn, s.slide === null ? 0 : s.slide];
    if (b) nums.push(b.x, b.y, b.vx, b.vy);
    if (!nums.every(finite)) st.nan++;
    const n = P.brickCount(s);
    st.maxCount = Math.max(st.maxCount, n);
    if (i > P.STEP_HZ) st.minCount = Math.min(st.minCount, n);
    if (n > P.MAX_ROWS * P.COLS || n < 0) st.countBad++;
    const deep = P.deepestRow(s);
    st.maxDeepest = Math.max(st.maxDeepest, deep);
    if (deep >= P.MAX_ROWS || P.rowY(s, Math.max(0, deep)) + P.BRICK_H > geo.paddleY - 20) st.tooDeep++;
    if (s.paddleX < 0 || s.paddleX > geo.W - P.PADDLE_W) st.outOfBounds++;
    if (b) {
      if (b.x < 0 || b.x > geo.W - P.BALL || b.y < geo.top || b.y > geo.horizon) st.outOfBounds++;
      if (Math.abs(Math.hypot(b.vx, b.vy) - cfg.ballSpeed) > 1e-6) st.speedOff++;
      if (Math.abs(b.vy) < cfg.ballSpeed * SIN20 - 1e-9) st.flat++;
      for (let r = 0; r < s.rows.length; r++) {
        if (s.fade && s.fade.row === r) continue;
        const y = P.rowY(s, r);
        for (let c = 0; c < P.COLS; c++) {
          if ((s.rows[r].m & (1 << c)) && overlaps(b.x, b.y, P.BALL, P.BALL, P.brickX(s, c), y, P.BRICK_W, P.BRICK_H)) st.tunnelBrick++;
        }
      }
      if (overlaps(b.x, b.y, P.BALL, P.BALL, s.paddleX, geo.paddleY, P.PADDLE_W, P.PADDLE_H)) st.insidePaddle++;
      if (prev && Math.hypot(b.x - prev.x, b.y - prev.y) < 1e-6) st.still++;
      // Swept: on a straight step (velocity unchanged, slide not ending), the
      // ball's whole path, in the bricks' frame, must miss every brick that
      // was there before the step and is still there after it.
      if (prev && prev.vx === b.vx && prev.vy === b.vy && sliding0 === (s.slide !== null)) {
        const off1 = P.slideOffset(s);
        const p0 = [prev.x, prev.y - off0];
        const d = [b.x - prev.x, b.y - off1 - (prev.y - off0)];
        for (let r = 0; r < s.rows.length; r++) {
          const both = live0[r] & s.rows[r].m;
          if (!both) continue;
          const y = geo.top + r * P.ROW_H;
          for (let c = 0; c < P.COLS; c++) {
            if ((both & (1 << c)) && segmentHits(p0, d, P.brickX(s, c), y, P.BRICK_W, P.BRICK_H)) st.sweptThrough++;
          }
        }
      }
      if (prev && prev.y + P.BALL <= geo.paddleY + 1e-9 && b.y + P.BALL > geo.paddleY + 1e-6) {
        const lo = Math.min(prev.x, b.x);
        const hi = Math.max(prev.x, b.x) + P.BALL;
        if (lo > s.paddleX + 1e-6 && hi < s.paddleX + P.PADDLE_W - 1e-6) st.tunnelPaddle++;
      }
    }
  }
  st.final = s;
  return st;
}

// A thumb that follows the ball with a slowly drifting aim, so the ball goes
// everywhere; maxStep caps how far it moves per step (the finger's speed).
function tracker(maxStep) {
  return (s, t) => {
    const aim = s.ball
      ? s.ball.x + P.BALL / 2 + 11 * Math.sin(t * 0.37) + 4 * Math.sin(t * 1.3 + 1)
      : s.geo.W / 2;
    const want = aim - (s.paddleX + P.PADDLE_W / 2);
    return Math.max(-maxStep, Math.min(maxStep, want));
  };
}

function report(tag, st, { minutes, expectMisses }) {
  console.log(`  [${tag}] ${minutes} min: pops ${st.pops}, paddle ${st.paddleHits}, splashes ${st.splashes}, `
    + `refills ${st.refills}, fades ${st.fades}, bricks ${st.minCount}..${st.maxCount}, deepest row ${st.maxDeepest + 1}, `
    + `longest gap between pops ${st.maxGap.toFixed(1)} s, score ${st.final.score}`);
  check(st.nan === 0, `[${tag}] no NaN or infinity in the state`);
  check(st.outOfBounds === 0, `[${tag}] ball and paddle stay in bounds (${st.outOfBounds} bad steps)`);
  check(st.speedOff === 0, `[${tag}] ball speed constant at every step (${st.speedOff} off)`);
  check(st.flat === 0, `[${tag}] never shallower than 20 degrees from horizontal (${st.flat} flat steps)`);
  check(st.tunnelBrick === 0, `[${tag}] ball never inside a brick at a step's end (${st.tunnelBrick})`);
  check(st.sweptThrough === 0, `[${tag}] no tunnelling: no straight step's swept path crosses a brick (${st.sweptThrough})`);
  check(st.insidePaddle === 0, `[${tag}] ball never inside the paddle (${st.insidePaddle})`);
  check(st.tunnelPaddle === 0, `[${tag}] ball never passes through the paddle top (${st.tunnelPaddle})`);
  check(st.countBad === 0 && st.maxCount <= 84, `[${tag}] brick count bounded (max ${st.maxCount} <= 84)`);
  check(st.tooDeep === 0, `[${tag}] field never deeper than 12 rows or within 20 px of the paddle`);
  check(st.still === 0, `[${tag}] the ball moves at every step (${st.still} still steps)`);
  check(st.maxGap < 60, `[${tag}] no stuck ball: a brick pops at least every 60 s (longest ${st.maxGap.toFixed(1)} s)`);
  check(st.refills > 0, `[${tag}] endless refill ran (${st.refills} slides)`);
  check(st.final.score === st.pops, `[${tag}] score counts every popped brick`);
  if (expectMisses) check(st.splashes > 0, `[${tag}] misses splash and a new ball follows (${st.splashes})`);
}

const MIN = 10;
for (const [tag, g] of GEOS) {
  const st = run(tag, g, CONFIG, MIN, tracker(4));
  report(`${tag} tracking`, st, { minutes: MIN });
}
{
  const st = run('lazy', GEOS[0][1], CONFIG, MIN, tracker(0.45));
  report('H240 lazy thumb', st, { minutes: MIN, expectMisses: true });
}
{
  // Stress: 25x speed, 1.5 px per step at 95 becomes 20 px per step.
  const fast = { ...CONFIG, ballSpeed: 2400 };
  const st = run('fast', GEOS[2][1], fast, 2, tracker(40));
  report('H330 at 2400 px/s', st, { minutes: 2 });
}

/* ---------- unit checks ---------- */

{
  // Paddle bounce angles: centre straight up, edges 60 degrees from vertical.
  const g = GEOS[2][1];
  const angleAt = (off) => {
    const s = P.create(g, CONFIG);
    s.rows.forEach((r) => { r.m = 0; });
    s.rows[0].m = P.FULL;
    s.paddleX = 50;
    const cx = s.paddleX + P.PADDLE_W / 2 + off;
    s.ball = { x: cx - P.BALL / 2, y: g.paddleY - P.BALL - 3, vx: 0, vy: CONFIG.ballSpeed };
    for (let i = 0; i < 20; i++) P.step(s, { ...CONFIG, refillBelow: 0 });
    return (Math.atan2(s.ball.vx, -s.ball.vy) * 180) / Math.PI;
  };
  const a0 = angleAt(0);
  const aR = angleAt(P.PADDLE_W / 2);
  const aL = angleAt(-P.PADDLE_W / 2);
  const aOut = angleAt(P.PADDLE_W / 2 + 2);
  const aQ = angleAt(P.PADDLE_W / 4);
  check(Math.abs(a0) < 1e-9, `paddle centre sends the ball straight up (${a0.toFixed(3)} deg)`);
  check(Math.abs(aR - 60) < 1e-6 && Math.abs(aL + 60) < 1e-6, `paddle edges send it 60 degrees from vertical (${aL.toFixed(2)}, ${aR.toFixed(2)})`);
  check(Math.abs(aOut - 60) < 1e-6, `a ball caught past the end also goes 60 degrees (${aOut.toFixed(2)})`);
  check(aQ > 20 && aQ < 40, `between centre and edge the angle scales (${aQ.toFixed(2)} deg)`);
}
{
  // Twelve-row cap: the lowest row fades (no score), then the slide happens.
  const g = GEOS[0][1];
  const s = P.create(g, CONFIG, 5);
  s.rows.forEach((r) => { r.m = 0; });
  s.rows[11].m = P.FULL;
  s.rows[3].m = 0b0000011;
  s.ball = { x: 2, y: g.paddleY - 40, vx: 0, vy: -CONFIG.ballSpeed }; // far from the bricks
  s.ball.x = 0; s.ball.vx = 0;
  P.step(s, CONFIG);
  check(s.fade && s.fade.row === 11 && s.slide === null, 'refill with row 12 occupied: the lowest row fades first');
  check(P.brickCount(s) === 2, 'a fading row no longer counts or collides');
  let steps = 0;
  while (s.fade && steps < 200) { P.step(s, CONFIG); steps++; }
  check(s.slide !== null && s.rows[11].m === 0 && s.rows[0].m === P.FULL && s.rows[4].m === 0b0000011,
    `after the fade (${steps} steps) the slide runs and a full row enters at the top`);
  check(s.score === 5, 'the faded row scores nothing');
  let k = 0;
  while (s.slide !== null && k < 200) { P.step(s, CONFIG); k++; }
  check(Math.abs(k * P.DT - P.SLIDE_S) < 2 * P.DT, `the slide takes 400 ms (${(k * P.DT * 1000).toFixed(0)} ms)`);
}
{
  // Colours keep cycling through the nine tokens as rows enter.
  const g = GEOS[0][1];
  const s = P.create(g, CONFIG);
  check(s.rows.slice(0, 9).every((r, i) => r.c === i && r.m === P.FULL), 'starts with 9 full rows in token order');
  const seen = [];
  for (let n = 0; n < 12; n++) {
    s.rows.forEach((r) => { r.m = 0; });
    s.slide = null;
    P.step(s, CONFIG);
    seen.push(s.rows[0].c);
  }
  check(seen.join(',') === '8,7,6,5,4,3,2,1,0,8,7,6', `entering rows cycle the colour tokens (${seen.join(',')})`);
}
{
  // Miss: splash, then 600 ms later a new ball rises from the paddle centre.
  const g = GEOS[0][1];
  const s = P.create(g, CONFIG);
  s.paddleX = 0;
  s.ball = { x: 100, y: g.horizon - 10, vx: 0, vy: CONFIG.ballSpeed };
  let splashAt = -1;
  let spawnAt = -1;
  for (let i = 0; i < 200; i++) {
    const ev = P.step(s, CONFIG);
    if (ev.some((e) => e.type === 'splash')) splashAt = i;
    if (splashAt >= 0 && s.ball) { spawnAt = i; break; }
  }
  check(splashAt >= 0, 'a ball that falls into the sea splashes');
  check(spawnAt > 0 && Math.abs((spawnAt - splashAt) * P.DT - 0.6) < 1.5 * P.DT,
    `the new ball comes ${((spawnAt - splashAt) * P.DT * 1000).toFixed(0)} ms after the splash`);
  const b = s.ball;
  const ang = b ? (Math.atan2(b.vx, -b.vy) * 180) / Math.PI : NaN;
  check(b && Math.abs(b.x + P.BALL / 2 - (s.paddleX + P.PADDLE_W / 2)) < 1e-9 && b.vy < 0,
    'it rises from the centre of the paddle');
  check(Math.abs(Math.abs(ang) - CONFIG.serveAngleDeg) < 1e-9, `it leaves ${ang.toFixed(2)} deg from vertical (serve angle)`);
  // Serves alternate left, right, left.
  const t2 = P.create(g, CONFIG);
  const sides = [Math.sign(t2.ball.vx)];
  for (let n = 0; n < 3; n++) {
    t2.ball = null; t2.respawn = P.DT / 2; t2.idle = 0;
    P.step(t2, CONFIG);
    sides.push(Math.sign(t2.ball.vx));
  }
  check(sides.join(',') === '-1,1,-1,1', `serves alternate left and right (${sides.join(',')})`);
}
{
  // Save and restore: a JSON round trip gives the same game, step for step.
  const g = GEOS[1][1];
  const a = P.create(g, CONFIG, 41);
  const tr = tracker(4);
  for (let i = 0; i < 5000; i++) { P.movePaddle(a, tr(a, i * P.DT), CONFIG); P.step(a, CONFIG); }
  const saved = JSON.stringify(a);
  const b = P.restore(JSON.parse(saved), g, CONFIG);
  check(b && JSON.stringify(b) === saved, 'save and restore round trip is exact');
  for (let i = 5000; i < 9000; i++) {
    P.movePaddle(a, tr(a, i * P.DT), CONFIG); P.step(a, CONFIG);
    P.movePaddle(b, tr(b, i * P.DT), CONFIG); P.step(b, CONFIG);
  }
  check(JSON.stringify(a) === JSON.stringify(b), 'a restored game plays on identically');
  // Mid-slide and mid-fade states restore too.
  const c = P.create(g, CONFIG);
  c.rows.forEach((r) => { r.m = 0; });
  c.rows[11].m = 1;
  c.ball.y -= 30;
  P.step(c, CONFIG);
  const cr = P.restore(JSON.parse(JSON.stringify(c)), g, CONFIG);
  check(cr && cr.fade && cr.fade.row === 11, 'a save taken mid-fade restores');
  // Corrupt and old-version saves are refused, the score still readable.
  const base = JSON.parse(saved);
  const bad = [
    null, 'x', 42, {}, { ...base, v: 0 }, { ...base, rows: 'garbage' }, { ...base, rows: base.rows.slice(1) },
    { ...base, ball: { x: NaN, y: 1, vx: 1, vy: 1 } }, { ...base, ball: { ...base.ball, vx: 0, vy: 0 } },
    { ...base, colour: 9 }, { ...base, paddleX: 'a' }, { ...base, geo: null }, { ...base, score: -1 },
    { ...base, ball: null, respawn: 0 }, { ...base, slide: 9 },
  ];
  check(bad.every((o) => P.restore(o, g, CONFIG) === null), `${bad.length} corrupt or old-version saves give null (fresh field)`);
  check(P.readScore({ ...base, v: 0 }) === base.score && P.readScore({ score: 7, rows: 1 }) === 7
    && P.readScore({ score: 'x' }) === null && P.readScore(null) === null, 'the score is read from a refused save when it can be');
  // A different screen height: the field keeps its place, the ball stays clear of bricks.
  const tall = P.geometry(135, 23, 400);
  const d = P.restore(JSON.parse(saved), tall, CONFIG);
  check(d && d.geo.horizon === 400 && d.paddleX >= 0 && (!d.ball || (d.ball.y >= tall.top && d.ball.y < tall.horizon)),
    'restore on a taller screen re-fits the geometry');
}

{
  // A paddle swept into the ball: never inside it, speed and 20 degrees kept.
  // Jittery and flick thumbs, 200 trials of 30 s each, one row of bricks.
  let seed = 777;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const g = GEOS[0][1];
  for (const kind of ['jitter', 'flick']) {
    let inside = 0;
    let bad = 0;
    let sideHits = 0;
    let steps = 0;
    for (let trial = 0; trial < 200; trial++) {
      const s = P.create(g, CONFIG, 0);
      s.rows.forEach((r) => { r.m = 0; });
      s.rows[0].m = P.FULL;
      s.paddleX = rnd() * (135 - P.PADDLE_W);
      s.ball.x = s.paddleX + 12.5;
      for (let i = 0; i < 120 * 30; i++) {
        const dx = kind === 'jitter' ? (rnd() - 0.5) * 6 : (i % 37 === 0 ? (rnd() - 0.5) * 120 : 0);
        const vx0 = s.ball && s.ball.vx;
        P.movePaddle(s, dx, CONFIG, true);
        const b = s.ball;
        if (b && vx0 !== b.vx) sideHits++;
        const after = [b];
        P.step(s, CONFIG);
        after.push(s.ball);
        for (const q of after) {
          if (!q) continue;
          if (overlaps(q.x, q.y, P.BALL, P.BALL, s.paddleX, g.paddleY, P.PADDLE_W, P.PADDLE_H)) inside++;
          if (Math.abs(Math.hypot(q.vx, q.vy) - CONFIG.ballSpeed) > 1e-6 || Math.abs(q.vy) < CONFIG.ballSpeed * SIN20 - 1e-9) bad++;
        }
        steps++;
      }
    }
    console.log(`  [${kind} thumb] ${steps} steps, ${sideHits} paddle-driven bounces`);
    check(inside === 0, `[${kind} thumb] 200 x 30 s: zero steps with the ball inside the paddle (${inside})`);
    check(bad === 0, `[${kind} thumb] paddle-driven bounces keep the speed and the 20 degree rule (${bad})`);
  }
  // Direct cases: from the side (deep) and from the top.
  const s = P.create(g, CONFIG);
  s.paddleX = 60;
  s.ball = { x: 50, y: g.paddleY + 2, vx: 20, vy: Math.sqrt(95 * 95 - 400) };
  let ev = P.movePaddle(s, -8, CONFIG, true);
  check(s.ball.x + P.BALL <= s.paddleX + 1e-9 && s.ball.vx < 0 && ev.length === 0,
    'paddle driven into a deep ball from the side pushes it out sideways, away from the paddle');
  s.paddleX = 20;
  s.ball = { x: 2, y: g.paddleY + 2, vx: 20, vy: Math.sqrt(95 * 95 - 400) };
  P.movePaddle(s, -18, CONFIG, true);
  check(!overlaps(s.ball.x, s.ball.y, 5, 5, s.paddleX, g.paddleY, 30, 6) && s.ball.x === 0 && s.paddleX === P.BALL,
    'against the wall the paddle stops at the ball instead');
  const y0 = s.ball.y;
  let fell = false;
  for (let i = 0; i < 120 && s.ball; i++) {
    P.step(s, CONFIG);
    if (s.ball && s.ball.y > y0 + 3) fell = true;
  }
  check(fell || !s.ball, 'a ball wedged between the wall and the paddle slides out (no stuck ball)');
  s.paddleX = 60;
  s.ball = { x: 55, y: g.paddleY - 3, vx: 20, vy: Math.sqrt(95 * 95 - 400) };
  ev = P.movePaddle(s, -8, CONFIG, true);
  check(s.ball.y === g.paddleY - P.BALL && s.ball.vy < 0 && ev.some((e) => e.type === 'paddle'),
    'paddle driven under a ball whose centre is above its own bounces it off the top');
  // Not live (paused or resuming): no bounce, no tick, paddle stops at the ball.
  s.paddleX = 60;
  s.ball = { x: 55, y: g.paddleY - 3, vx: 20, vy: Math.sqrt(95 * 95 - 400) };
  const before = { ...s.ball };
  ev = P.movePaddle(s, -8, CONFIG, false);
  check(ev.length === 0 && JSON.stringify(s.ball) === JSON.stringify(before)
    && !overlaps(s.ball.x, s.ball.y, 5, 5, s.paddleX, g.paddleY, 30, 6) && s.paddleX === s.ball.x + P.BALL,
    'not running: no bounce, no event, the paddle stops at the ball');
}

{
  // Still thumb: the ball must not loop in its own column. Old behaviour
  // (vertical serve, centre bounce straight up) popped one column forever.
  for (const [tag, g] of [GEOS[0], GEOS[2]]) {
    for (const px of [0, 30, 52.5, 70.25, 105]) {
      const s = P.create(g, CONFIG, 0);
      s.paddleX = px;
      s.ball.x = px + 12.5;
      const own = Math.floor((px + 15 - g.left) / P.COL_W);
      let otherAt = -1;
      let lastPop = 0;
      let maxGap = 0;
      for (let i = 0; i < 120 * 600; i++) {
        for (const e of P.step(s, CONFIG)) {
          if (e.type !== 'brick') continue;
          const col = Math.floor((e.x - g.left) / P.COL_W);
          if (col !== own && otherAt < 0) otherAt = i / 120;
          maxGap = Math.max(maxGap, i / 120 - lastPop);
          lastPop = i / 120;
        }
      }
      maxGap = Math.max(maxGap, 600 - lastPop);
      check(otherAt >= 0 && otherAt < 60 && maxGap < 60,
        `[${tag} still thumb at ${px}] pops beyond its own column after ${otherAt.toFixed(1)} s; longest no-pop ${maxGap.toFixed(1)} s in 10 min`);
    }
  }
  // Loop breaker: a centred vertical loop with nothing to pop gets nudged.
  const g = GEOS[2][1];
  const s = P.create(g, CONFIG);
  s.rows.forEach((r) => { r.m = 0; });
  s.rows[0].m = P.FULL & ~(1 << 3);
  s.ball = { x: s.paddleX + 12.5, y: g.paddleY - 6, vx: 0, vy: CONFIG.ballSpeed };
  s.idle = 0;
  const angles = [];
  for (let i = 0; i < 120 * 20 && angles.length < 4; i++) {
    const ev = P.step(s, { ...CONFIG, refillBelow: 0 });
    if (ev.some((e) => e.type === 'paddle')) angles.push(Math.round((Math.atan2(s.ball.vx, -s.ball.vy) * 180) / Math.PI));
    if (ev.some((e) => e.type === 'brick')) break;
  }
  check(angles[0] === 0 && angles[1] === 0 && angles[2] !== 0,
    `centre bounces go straight up, then after ${CONFIG.loopBounces} with nothing popped the path is nudged (${angles.join(', ')} deg)`);
}

/* ---------- haptics: the shared tick with the game's events ---------- */

{
  let clock = 0;
  const calls = [];
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', {
    value: { vibrate: (ms) => { calls.push([clock, ms]); return true; } }, configurable: true,
  });
  const H = await import('../shared/haptics.js');
  const { setHaptics } = await import('../shared/settings.js');
  const feed = (ev, t) => {
    clock = t * 1000;
    for (const e of ev) {
      if (e.type === 'brick') H.tick(CONFIG.hapticBrickMs);
      else if (e.type === 'paddle') H.tick(CONFIG.hapticPaddleMs);
    }
  };
  setHaptics(true);
  const on = run('haptics-on', GEOS[0][1], CONFIG, 2, tracker(4), feed);
  const kinds = new Set(calls.map((c) => c[1]));
  let minGap = Infinity;
  for (let i = 1; i < calls.length; i++) minGap = Math.min(minGap, calls[i][0] - calls[i - 1][0]);
  console.log(`  [haptics on] ${calls.length} vibrate calls for ${on.pops} bricks and ${on.paddleHits} paddle hits, min gap ${minGap.toFixed(1)} ms`);
  check(calls.length > 0 && [...kinds].every((k) => k === 8 || k === 16) && kinds.has(8) && kinds.has(16),
    `haptics on: only 8 ms (brick) and 16 ms (paddle) ticks ${JSON.stringify([...kinds])}`);
  check(minGap >= 40, `at most one vibrate call per 40 ms (min gap ${minGap.toFixed(1)} ms)`);
  check(calls.length <= on.pops + on.paddleHits, 'never more calls than brick and paddle events');
  calls.length = 0;
  setHaptics(false);
  const off = run('haptics-off', GEOS[0][1], CONFIG, 2, tracker(4), feed);
  check(calls.length === 0 && off.pops > 0, `haptics off: zero vibrate calls over ${off.pops} pops`);
  setHaptics(true);
  calls.length = 0;
  delete globalThis.navigator.vibrate;
  clock += 1000;
  check(H.tick(8) === false && calls.length === 0, 'no navigator.vibrate: nothing is called');
}

console.log(`\n${passed + fails.length} checks, ${fails.length} failure(s)`);
process.exit(fails.length ? 1 : 0);
