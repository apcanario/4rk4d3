#!/usr/bin/env node
// RLX rows B1 and B2 headless checks: runs games/bricks/physics.js and the
// shared session clock in Node (PLAN §6 and §6a Accept). Not needed to run
// the app. Run: node tests/bricks-sim.mjs
// Uses the tuning block from games/bricks/bricks.js, so it tests what ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../games/bricks/physics.js';
import * as CT from './contrast.mjs';

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
check(CONFIG && CONFIG.speedMin === 80 && CONFIG.speedStart === 90 && CONFIG.speedMax === 125
  && CONFIG.gainPerReturn === 1 && CONFIG.lossPerMiss === 12 && CONFIG.sensitivity === 1.2 && CONFIG.hapticBrickMs === 8
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
function run(tag, geo, cfg, minutes, tracker, onEvents = () => {}, easeAt = () => 0) {
  const s = P.create(geo, cfg, 0);
  const steps = Math.round(minutes * 60 * P.STEP_HZ);
  const st = {
    nan: 0, outOfBounds: 0, insidePaddle: 0, sweptThrough: 0, still: 0, speedOff: 0, flat: 0, tunnelBrick: 0, tunnelPaddle: 0, tooDeep: 0, countBad: 0,
    pops: 0, paddleHits: 0, splashes: 0, refills: 0, fades: 0, maxGap: 0, maxCount: 0, minCount: Infinity,
    maxDeepest: 0, paceOut: 0, midFlight: 0, minSpeed: Infinity, maxSpeed: 0, bounceSpeeds: [],
  };
  let lastPop = 0;
  let wasSliding = false;
  let wasFading = false;
  for (let i = 0; i < steps; i++) {
    const t = i * P.DT;
    const ease = easeAt(t);
    const before = s.ball ? { ...s.ball } : null;
    const dx = tracker(s, t);
    const evPaddle = P.movePaddle(s, dx, cfg, true, ease);
    const prev = s.ball ? { ...s.ball } : null;
    const off0 = P.slideOffset(s);
    const live0 = s.rows.map((r, k) => (s.fade && s.fade.row === k ? 0 : r.m));
    const sliding0 = s.slide !== null;
    const ev = P.step(s, cfg, ease).concat(evPaddle);
    onEvents(ev, t, s);
    // Pace: in range always; the ball's speed changes only at a paddle bounce.
    const bounced = ev.some((e) => e.type === 'paddle');
    if (bounced) st.bounceSpeeds.push([t, s.speed]);
    for (const v of [s.pace, s.speed]) if (!(v >= cfg.speedMin - 1e-9 && v <= cfg.speedMax + 1e-9)) st.paceOut++;
    if (before && s.ball && !bounced && Math.abs(Math.hypot(before.vx, before.vy) - Math.hypot(s.ball.vx, s.ball.vy)) > 1e-9) st.midFlight++;
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
      const sp = Math.hypot(b.vx, b.vy);
      st.minSpeed = Math.min(st.minSpeed, sp);
      st.maxSpeed = Math.max(st.maxSpeed, sp);
      if (Math.abs(sp - s.speed) > 1e-6 || sp < cfg.speedMin - 1e-6 || sp > cfg.speedMax + 1e-6) st.speedOff++;
      if (Math.abs(b.vy) < s.speed * SIN20 - 1e-9) st.flat++;
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
    + `longest gap between pops ${st.maxGap.toFixed(1)} s, score ${st.final.score}, `
    + `speed ${st.minSpeed.toFixed(0)}..${st.maxSpeed.toFixed(0)}`);
  check(st.nan === 0, `[${tag}] no NaN or infinity in the state`);
  check(st.outOfBounds === 0, `[${tag}] ball and paddle stay in bounds (${st.outOfBounds} bad steps)`);
  check(st.speedOff === 0, `[${tag}] ball flies at its flight speed, inside the pace range, at every step (${st.speedOff} off)`);
  check(st.paceOut === 0, `[${tag}] pace and speed never leave ${CONFIG.speedMin}..${CONFIG.speedMax} (${st.paceOut} steps out)`);
  check(st.midFlight === 0, `[${tag}] the speed never changes in mid-flight, only at paddle bounces (${st.midFlight})`);
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
  const fast = { ...CONFIG, speedMin: 2400, speedStart: 2400, speedMax: 2400 };
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
    s.ball = { x: cx - P.BALL / 2, y: g.paddleY - P.BALL - 3, vx: 0, vy: CONFIG.speedStart };
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
  s.ball = { x: 2, y: g.paddleY - 40, vx: 0, vy: -CONFIG.speedStart }; // far from the bricks
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
  s.ball = { x: 100, y: g.horizon - 10, vx: 0, vy: CONFIG.speedStart };
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
          if (Math.abs(Math.hypot(q.vx, q.vy) - s.speed) > 1e-6 || Math.abs(q.vy) < s.speed * SIN20 - 1e-9) bad++;
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
  s.ball = { x: 50, y: g.paddleY + 2, vx: 20, vy: Math.sqrt(90 * 90 - 400) };
  let ev = P.movePaddle(s, -8, CONFIG, true);
  check(s.ball.x + P.BALL <= s.paddleX + 1e-9 && s.ball.vx < 0 && ev.length === 0,
    'paddle driven into a deep ball from the side pushes it out sideways, away from the paddle');
  s.paddleX = 20;
  s.ball = { x: 2, y: g.paddleY + 2, vx: 20, vy: Math.sqrt(90 * 90 - 400) };
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
  s.ball = { x: 55, y: g.paddleY - 3, vx: 20, vy: Math.sqrt(90 * 90 - 400) };
  ev = P.movePaddle(s, -8, CONFIG, true);
  check(s.ball.y === g.paddleY - P.BALL && s.ball.vy < 0 && ev.some((e) => e.type === 'paddle'),
    'paddle driven under a ball whose centre is above its own bounces it off the top');
  // Not live (paused or resuming): no bounce, no tick, paddle stops at the ball.
  s.paddleX = 60;
  s.ball = { x: 55, y: g.paddleY - 3, vx: 20, vy: Math.sqrt(90 * 90 - 400) };
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
  s.ball = { x: s.paddleX + 12.5, y: g.paddleY - 6, vx: 0, vy: CONFIG.speedStart };
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

/* ---------- row B2: pace, rally, session clock, scene phase ---------- */

const S = await import('../shared/session.js');
const T = await import('../shared/tokens.js');
const PX = await import('../shared/pixel.js');
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}
const RAMP_S = S.SESSION.rampMin * 60;
const END_S = RAMP_S + S.SESSION.slowdownMin * 60; // minute 12
const GAP_MS = S.SESSION.resetGapMin * 60 * 1000;
check(S.SESSION.rampMin === 10 && S.SESSION.slowdownMin === 2 && S.SESSION.resetGapMin === 5 && S.SESSION.sceneSteps === 10,
  `shared SESSION block holds ramp 10, slowdown 2, reset gap 5 minutes and 10 steps ${JSON.stringify(S.SESSION)}`);
check(/^\/\/[^\n]*\n(\/\/[^\n]*\n)*\n\/\/[^\n]*\nexport const SESSION/.test(read('shared/session.js')),
  'the SESSION block sits at the top of shared/session.js');

{
  // 15 simulated minutes, all of it active play, with the shared clock
  // driving the dusk slowdown and a tracking thumb that looks away now and
  // then (2.5 s in every 40 s), so the ball is missed.
  const geo = GEOS[0][1];
  const base = tracker(4);
  const missing = (s, t) => {
    if (t % 40 < 37.5) return base(s, t);
    if (!s.ball) return 0;
    const away = s.ball.x + P.BALL / 2 < s.geo.W / 2 ? 1 : -1;
    return away * 4;
  };
  const clock = S.freshClock();
  const st = run('B2 15 min', geo, CONFIG, 15, missing, (ev, t) => { S.addPlay(clock, P.DT, t * 1000); },
    (t) => S.slowdownOf(t));
  report('H240 B2 15 min with misses', st, { minutes: 15, expectMisses: true });
  const after = st.bounceSpeeds.filter(([t]) => t >= END_S - 1e-9);
  const lateBefore = st.bounceSpeeds.filter(([t]) => t < RAMP_S);
  const peak = Math.max(...lateBefore.map(([, v]) => v));
  console.log(`  [B2 15 min] clock ${(clock.active / 60).toFixed(2)} min active, peak speed before dusk ${peak}, `
    + `first bounce after minute 12 at ${after.length ? after[0][0].toFixed(2) : '-'} s with speed ${after.length ? after[0][1] : '-'}`);
  check(after.length > 0 && after[0][1] === CONFIG.speedMin,
    `speed is ${CONFIG.speedMin} by minute 12: at the first paddle bounce after it, ${after.length ? after[0][1] : 'none'}`);
  check(after.every(([, v]) => v === CONFIG.speedMin) && st.final.pace === CONFIG.speedMin,
    `and it stays at ${CONFIG.speedMin} for minutes 12 to 15 (${after.length} bounces)`);
  check(peak > CONFIG.speedStart + 10, `clean play raises the pace before dusk (peak ${peak})`);
  const slow = st.bounceSpeeds.filter(([t]) => t >= RAMP_S && t < END_S);
  check(slow.every(([t, v]) => v <= P.ceilingOf(CONFIG, S.slowdownOf(t)) + 1e-9),
    `in the slowdown every bounce is at or under the falling ceiling (${slow.length} bounces)`);
}

{
  // Pace rules, one event at a time.
  const g = GEOS[2][1];
  const s = P.create(g, CONFIG);
  check(s.pace === 90 && s.speed === 90 && Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - 90) < 1e-9,
    'a new game serves at the starting speed 90');
  s.rows.forEach((r) => { r.m = 0; });
  s.rows[0].m = P.FULL;
  s.paddleX = 50;
  const dropOn = (ease = 0) => {
    s.ball = { x: s.paddleX + 12.5, y: g.paddleY - P.BALL - 2, vx: 0, vy: s.speed };
    for (let i = 0; i < 30; i++) {
      const ev = P.step(s, { ...CONFIG, refillBelow: 0 }, ease);
      if (ev.some((e) => e.type === 'paddle')) return true;
    }
    return false;
  };
  const sp0 = s.speed;
  check(dropOn() && s.pace === 91 && s.speed === 91 && Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - 91) < 1e-9,
    `a clean paddle return adds 1, applied at that bounce (${sp0} -> ${s.speed})`);
  s.pace = 125; s.speed = 125;
  dropOn();
  check(s.pace === 125 && s.speed === 125, 'the pace is clamped at 125');
  // A miss takes 12 off the pace; the next serve takes it.
  s.paddleX = 0;
  s.ball = { x: 100, y: g.horizon - 10, vx: 0, vy: s.speed };
  let served = false;
  let missed = false;
  for (let i = 0; i < 240 && !served; i++) {
    const ev = P.step(s, CONFIG);
    if (ev.some((e) => e.type === 'splash')) {
      missed = true;
      check(s.pace === 113 && s.speed === 125, 'a miss takes 12 off the pace (113)');
    }
    if (missed && s.ball) served = true;
  }
  check(served && s.speed === 113 && Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - 113) < 1e-9, 'the next ball is served at the new pace');
  s.pace = 85; s.speed = 85;
  s.ball = { x: 100, y: g.horizon - 10, vx: 0, vy: s.speed };
  for (let i = 0; i < 120 && s.ball; i++) P.step(s, CONFIG);
  check(s.pace === 80, `the pace is clamped at 80 (${s.pace})`);
  // The ceiling falls linearly from 125 to 80 over the slowdown.
  check(P.ceilingOf(CONFIG, 0) === 125 && P.ceilingOf(CONFIG, 0.5) === 102.5 && P.ceilingOf(CONFIG, 1) === 80,
    'the ceiling is 125 before dusk, 102.5 half way through the slowdown, 80 at its end');
  check(S.slowdownOf(RAMP_S) === 0 && S.slowdownOf(RAMP_S + 60) === 0.5 && S.slowdownOf(END_S) === 1 && S.slowdownOf(15 * 60) === 1,
    'the slowdown runs from minute 10 to minute 12');
  // In flight nothing changes; at the bounce the speed follows the ceiling down.
  s.paddleX = 50; s.pace = 125; s.speed = 125;
  s.ball = { x: s.paddleX + 12.5, y: g.paddleY - 40, vx: 0, vy: 125 };
  for (let i = 0; i < 10; i++) P.step(s, CONFIG, 1);
  check(Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - 125) < 1e-9 && s.speed === 125, 'past minute 12 the ball in flight keeps its speed');
  dropOn(1);
  check(s.pace === 80 && s.speed === 80, `12 minutes of active play: at the next paddle bounce the ball is at 80 (${s.speed})`);
  // A miss just before minute 12 clamps the pace to the ceiling of that
  // moment (about 80.2); the serve 0.6 s later, past minute 12, flies at 80.
  s.paddleX = 0; s.pace = 125; s.speed = 125;
  s.ball = { x: 100, y: g.horizon - 3, vx: 0, vy: 125 };
  const easeAtMiss = 1 - 0.3 / (S.SESSION.slowdownMin * 60); // 0.3 s before minute 12
  let missPace = null;
  for (let i = 0; i < 10 && missPace === null; i++) {
    if (P.step(s, CONFIG, easeAtMiss).some((e) => e.type === 'splash')) missPace = s.pace;
  }
  for (let i = 0; i < 120 && !s.ball; i++) P.step(s, CONFIG, 1);
  check(missPace > CONFIG.speedMin && s.ball && s.pace === CONFIG.speedMin && s.speed === CONFIG.speedMin
    && Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - CONFIG.speedMin) < 1e-9,
    `a serve after minute 12 flies at exactly 80, never above the ceiling (pace at the miss ${missPace && missPace.toFixed(3)}, serve ${s.speed})`);
  // A paddle driven under the ball counts as a return too.
  s.pace = 100; s.speed = 100;
  s.ball = { x: 55, y: g.paddleY - 3, vx: 20, vy: Math.sqrt(100 * 100 - 400) };
  s.paddleX = 60;
  const ev = P.movePaddle(s, -8, CONFIG, true, 0);
  check(ev.some((e) => e.type === 'paddle') && s.speed === 101, 'a paddle driven under the ball is a return: +1 at that bounce');
  // A session-clock reset puts the pace back to 90; the ball in flight keeps its speed until its bounce.
  s.pace = 80; s.speed = 80;
  s.ball = { x: s.paddleX + 12.5, y: g.paddleY - 40, vx: 0, vy: 80 };
  P.resetPace(s, CONFIG);
  check(s.pace === 90 && s.speed === 80, 'a clock reset sets the pace to 90; the ball in flight is not changed');
}

{
  // The session clock.
  const T0 = 1_700_000_000_000;
  // The loop in bricks.js: while running, each 120 Hz step calls addPlay with
  // the wall time; a pause runs no steps; play starting again calls beginPlay.
  // Here 90 s of play, a 4-minute pause with the wall clock running, 30 s more.
  const c = S.freshClock();
  const STEP_MS = 1000 / P.STEP_HZ;
  let wall = T0;
  const play = (secs) => {
    for (let i = 0; i < secs * P.STEP_HZ; i++) { wall += STEP_MS; S.addPlay(c, P.DT, wall); }
  };
  play(90);
  const pausedFor = 4 * 60 * 1000; // a pause under the reset gap
  wall += pausedFor;
  const reset = S.beginPlay(c, wall);
  play(30);
  check(!reset && Math.abs(c.active - 120) < 1e-6 && c.last === wall && S.slowdownOf(c.active) === 0,
    `paused time does not advance the clock: 90 s, 4 minutes paused, 30 s gives ${c.active.toFixed(3)} s of active play`);
  // A device clock set back: now earlier than the saved last active play.
  const back = { active: 300, last: T0 };
  check(S.isStale(back, T0 - 1) && S.beginPlay(back, T0 - 60 * 1000) === true && back.active === 0,
    'a device clock set backwards (now before the last active play) counts as stale: the clock resets');
  S.saveClock({ active: 300, last: T0 });
  const rb = S.readClock(T0 - 1);
  check(rb.reset && rb.clock.active === 0, 'and a stored clock read with the device clock set back starts at phase 0');
  // 12 minutes of active play in 120 Hz steps.
  const d = S.freshClock();
  for (let i = 0; i < 12 * 60 * P.STEP_HZ; i++) S.addPlay(d, P.DT, T0 + i * (1000 / P.STEP_HZ));
  check(Math.abs(d.active - 720) < 1e-6 && S.phaseOf(d.active) === 1 && S.sceneStep(S.phaseOf(d.active)) === 10
    && S.slowdownOf(d.active) > 1 - 1e-9, `12 minutes of active play: phase 1, full dusk (step ${S.sceneStep(S.phaseOf(d.active))})`);
  // Saved and read back; after the reset gap the next session starts at sunset.
  S.saveClock(d);
  const r1 = S.readClock(d.last + GAP_MS - 1);
  check(!r1.reset && r1.clock.active === d.active && r1.clock.last === d.last, 'the clock and the time of the last active play are saved and read back');
  const r2 = S.readClock(d.last + GAP_MS);
  check(r2.reset && r2.clock.active === 0 && S.phaseOf(r2.clock.active) === 0, 'after 5 minutes without active play the next session starts at phase 0');
  const e = { ...d };
  check(S.beginPlay(e, d.last + GAP_MS) === true && e.active === 0, 'a pause of 5 minutes inside a game resets the clock when play starts again');
  const g = GEOS[0][1];
  const s = P.create(g, CONFIG);
  s.pace = 80; s.speed = 80; s.ball = null; s.respawn = P.DT / 2;
  P.resetPace(s, CONFIG);
  P.step(s, CONFIG, S.slowdownOf(r2.clock.active));
  check(s.pace === 90 && s.speed === 90 && Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - 90) < 1e-9,
    'and the speed starts at 90 again');
  localStorage.setItem('rlx.v1.session', '{nope');
  const r3 = S.readClock(T0);
  check(r3.clock.active === 0 && r3.clock.last === null, 'an unreadable stored clock gives a fresh clock');
  localStorage.removeItem('rlx.v1.session');
  // Scene steps change only on whole minutes of active play.
  const changes = [];
  let prevStep = 0;
  for (let t = 0; t <= 15 * 60; t += 0.5) {
    const k = S.sceneStep(S.phaseOf(t));
    if (k !== prevStep) changes.push([t, k]);
    prevStep = k;
  }
  check(changes.length === 10 && changes.every(([t, k], i) => t === (i + 1) * 60 && k === i + 1),
    `the scene moves in 10 steps, one per minute of active play (${changes.map(([t]) => t / 60).join(',')})`);
}

{
  // Rally: +1 per paddle return, 0 on a miss, nothing else; never in the state.
  let bad = 0;
  let maxRally = 0;
  let rally = 0;
  let resets = 0;
  const st = run('rally', GEOS[0][1], CONFIG, 3, tracker(0.6), (ev) => {
    const paddle = ev.filter((e) => e.type === 'paddle').length;
    const miss = ev.some((e) => e.type === 'splash');
    const next = P.rallyAfter(rally, ev);
    if (miss ? next !== 0 : next !== rally + paddle) bad++;
    if (miss && rally > 0) resets++;
    rally = next;
    maxRally = Math.max(maxRally, rally);
  });
  const plain = run('rally-free', GEOS[0][1], CONFIG, 3, tracker(0.6));
  check(bad === 0 && maxRally > 2 && resets > 0,
    `rally counts up on each paddle return and resets on a miss (max ${maxRally}, ${resets} resets, ${bad} wrong)`);
  check(JSON.stringify(st.final) === JSON.stringify(plain.final), 'counting the rally has no other effect: the game is identical without it');
  check(!('rally' in st.final) && !JSON.stringify(st.final).includes('rally'), 'the rally is not part of the saved state');
  check(P.rallyAfter(5, [{ type: 'brick' }]) === 5 && P.rallyAfter(5, [{ type: 'splash' }, { type: 'paddle' }]) === 1,
    'bricks do not count; a return after a miss starts again at 1');
}

{
  // Save and restore of pace and speed (state version 2); a B1 save is refused safely.
  const g = GEOS[1][1];
  const a = P.create(g, CONFIG, 9);
  const tr = tracker(4);
  for (let i = 0; i < 6000; i++) { P.movePaddle(a, tr(a, i * P.DT), CONFIG); P.step(a, CONFIG); }
  check(P.STATE_VERSION === 2 && a.v === 2, 'the Bricks state is version 2');
  const b = P.restore(JSON.parse(JSON.stringify(a)), g, CONFIG);
  check(b && b.pace === a.pace && b.speed === a.speed && a.pace !== 90,
    `pace and speed are saved and restored (${a.pace}, ${a.speed})`);
  const saved = JSON.parse(JSON.stringify(a));
  const bad = [
    { ...saved, pace: 79 }, { ...saved, pace: 126 }, { ...saved, speed: 'x' }, { ...saved, pace: undefined },
    { ...saved, speed: NaN },
  ];
  check(bad.every((o) => P.restore(JSON.parse(JSON.stringify(o)), g, CONFIG) === null), 'a pace or speed out of range or missing gives a fresh field');
  const b1 = { ...saved, v: 1 };
  delete b1.pace;
  delete b1.speed;
  let threw = false;
  let r = null;
  try { r = P.restore(JSON.parse(JSON.stringify(b1)), g, CONFIG); } catch (err) { threw = true; }
  check(!threw && r === null && P.readScore(b1) === saved.score, 'a B1 (version 1) save gives a fresh field without error, its score still readable');
}

{
  // Scene: 11 states (sunset and 10 steps), each a flat mix; no other colours.
  const draw = (phase, H = 300) => {
    const fills = [];
    const ctx = {
      fillStyle: '#000000',
      fillRect(x, y, w, h) { if (w > 0 && h > 0) fills.push([this.fillStyle, x, y, w, h]); },
    };
    const out = PX.drawScene(ctx, 135, H, { phase });
    return { fills, out };
  };
  const steps = [];
  for (let k = 0; k <= 10; k++) steps.push(draw(k / 10));
  const palettes = steps.map((_, k) => T.scenePalette(k / 10));
  const flatMix = palettes.every((pal, k) => pal.sky[0] === T.mix(T.COLORS.skyTop, T.DUSK.skyTop, k / 10)
    && pal.sky[9] === T.mix(T.COLORS.skyBottom, T.DUSK.skyBottom, k / 10)
    && pal.sea.every((c, i) => c === T.mix(T.SEA_BANDS[i], T.DUSK.seaBands[i], k / 10)));
  check(flatMix && palettes[0].sky[0] === '#FFF7EC' && palettes[10].sky[0] === '#CDB8E0' && palettes[10].sky[9] === '#F0A9A6'
    && palettes[10].sea.join() === '#6FA3C4,#5F93B8,#5083AB', 'each step is a flat mix from the sunset tokens to the dusk tokens');
  const keys = steps.map(({ fills }) => JSON.stringify(fills));
  check(new Set(keys).size === 11 && new Set(palettes.map((p) => p.sky.join() + p.sea.join())).size === 11,
    'sunset and the 10 steps are 11 distinct scenes');
  let stray = 0;
  steps.forEach(({ fills }, k) => {
    const allowed = new Set([...palettes[k].sky, ...palettes[k].sea, T.COLORS.sun, T.COLORS.cloud, T.COLORS.star,
      T.mix(T.COLORS.sun, palettes[k].sea[0], 0.15)]);
    for (const f of fills) if (!allowed.has(f[0])) stray++;
  });
  check(stray === 0, `flat: every pixel of every step is a band, sun, cloud, star or glint colour of that step (${stray} others)`);
  const within = [0.1, 0.149, 0.15, 0.199].map((ph) => JSON.stringify(draw(ph).fills));
  check(within[0] === within[1] && within[2] === within[3] && within[0] === keys[1],
    'no fade inside a step: any phase in a step draws the same pixels');
  check(steps.map(({ out }) => out.step).join() === '0,1,2,3,4,5,6,7,8,9,10', 'drawScene reports the step it drew');
  const horizon = 300 - PX.SEA_HEIGHT;
  const sunTop = steps.map(({ fills }) => {
    const ys = fills.filter((f) => f[0] === T.COLORS.sun && f[2] < horizon).map((f) => f[2]);
    return ys.length ? horizon - Math.min(...ys) : 0;
  });
  check(sunTop.every((v, k) => k === 0 || v < sunTop[k - 1]) && sunTop[0] === PX.SUN_RADIUS && sunTop[10] === 0,
    `the sun sinks each step and is below the horizon at dusk (height ${sunTop.join(',')})`);
  const stars = steps.map(({ fills }) => fills.filter((f) => f[0] === T.COLORS.star && f[3] === 1 && f[4] === 3).length);
  check(stars.slice(0, 8).every((n) => n === 0) && stars[8] > 0 && stars[9] > stars[8] && stars[10] > stars[9] && stars[10] <= 6,
    `a few white stars appear in the last steps only (${stars.join(',')})`);
  check(T.SEA_BANDS.length === 3 && T.DUSK.seaBands.length === 3, 'three sea bands at every step');
}

{
  // Readability, row B4 contrast pass (standard in tests/contrast.mjs and the
  // B4 changelog entry): every foreground against every scene colour drawn
  // behind it, at sunset and each of the 10 steps, on logical heights 240
  // (with and without a 10 px top inset), 300 and 400. No exceptions.
  // Backgrounds come from the real layout: the brick field (top to 12 rows
  // down), the paddle line (its sky bands and the sun), the ball (every sky
  // band, the clouds and the sun), the HUD (score, rally, back control), the
  // pause ring and its chevrons (the sea bands).
  const C = T.COLORS;
  const edge = T.edge || T.shade; // tokens before B4 had no edge
  const ink = C.ink || C.blue;
  const card = C.card || '#A0D0E8';
  const screens = [['H240', 240, 0], ['H240-safe', 240, 10], ['H300', 300, 0], ['H400', 400, 0]];
  const M = CT.pairs();
  for (const [tag, H, safeTop] of screens) {
    const horizon = H - PX.SEA_HEIGHT;
    const backY = 5 + safeTop;
    const geo = P.geometry(135, backY + 13 + 5, horizon);
    const bandsOver = (y0, y1) => {
      const out = [];
      for (let i = 0; i < T.SKY_BANDS; i++) {
        const a = Math.round((i * horizon) / T.SKY_BANDS);
        const b = Math.round(((i + 1) * horizon) / T.SKY_BANDS);
        if (a < y1 && b > y0) out.push(i);
      }
      return out;
    };
    const field = bandsOver(geo.top, geo.top + P.MAX_ROWS * P.ROW_H - P.GAP);
    const paddle = bandsOver(geo.paddleY, geo.paddleY + P.PADDLE_H);
    const all = bandsOver(geo.top, horizon);
    const hud = bandsOver(backY, backY + 16);
    for (let k = 0; k <= 10; k++) {
      const pal = T.scenePalette(k / 10);
      const sky = (ix) => ix.map((i) => [`sky band ${i + 1}`, pal.sky[i]]);
      const sun = k < 10 ? [['sun', C.sun]] : [];
      const sea = pal.sea.map((c, i) => [`sea band ${i + 1}`, c]);
      const add = (what, rule, fill, e, bgs) => { for (const [on, bg] of bgs) M.add(what, rule, fill, e, on, bg, { tag, k }); };
      T.BRICK_ROWS.forEach((c, i) => add(`brick row ${i + 1}`, 'de', c, null, sky(field)));
      add('paddle', 'cr', C.coral, edge(C.coral), [...sky(paddle), ...sun]);
      add('ball', 'cr', C.blue, null, [...sky(all), ...sun, ['cloud', C.cloud]]);
      add('score and rally', 'cr-small', ink, null, sky(hud));
      add('back control', 'cr', card, ink, sky(hud));
      add('pause ring', 'cr', C.cloud, ink, sea);
      add('pause chevrons', 'cr', C.cloud, ink, sea);
    }
  }
  const rows = M.rows;
  console.log(`  [readability] weakest at sunset: ${CT.fmt(CT.worst(rows.filter((r) => r.k === 0)))}`);
  console.log(`  [readability] weakest over the 10 steps: ${CT.fmt(CT.worst(rows.filter((r) => r.k > 0)))}`);
  for (const what of [...new Set(rows.map((r) => r.what))]) console.log(`  [readability] ${CT.fmt(CT.worst(rows.filter((r) => r.what === what)))}`);
  for (const u of rows.filter((r) => !r.ok)) console.log(`  [readability] UNDER: ${CT.fmt(u)}`);
  for (const [tag] of screens) {
    const mine = rows.filter((r) => r.tag === tag);
    for (const [rule, label] of [['cr', `paddle, ball, back control, pause ring and chevrons: contrast >= ${CT.MIN_CR} (fill or edge)`],
      ['cr-small', `score and rally: contrast >= ${CT.MIN_CR_SMALL}`],
      ['de', `bricks: fill delta E >= ${CT.MIN_DE}`]]) {
      const r = mine.filter((x) => x.rule === rule);
      check(r.length > 0 && r.every((x) => x.ok), `[${tag}] sunset and all 10 steps, ${label} (weakest ${CT.worst(r).v.toFixed(2)}, ${r.filter((x) => !x.ok).length} under)`);
    }
  }
  // Fixed pairs: the back chevron on its card (small, so 4.5).
  const chev = CT.contrast(ink, card);
  check(chev >= CT.MIN_CR_SMALL, `back chevron on its card: contrast ${chev.toFixed(2)} >= ${CT.MIN_CR_SMALL}`);
  // The nine brick colours are told apart from each other.
  let minPair = Infinity;
  let at = '';
  T.BRICK_ROWS.forEach((a, i) => T.BRICK_ROWS.forEach((b, j) => {
    if (j > i && CT.deltaE(a, b) < minPair) { minPair = CT.deltaE(a, b); at = `rows ${i + 1} and ${j + 1}`; }
  }));
  check(minPair >= CT.MIN_DE_BRICKS, `the nine brick colours are pairwise distinguishable: delta E >= ${CT.MIN_DE_BRICKS} (weakest ${minPair.toFixed(2)}, ${at})`);
  // What is measured is what is drawn: bricks.js draws with these colours.
  const src = bricksSrc.replace(/\/\/.*$/gm, '');
  check(/PADDLE_EDGE = edge\(COLORS\.coral\)/.test(src) && /pixelBody\(ctx, game\.paddleX[^;]*COLORS\.coral, 2, PADDLE_EDGE\)/.test(src),
    'bricks.js draws the paddle in coral with its edge all round');
  check(/pixelBody\(ctx, game\.ball\.x[^;]*COLORS\.blue, 1\)/.test(src), 'bricks.js draws the ball in the blue');
  check((src.match(/rects\.(score|rally), COLORS\.ink/g) || []).length === 2, 'bricks.js draws the score and rally in the ink');
  check(/disc\(RING_R \+ 1, COLORS\.ink\);\s*disc\(RING_R, COLORS\.cloud\);/.test(src)
    && (src.match(/drawTextOutlined\(ctx, '[<>]'[^;]*COLORS\.cloud, COLORS\.ink\)/g) || []).length === 2,
    'bricks.js draws the pause ring white in an ink ring, the chevrons white in an ink outline');
  const pxSrc = read('shared/pixel.js').replace(/\/\/.*$/gm, '');
  check(/pixelBody\(ctx, x, y \+ dy, BACK_SIZE\.w, BACK_SIZE\.h, COLORS\.card, 2, COLORS\.ink\)/.test(pxSrc)
    && /ctx\.fillStyle = COLORS\.ink;/.test(pxSrc), 'pixel.js draws the back control as a card in an ink edge with an ink chevron');
  check(hexIn(pxSrc).length === 0, 'no colour literals in pixel.js: tokens only');
}

{
  // theme.css mirrors tokens.js: every token value and name is in both.
  const css = read('shared/theme.css');
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const want = [
    ...Object.entries(T.COLORS).map(([k, v]) => [kebab(k), v]),
    ...T.BRICK_ROWS.map((v, i) => [`brick-${i + 1}`, v]),
    ...T.SEA_BANDS.map((v, i) => [`sea-${i + 1}`, v]),
    ['dusk-sky-top', T.DUSK.skyTop], ['dusk-sky-bottom', T.DUSK.skyBottom],
    ...T.DUSK.seaBands.map((v, i) => [`dusk-sea-${i + 1}`, v]),
  ];
  const missing = want.filter(([k, v]) => !new RegExp(`--${k}:\\s*${v};`, 'i').test(css));
  check(missing.length === 0, `shared/theme.css mirrors every token in shared/tokens.js (${missing.map(([k, v]) => `--${k} ${v}`).join(', ') || 'all'})`);
}

{
  // pixelBody with a rim: the edge runs all round inside the same w x h.
  const fills = [];
  const ctx = { fillStyle: '#000000', fillRect(x, y, w, h) { fills.push([this.fillStyle, x, y, w, h]); } };
  PX.pixelBody(ctx, 0, 0, 30, 6, '#111111', 2, '#222222');
  const px = new Map();
  for (const [c, x, y, w, h] of fills) for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) px.set(`${i},${j}`, c);
  const xs = [...px.keys()].map((k) => k.split(',').map(Number));
  const outer = xs.filter(([x, y]) => ['-1,0', '1,0', '0,-1', '0,1'].some((d) => { const [dx, dy] = d.split(',').map(Number); return !px.has(`${x + dx},${y + dy}`); }));
  check(Math.max(...xs.map((p) => p[0])) === 29 && Math.max(...xs.map((p) => p[1])) === 5 && Math.min(...xs.map((p) => p[0])) === 0,
    'pixelBody with a rim keeps its size (30 x 6)');
  check(outer.length > 0 && outer.every(([x, y]) => px.get(`${x},${y}`) === '#222222'), `pixelBody with a rim: every outer pixel is the rim (${outer.length})`);
  check([...px.values()].includes('#111111'), 'pixelBody with a rim: the body fills the inside');
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
