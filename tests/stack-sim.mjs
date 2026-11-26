#!/usr/bin/env node
// RLX row S1 headless checks: runs games/stack/sim.js in Node (PLAN §6d
// Accept). Not needed to run the app.
// Run: node tests/stack-sim.mjs
// Uses the play values from the CONFIG block of games/stack/stack.js, so it
// tests what ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../games/stack/sim.js';
import * as T from '../shared/tokens.js';
import * as SE from '../shared/session.js';
import * as CT from './contrast.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');
let passed = 0;
const fails = [];
let THEME_TAG = ''; // row D1: '[dark] ' while a check runs in the dark theme
function check(cond, msg) {
  msg = THEME_TAG + msg;
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (cond) passed++;
  else fails.push(msg);
}
const EPS = 1e-9;

/* ---------- the config block and the hard rules in the source ---------- */

const stackSrc = read('games/stack/stack.js');
const m = stackSrc.match(/export const CONFIG = Object\.freeze\((\{[\s\S]*?\})\);/);
const CONFIG = m ? Function(`return (${m[1]});`)() : null;
check(!!CONFIG, 'stack.js has one CONFIG block');
check(stackSrc.indexOf('export const CONFIG') < stackSrc.indexOf('import '), 'CONFIG block sits at the top of stack.js');
check(CONFIG && CONFIG.blockH === 8 && CONFIG.startW === 60 && CONFIG.maxW === 60 && CONFIG.resetW === 60 && CONFIG.minFloorW === 12
  && CONFIG.snapPx === 2 && CONFIG.regainPx === 2 && CONFIG.speedMin === 40 && CONFIG.speedStart === 50 && CONFIG.speedMax === 80
  && CONFIG.gainOverlap === 0.8 && CONFIG.gain === 1 && CONFIG.lossOverlap === 0.5 && CONFIG.loss === 8
  && CONFIG.hapticLandMs === 8 && CONFIG.hapticSnapMs === 16,
  `CONFIG holds the PLAN values ${JSON.stringify(CONFIG)}`);
const C = CONFIG;
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const simSrc = noComments(read('games/stack/sim.js'));
const domWords = /\b(document|window|navigator|localStorage|sessionStorage|indexedDB|requestAnimationFrame|HTMLElement|performance)\b/;
check(!domWords.test(simSrc) && !/\bimport\b/.test(simSrc), 'sim.js touches no DOM and imports nothing');
check(S.STEP_HZ === 120, 'the simulation steps at a fixed 120 Hz');
const code = noComments(stackSrc);
check(!/\b(localStorage|sessionStorage|indexedDB|document\.cookie|saveClock|caches)\b/.test(code)
  && !/store\.js|settings\.js/.test(code), 'stack.js writes nothing: no storage, no saveClock, no store.js or settings.js');
check(!/font\.js|drawFitted|drawText|fillText|drawBackControl|publishHits|dataset\.(hits|hud|layout)/.test(code),
  'stack.js draws no text, number, button or back control');
check(!/\btick\(|hapticsOn|navigator\.vibrate/.test(code) && (code.match(/\bsend\(/g) || []).length === 1 && /canVibrate\(\)/.test(code) && /MIN_GAP_MS/.test(code)
  && /buzz\(CONFIG\.hapticSnapMs\)/.test(code) && /buzz\(CONFIG\.hapticLandMs\)/.test(code) && (code.match(/\bbuzz\(/g) || []).length === 3,
  'stack.js vibrates in one place (buzz: whenever the device can, through shared/haptics.js send, native in the app or navigator.vibrate; the shared 40 ms limit, no setting read), for a landed and a near-perfect drop only');
check(!/Audio|AudioContext|\.play\(/.test(code), 'stack.js makes no sound');
check(/if \(!e\.isPrimary \|\| /.test(code), 'only the primary pointer drops the block (a second finger does nothing)');
check(/horizon: s\.H - SEA_HEIGHT/.test(code) && /SEA_HEIGHT \} from '\.\.\/\.\.\/shared\/pixel\.js'/.test(code), 'the horizon comes from the shared SEA_HEIGHT');
const hexIn = (src) => (src.match(/#[0-9A-Fa-f]{6}\b/g) || []);
check(hexIn(code).length === 0 && hexIn(simSrc).length === 0, 'no colour literals in the game: tokens only');
check(/reducedMotion\(\)/.test(code) && /r\.cut\.length && !reducedMotion\(\)/.test(code), 'overhang bits only without reduced motion');
check(/addPlay\(clock/.test(code) && /sessionClock\(\)/.test(code) && !/saveClock|readClock/.test(code)
  && /clockWasReset\(\) && game\) S\.resetPace/.test(code), 'stack.js uses the one shared clock in memory and restarts the pace when it resets (row X1)');

/* ---------- helpers ---------- */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const geoOf = (H) => ({ W: 135, H, horizon: H - 42 });
const clone = (x) => JSON.parse(JSON.stringify(x));
function allFinite(o) {
  if (typeof o === 'number') return Number.isFinite(o);
  if (o && typeof o === 'object') return Object.values(o).every(allFinite);
  return true;
}
/** Move the sliding block so its centre is at cx (a test shortcut; the drop logic is what is tested). */
function placeAt(s, cx) {
  s.block.x = cx - s.block.w / 2;
}
const centre = (f) => f.x + f.w / 2;
/** Run steps until the missed block is back sliding. */
function untilBack(s, slow = 0) {
  let ev = 0;
  let n = 0;
  while (s.block.mode !== 'slide' && n < S.STEP_HZ * 10) { ev |= S.step(s, C, slow); n++; }
  return { ev, n };
}

/* ---------- unit checks ---------- */

{
  const s = S.create(geoOf(300), C);
  const f = s.floors[0];
  check(s.floors.length === 1 && f.w === 60 && Math.abs(centre(f) - 67.5) < EPS && S.floorTop(s, C, 0) === 258 - 8,
    'a new tower: the first floor, 60 wide, centred, standing on the horizon');
  check(s.pace === 50 && s.block.speed === 50 && s.block.w === 60 && s.block.mode === 'slide' && s.block.i === 1
    && S.blockTop(s, C) === 258 - 16 && s.block.x === 75 && s.block.dir === -1,
    'the first block: the floor\'s width, at the height of the next floor, at the right wall (blocks alternate walls), sliding at 50');
  // Wall to wall and back.
  let xmin = Infinity;
  let xmax = -Infinity;
  let turns = 0;
  let dir = s.block.dir;
  for (let i = 0; i < S.STEP_HZ * 6; i++) {
    S.step(s, C, 0);
    xmin = Math.min(xmin, s.block.x);
    xmax = Math.max(xmax, s.block.x);
    if (s.block.dir !== dir) { turns++; dir = s.block.dir; }
  }
  check(xmin >= 0 && xmax <= 75 + EPS && xmin < 1 && xmax > 74 && turns >= 3, `the block slides from wall to wall and back (x ${xmin.toFixed(2)} to ${xmax.toFixed(2)}, ${turns} turns in 6 s)`);
  const s2 = S.create(geoOf(300), C);
  const x0 = s2.block.x;
  S.step(s2, C, 0);
  check(Math.abs(x0 - s2.block.x - 50 / 120) < 1e-9, 'it slides at its speed, 50 px/s');
}

{
  // Near-perfect: within 2 px of aligned, centre over centre.
  for (const d of [0, 1.5, 2, -2]) {
    const s = S.create(geoOf(300), C);
    s.floors[0] = { x: 40, w: 50 };
    s.block.w = 50;
    placeAt(s, 65 + d);
    const r = S.drop(s, C, 0);
    const f = s.floors[1];
    check(r.kind === 'snap' && r.cut.length === 0 && f.w === 50 && Math.abs(centre(f) - 65) < EPS && s.block.w === 52 && s.pace === 51,
      `near-perfect at ${d} px: snaps into line, nothing breaks off, the next block 2 px wider (52), pace +1`);
  }
  const s = S.create(geoOf(300), C);
  placeAt(s, 67.5 + 1);
  const r = S.drop(s, C, 0);
  check(r.kind === 'snap' && s.block.w === 60, 'near-perfect at full width: the next block stays at 60');
  const s3 = S.create(geoOf(300), C);
  s3.floors[0] = { x: 40, w: 50 };
  s3.block.w = 52;
  placeAt(s3, 65.5);
  S.drop(s3, C, 0);
  check(s3.floors[1].w === 52 && Math.abs(centre(s3.floors[1]) - 65) < EPS, 'a regrown block snaps whole over a narrower floor (centre over centre)');
  const s4 = S.create(geoOf(300), C);
  s4.floors[0] = { x: 40, w: 50 };
  s4.block.w = 50;
  placeAt(s4, 65 + 2.01);
  check(S.drop(s4, C, 0).kind === 'land', 'just over 2 px off: no snap, it is cut');
}

{
  // A landed drop with an overhang: the part over the floor stays, the rest breaks off.
  const s = S.create(geoOf(300), C);
  placeAt(s, 67.5 + 10); // block 47.5..107.5 over 37.5..97.5
  const r = S.drop(s, C, 0);
  const f = s.floors[1];
  check(r.kind === 'land' && Math.abs(f.x - 47.5) < EPS && Math.abs(f.w - 50) < EPS && r.cut.length === 1
    && Math.abs(r.cut[0].x - 97.5) < EPS && Math.abs(r.cut[0].w - 10) < EPS && s.block.w === f.w && s.block.i === 2,
    'a landed drop keeps the overlap; the overhang breaks off; the next block has the new floor\'s width');
  check(Math.abs(r.ratio - 50 / 60) < EPS && s.pace === 51, 'overlap 83 percent: pace +1');
}

{
  // Pace rules, at their limits.
  const at = (ratio, pace = 60) => {
    const s = S.create(geoOf(300), C);
    s.pace = pace;
    const off = 60 * (1 - ratio);
    placeAt(s, 67.5 + off);
    const r = S.drop(s, C, 0);
    return { s, r };
  };
  let a = at(0.8);
  check(a.r.kind === 'land' && a.s.pace === 61, `80 percent overlap adds 1 (${a.s.pace})`);
  a = at(0.79);
  check(a.s.pace === 60, `79 percent overlap: no change (${a.s.pace})`);
  a = at(0.5);
  check(a.s.pace === 60, `50 percent overlap: no change (${a.s.pace})`);
  a = at(0.49);
  check(a.s.pace === 52, `under 50 percent: takes off 8 (${a.s.pace})`);
  a = at(0.49, 45);
  check(a.s.pace === 40, `the pace never goes under 40 (${a.s.pace})`);
  a = at(1, 80);
  check(a.s.pace === 80, `the pace never goes over 80 (${a.s.pace})`);
  // A new speed applies from the next block.
  const s = S.create(geoOf(300), C);
  s.pace = 60;
  s.block.speed = 60;
  placeAt(s, 67.5 + 40);
  S.drop(s, C, 0);
  check(s.pace === 52 && s.block.speed === 52, 'the new speed applies to the next block');
  const s2 = S.create(geoOf(300), C);
  s2.pace = 70;
  s2.block.speed = 70;
  S.resetPace(s2, C);
  check(s2.pace === 50 && s2.block.speed === 70, 'a clock reset starts the pace at 50; the block already sliding keeps its speed');
  placeAt(s2, 67.5);
  S.drop(s2, C, 0);
  check(s2.block.speed === 51, 'the next block after a reset slides at 50 plus its gain');
}

{
  // The dusk ceiling: 80 down to 40 over minutes 10 to 12, the speed follows it down.
  check(S.ceilingOf(C, 0) === 80 && S.ceilingOf(C, 0.5) === 60 && S.ceilingOf(C, 1) === 40 && S.ceilingOf(C, 2) === 40 && S.ceilingOf(C, -1) === 80,
    'the ceiling falls from 80 to 40 as the slowdown goes 0 to 1');
  const s = S.create(geoOf(300), C);
  s.pace = 80;
  s.block.speed = 80;
  S.step(s, C, 0.5);
  check(s.block.speed === 60 && s.pace === 60, 'a sliding block\'s speed follows the falling ceiling down at once (80 -> 60)');
  for (let i = 0; i < 100; i++) S.step(s, C, 1);
  check(s.block.speed === 40 && s.pace === 40, 'and down to 40');
  placeAt(s, 67.5);
  S.drop(s, C, 1);
  check(s.pace === 40 && s.block.speed === 40, 'the next block takes the fallen ceiling (40); a gain cannot lift it over');
  // A block that starts at 80 and is never tapped: 40 by minute 12, still 40 through minute 13.
  const s2 = S.create(geoOf(300), C);
  s2.pace = 80;
  s2.block.speed = 80;
  let bad = 0;
  let at12 = null;
  let after = true;
  for (let n = 0; n <= 13 * 60 * S.STEP_HZ; n++) {
    const t = n / S.STEP_HZ;
    const sl = SE.slowdownOf(t);
    S.step(s2, C, sl);
    if (s2.pace < 40 || s2.pace > 80 || s2.block.speed < 40 || s2.block.speed > 80 || s2.block.speed > S.ceilingOf(C, sl) + EPS) bad++;
    if (n === 12 * 60 * S.STEP_HZ) at12 = s2.block.speed;
    if (t > 720 && (s2.block.speed !== 40 || s2.pace !== 40)) after = false;
  }
  check(bad === 0 && at12 === 40 && after && s2.block.speed === 40,
    `a block that starts at 80 and is never tapped slides at 40 by minute 12 and through minute 13; pace and speed stay in range and under the ceiling (${bad} bad steps)`);
  check(SE.slowdownOf(600) === 0 && SE.slowdownOf(660) === 0.5 && SE.slowdownOf(720) === 1, 'the shared slowdown runs over minutes 10 to 12');
}

{
  // Complete miss: the block plops into the sea, the same block comes back, only the pace changes.
  const s = S.create(geoOf(300), C);
  s.floors[0] = { x: 50, w: 20 };
  s.block.w = 20;
  s.pace = 60;
  for (let i = 0; i < 30; i++) S.step(s, C, 0);
  placeAt(s, 10);
  const before = clone(s);
  const r = S.drop(s, C, 0);
  check(r.kind === 'miss' && r.cut.length === 0 && s.block.mode === 'fall' && s.pace === 52, 'no overlap at all: a complete miss, pace -8');
  check(S.drop(s, C, 0) === null, 'a tap while the missed block falls does nothing');
  let plop = 0;
  let n = 0;
  while (s.block.mode === 'fall' && n < 2000) { plop |= S.step(s, C, 0) & S.EV_PLOP; n++; }
  check(plop && s.block.mode === 'gone' && S.blockTop(s, C) >= s.horizon, 'it falls into the sea (plop)');
  const back = untilBack(s);
  const after = clone(s);
  const keys = ['floors', 'base', 'shifts', 'cam', 'W', 'H', 'horizon'];
  check(back.ev & S.EV_RETURN && keys.every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k]))
    && after.block.i === before.block.i && after.block.w === before.block.w && after.block.fresh === before.block.fresh
    && after.block.mode === 'slide' && after.pace === 52 && after.block.speed === 52,
    'the same block comes back (same floor, width and colour) at the new speed; the tower, camera and width are unchanged');
  check(after.block.x === (before.block.i % 2 === 0 ? 0 : 135 - 20) && after.block.dir === (before.block.i % 2 === 0 ? 1 : -1),
    'it comes back from the wall it started at');
  // Touching edges is still a miss.
  const s2 = S.create(geoOf(300), C);
  s2.floors[0] = { x: 50, w: 20 };
  s2.block.w = 20;
  s2.block.x = 30;
  check(S.drop(s2, C, 0).kind === 'miss', 'a block that only touches the floor\'s edge is a complete miss');
}

{
  // A floor narrower than 12 px: the next block is 60 wide and lands whole as a fresh platform.
  const s = S.create(geoOf(300), C);
  s.floors[0] = { x: 50, w: 20 };
  s.block.w = 20;
  s.pace = 60;
  placeAt(s, 60 + 9); // overlap 11
  const r = S.drop(s, C, 0);
  check(r.kind === 'land' && Math.abs(s.floors[1].w - 11) < EPS && s.block.w === 60 && s.block.fresh === true,
    'a floor of 11 px: the next block is 60 px wide');
  const pace = s.pace;
  s.block.x = 0; // nowhere near the narrow floor
  const r2 = S.drop(s, C, 0);
  check(r2.kind === 'fresh' && r2.cut.length === 0 && s.floors[2].w === 60 && s.floors[2].x === 0 && s.pace === pace
    && s.block.w === 60 && !s.block.fresh, 'it lands whole wherever it is dropped, as a fresh platform; the pace is unchanged; the next block is 60');
  const s3 = S.create(geoOf(300), C);
  s3.floors[0] = { x: 50, w: 20 };
  s3.block.w = 20;
  placeAt(s3, 60 + 8); // overlap 12
  S.drop(s3, C, 0);
  check(Math.abs(s3.floors[1].w - 12) < EPS && s3.block.w === 12 && !s3.block.fresh, 'a floor of exactly 12 px is not reset');
  const s4 = S.create(geoOf(300), C);
  s4.floors[0] = { x: 50, w: 13 };
  s4.block.w = 13;
  placeAt(s4, 56.5 + 1);
  S.drop(s4, C, 0);
  check(s4.floors[1].w === 13 && s4.block.w === 15 && !s4.block.fresh, 'a near-perfect drop keeps a narrow floor whole');
}

{
  // Camera: once the top passes the middle, every drop slides the tower down one floor.
  for (const H of [240, 300, 400]) {
    const s = S.create(geoOf(H), C);
    let firstShift = -1;
    let ok = true;
    for (let k = 0; k < 120; k++) {
      placeAt(s, centre(S.topFloor(s)));
      const shifts = s.shifts;
      S.drop(s, C, 0);
      for (let i = 0; i < 40; i++) S.step(s, C, 0);
      if (s.shifts > shifts && firstShift < 0) firstShift = S.topIndex(s);
      if (firstShift >= 0 && S.topIndex(s) > firstShift && s.shifts !== shifts + 1) ok = false;
      if (S.floorTop(s, C, S.topIndex(s)) < H / 2 - EPS || S.blockTop(s, C) < 0) ok = false;
    }
    let expect = 0;
    while (H - 42 - (expect + 1) * 8 >= H / 2) expect++;
    check(ok && firstShift === expect && s.floors.length <= Math.ceil(H / 8) + 4 && s.cam === s.shifts * 8,
      `H ${H}: the camera starts at floor ${firstShift} (top past the middle), then slides one floor per drop; the top stays at or below the middle; ${s.floors.length} floors kept`);
  }
  const s = S.create(geoOf(300), C);
  for (let k = 0; k < 40; k++) { placeAt(s, centre(S.topFloor(s))); S.drop(s, C, 0); }
  S.step(s, C, 0, true);
  check(s.cam === s.shifts * 8, 'with reduced motion the camera jumps');
  const s2 = S.create(geoOf(300), C);
  for (let k = 0; k < 40; k++) { placeAt(s2, centre(S.topFloor(s2))); S.drop(s2, C, 0); }
  let steps = 0;
  const cam0 = s2.cam;
  while (s2.cam !== s2.shifts * 8 && steps < 10000) { S.step(s2, C, 0); steps++; }
  check(steps > 1 && (s2.shifts * 8 - cam0) / steps <= C.camSpeed / 120 + EPS, `the camera slides at ${C.camSpeed} px/s`);
  // Resize keeps the tower and its top at or below the middle.
  S.resize(s2, C, geoOf(240));
  check(S.floorTop(s2, C, S.topIndex(s2)) >= 120 && s2.horizon === 198 && s2.cam === s2.shifts * 8, 'a resize keeps the tower, its top at or below the middle');
  // Resizes after 60 settled floors: the lowest kept floor always reaches the horizon (no tower floating
  // above the sea), no floor that should show is lost, the top stays on the screen.
  for (const seq of [[240, 400, 240], [300, 640, 300], [240, 889, 240], [400, 240, 400]]) {
    const t = S.create(geoOf(seq[0]), C);
    for (let k = 0; k < 60; k++) {
      placeAt(t, centre(S.topFloor(t)) + (k % 3) * 1.5);
      S.drop(t, C, 0);
      for (let i = 0; i < 40; i++) S.step(t, C, 0);
    }
    let topBefore = S.topIndex(t);
    const errs = [];
    for (const H of seq.slice(1)) {
      S.resize(t, C, geoOf(H));
      for (let i = 0; i < 10; i++) S.step(t, C, 0);
      const lowBottom = S.floorTop(t, C, t.base) + C.blockH;
      if (lowBottom < t.horizon) errs.push(`H ${H}: lowest kept floor ends at ${lowBottom}, above the horizon ${t.horizon}`);
      if (S.topIndex(t) !== topBefore || t.floors.length !== S.topIndex(t) - t.base + 1) errs.push(`H ${H}: floors lost from the top`);
      for (let i = t.base; i <= S.topIndex(t); i++) if (!(t.floors[i - t.base].w > 0)) errs.push(`H ${H}: floor ${i} missing`);
      if (S.blockTop(t, C) < 0 || S.floorTop(t, C, S.topIndex(t)) < 0) errs.push(`H ${H}: off the top`);
      if (t.cam !== t.shifts * 8) errs.push(`H ${H}: camera not settled`);
      // Then play on at the new size: the rules still hold.
      for (let k = 0; k < 5; k++) {
        placeAt(t, centre(S.topFloor(t)));
        S.drop(t, C, 0);
        for (let i = 0; i < 40; i++) S.step(t, C, 0);
        if (S.floorTop(t, C, t.base) + C.blockH < t.horizon || S.blockTop(t, C) < 0) errs.push(`H ${H}: play after resize`);
      }
      topBefore = S.topIndex(t);
    }
    check(!errs.length, `60 floors, resize ${seq.join(' -> ')}: the lowest kept floor reaches the horizon, nothing that should show is lost ${errs.slice(0, 3)}`);
  }
}

/* ---------- 15 simulated minutes with a player tapping with varying accuracy ---------- */

function mulberry(seed) {
  return () => {
    let t = (seed = (seed + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run15(H, seed) {
  const rnd = mulberry(seed);
  const s = S.create(geoOf(H), C);
  const st = { nan: 0, widthOut: 0, paceOut: 0, speedOut: 0, overCeil: 0, offTop: 0, resetBad: 0, missBad: 0, freshCount: 0,
    kinds: { snap: 0, land: 0, miss: 0, fresh: 0 }, after12: [], maxFloors: 0, paceMin: Infinity, paceMax: -Infinity, speeds: new Set() };
  const total = 15 * 60 * S.STEP_HZ;
  let plan = null;
  let blockKey = '';
  let needFresh = false;
  let prevSlow = 0; // the slowdown when the block now sliding was set going (the step before)
  for (let n = 0; n < total; n++) {
    const t = n / S.STEP_HZ;
    const slow = SE.slowdownOf(t);
    const b = s.block;
    const key = `${b.i}:${b.mode === 'slide'}`;
    if (key !== blockKey) {
      blockKey = key;
      if (b.mode === 'slide') {
        // A fresh slide: its speed was set now, against the ceiling now.
        if (b.speed > S.ceilingOf(C, Math.min(prevSlow, slow)) + EPS) st.overCeil++;
        if (t >= 720) st.after12.push(b.speed);
        st.speeds.add(b.speed);
        if (needFresh && !(b.w === 60 && b.fresh)) st.resetBad++;
        needFresh = false;
        // The player: mostly careful, sometimes sloppy, now and then wild (some complete misses);
        // and from time to time a long run of careless taps.
        const sloppy = Math.floor(t / 60) % 4 === 3;
        const u = rnd();
        let err;
        if (sloppy) err = (rnd() - 0.5) * 2 * (b.w * (0.4 + rnd()));
        else if (u < 0.35) err = (rnd() - 0.5) * 3.6;
        else if (u < 0.7) err = (rnd() - 0.5) * 2 * (2 + rnd() * 8);
        else if (u < 0.92) err = (rnd() - 0.5) * 2 * (8 + rnd() * 22);
        else err = (rnd() < 0.5 ? -1 : 1) * (b.w + 2 + rnd() * 10);
        plan = { target: centre(S.topFloor(s)) + err, ready: t + 0.4 + rnd() * 2.5, giveUp: t + 12 };
      }
    }
    const prev = b.x + b.w / 2;
    S.step(s, C, slow);
    const now = s.block.x + s.block.w / 2;
    if (s.block.mode === 'slide' && plan && t >= plan.ready) {
      const crossed = (prev - plan.target) * (now - plan.target) <= 0;
      if (crossed || t >= plan.giveUp) {
        const before = clone(s);
        const r = S.drop(s, C, slow);
        st.kinds[r.kind]++;
        if (r.kind === 'miss') {
          const keys = ['floors', 'base', 'shifts', 'cam'];
          const same = keys.every((k) => JSON.stringify(s[k]) === JSON.stringify(before[k]))
            && s.block.i === before.block.i && s.block.w === before.block.w && s.block.fresh === before.block.fresh;
          if (!same || s.pace !== Math.max(C.speedMin, before.pace - 8)) st.missBad++;
        } else {
          const f = S.topFloor(s);
          if (f.w < 12) { needFresh = true; st.freshCount++; }
        }
        plan = null;
      }
    }
    prevSlow = slow;
    if (!allFinite(s)) st.nan++;
    for (const f of s.floors) if (!(f.w > 0 && f.w <= 60 + EPS) || f.x < -EPS || f.x + f.w > 135 + EPS) st.widthOut++;
    if (!(s.block.w > 0 && s.block.w <= 60)) st.widthOut++;
    if (s.pace < 40 || s.pace > 80) st.paceOut++;
    if (s.block.speed < 40 || s.block.speed > 80) st.speedOut++;
    st.paceMin = Math.min(st.paceMin, s.pace);
    st.paceMax = Math.max(st.paceMax, s.pace);
    if (S.blockTop(s, C) < 0 || S.floorTop(s, C, S.topIndex(s)) < 0) st.offTop++;
    st.maxFloors = Math.max(st.maxFloors, s.floors.length);
  }
  st.final = s;
  return st;
}

for (const [H, seed] of [[240, 1], [300, 2], [340, 3], [400, 4]]) {
  const st = run15(H, seed);
  const tag = `15 min, H ${H}`;
  const k = st.kinds;
  check(st.nan === 0, `[${tag}] no NaN`);
  check(st.widthOut === 0, `[${tag}] every width stays between 0 and 60, every floor on the screen`);
  check(st.paceOut === 0 && st.speedOut === 0 && st.overCeil === 0,
    `[${tag}] pace and slide speed stay within 40 to 80 and never over the dusk ceiling (pace ${st.paceMin} to ${st.paceMax})`);
  check(st.after12.length > 5 && st.after12.every((v) => v === 40), `[${tag}] from minute 12 every block slides at 40 (${st.after12.length} blocks)`);
  check(st.final.pace === 40, `[${tag}] the pace is 40 at minute 15`);
  check(st.offTop === 0, `[${tag}] the tower never grows off the top of the screen`);
  check(st.resetBad === 0 && st.freshCount > 0, `[${tag}] a floor narrower than 12 px is always followed by a 60 px block (${st.freshCount} times)`);
  check(st.missBad === 0 && k.miss > 0, `[${tag}] a complete miss changes nothing but the pace (${k.miss} misses)`);
  check(k.snap > 20 && k.land > 20 && k.fresh > 0, `[${tag}] every kind of drop happened (${JSON.stringify(k)})`);
  check(st.maxFloors <= Math.ceil(H / 8) + 4, `[${tag}] floors kept in memory stay bounded (${st.maxFloors})`);
  check(st.speeds.size > 5, `[${tag}] the pace moved (${st.speeds.size} different speeds)`);
}

/* ---------- readability (the B4 standard, sunset and all 10 steps) ---------- */

for (const THEME of [T.LIGHT, T.DARK]) {
  // Row D1: every readability check runs in both themes (the Node checks have no colour scheme: forced).
  T.forceTheme(THEME);
  THEME_TAG = THEME === T.DARK ? '[dark] ' : '';

  check(/const FLOORS = BRICK_ROWS;/.test(stackSrc) && /pixelBody\(ctx, x0, yy, dw, CONFIG\.blockH, colour, dw >= 10 \? 2 : 1, edge\(colour\)\)/.test(stackSrc)
    && /steppedRect\(ctx, x0, yy, dw, CONFIG\.blockH, edge\(colour\), 1\)/.test(stackSrc)
    && /ctx\.fillStyle = edge\(b\.c\);/.test(stackSrc) && /const splashColour = \(\) => COLORS\.white;/.test(stackSrc),
    'stack.js draws with the colours measured here (floors in the brick rows in their edge, bits with an edge row, the splash white)');
  const P = CT.pairs();
  for (let k = 0; k <= SE.SESSION.sceneSteps; k++) {
    const pal = T.scenePalette(k / SE.SESSION.sceneSteps);
    const where = { k, tag: 'stack' };
    // The block slides and the tower stands anywhere in the sky (and the bits fall through it): every sky band,
    // the sun (until it is down), the clouds and the stars.
    const behind = [...pal.sky.map((c, i) => [`sky band ${i + 1}`, c]), ['cloud', T.COLORS.cloud], ['star', T.COLORS.star]];
    if (k < SE.SESSION.sceneSteps) behind.push(['sun', T.COLORS.sun]);
    T.BRICK_ROWS.forEach((c, i) => {
      for (const [on, bg] of behind) {
        P.add(`floor ${i + 1}`, 'de', c, T.edge(c), on, bg, where);
        P.add(`bit ${i + 1}`, 'de', c, T.edge(c), on, bg, where);
      }
    });
    for (let i = 0; i < 3; i++) P.add('splash', 'de', T.COLORS.white, null, `sea band ${i + 1}`, pal.sea[i], where);
  }
  const under = P.rows.filter((x) => !x.ok);
  const w = CT.worst(P.rows);
  check(!under.length, `floors, bits and the splash meet the B4 standard at sunset and every step `
    + `(weakest ${CT.fmt(w)}) ${under.slice(0, 3).map(CT.fmt)}`);
  // Floor next to floor: the edge between them carries every pair.
  const pairsBad = [];
  for (const a of T.BRICK_ROWS) for (const b of T.BRICK_ROWS) if (a !== b && CT.deltaE(T.edge(a), b) < CT.MIN_DE) pairsBad.push([a, b]);
  check(!pairsBad.length, `a floor's edge stands off the next floor's fill (delta E >= ${CT.MIN_DE}) ${JSON.stringify(pairsBad.slice(0, 3))}`);
  T.forceTheme(null);
  THEME_TAG = '';
}

console.log(`\n${passed + fails.length} checks, ${fails.length} failure(s)`);
process.exit(fails.length ? 1 : 0);
