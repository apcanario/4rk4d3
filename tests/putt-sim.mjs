#!/usr/bin/env node
// RLX row U1 headless checks: runs games/putt/sim.js and games/putt/gen.js in
// Node (PLAN §6c Accept). Not needed to run the app.
// Run: node tests/putt-sim.mjs
// Uses the play values from the CONFIG block of games/putt/putt.js and the
// generator values from GEN in games/putt/gen.js, so it tests what ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../games/putt/sim.js';
import * as G from '../games/putt/gen.js';
import * as T from '../shared/tokens.js';
import * as SE from '../shared/session.js';
import * as CT from './contrast.mjs';
import * as HAPTICS from '../shared/haptics.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');
let passed = 0;
const fails = [];
function check(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (cond) passed++;
  else fails.push(msg);
}
const EPS = 1e-6;

/* ---------- the config blocks and the hard rules in the source ---------- */

const puttSrc = read('games/putt/putt.js');
const m = puttSrc.match(/export const CONFIG = Object\.freeze\((\{[\s\S]*?\})\);/);
const CONFIG = m ? Function(`return (${m[1]});`)() : null;
check(!!CONFIG, 'putt.js has one CONFIG block');
check(puttSrc.indexOf('export const CONFIG') < puttSrc.indexOf('import '), 'CONFIG block sits at the top of putt.js');
check(CONFIG && CONFIG.launchSpeed === 220 && CONFIG.decel === 55 && CONFIG.stopSpeed === 4 && CONFIG.bounce === 0.85
  && CONFIG.sandFactor === 3 && CONFIG.captureSpeed === 140 && CONFIG.pullCapPx === 60 && CONFIG.cancelPx === 4
  && CONFIG.hapticReleaseMs === 10 && CONFIG.hapticBounceMs === 6 && CONFIG.hapticSinkMs === 24
  && CONFIG.idleS === 10 && CONFIG.guideAfterPx === 12 && Math.abs(CONFIG.nextLevelMs - 800) <= 100,
  `CONFIG holds the PLAN values ${JSON.stringify(CONFIG)}`);
const PLAY = CONFIG;
const genSrc = read('games/putt/gen.js');
check(genSrc.indexOf('export const GEN') < genSrc.indexOf('import '), 'GEN block sits at the top of gen.js');
const TB = G.GEN.table;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check(same(TB[1], { cuts: [0, 2], bars: [0, 1], diags: [0, 1], blocks: [1, 2], pegs: [0, 0], traps: [0, 0], water: [0, 0], holeR: 5, straight: true, strokes: [1, 2] })
  && same(TB[2], { cuts: [1, 3], bars: [1, 2], diags: [1, 2], blocks: [1, 3], pegs: [0, 2], traps: [0, 1], water: [0, 1], holeR: 5, straight: false, strokes: [2, 3] })
  && same(TB[3], { cuts: [2, 4], bars: [2, 3], diags: [2, 3], blocks: [2, 4], pegs: [1, 3], traps: [0, 1], water: [1, 1], holeR: 4, straight: false, strokes: [3, 4] }),
  'GEN.table is the PLAN §6c table');
check(same(G.GEN.cutSize, [10, 24]) && G.GEN.barGapMin === 22 && same(G.GEN.diagLen, [20, 50]) && same(G.GEN.blockW, [8, 24])
  && same(G.GEN.blockH, [8, 12]) && S.PEG_R === 3 && same(G.GEN.hazardSide, [16, 30]) && G.GEN.passageMin === 14
  && G.GEN.clearTeeHole === 12 && G.GEN.solverDirs === 96 && G.GEN.solverPowers === 5 && G.GEN.solverBeam === 12
  && G.GEN.rejectLimit === 30 && G.GEN.teeSpreadPx === 20 && G.GEN.holeZone === 0.2 && G.GEN.insetX === 6
  && G.GEN.insetTop === 6 && G.GEN.insetBottom === 26, 'GEN holds the PLAN building blocks, solver sampling and reject limit');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const simSrc = noComments(read('games/putt/sim.js'));
const genCode = noComments(genSrc);
const domWords = /\b(document|window|navigator|localStorage|sessionStorage|indexedDB|requestAnimationFrame|HTMLElement)\b/;
check(!domWords.test(simSrc) && !/\bimport\b/.test(simSrc), 'sim.js touches no DOM and imports nothing');
check(!domWords.test(genCode) && (genCode.match(/\bfrom '([^']+)'/g) || []).every((s) => s.includes("'./sim.js'")), 'gen.js touches no DOM and imports only sim.js');
check(S.STEP_HZ === 120, 'the simulation steps at a fixed 120 Hz');
const puttCode = noComments(puttSrc);
check(!/\b(localStorage|sessionStorage|indexedDB|document\.cookie|saveClock|caches)\b/.test(puttCode)
  && !/store\.js|settings\.js/.test(puttCode), 'putt.js writes nothing: no storage, no saveClock, no store.js or settings.js');
check(!/font\.js|drawFitted|drawText|fillText|drawBackControl/.test(puttCode), 'putt.js draws no text, number or back control');
check(/const clock = sessionClock\(\)/.test(puttCode) && /addPlay\(clock/.test(puttCode) && !/readClock|beginPlay|isStale/.test(puttCode),
  'putt.js advances the one shared session clock in memory (row X1)');
check(!/\btick\(|hapticsOn/.test(puttCode) && (puttCode.match(/navigator\.vibrate\(/g) || []).length === 1
  && /MIN_GAP_MS/.test(puttCode) && (puttCode.match(/\bbuzz\(CONFIG\.haptic/g) || []).length === 3,
  'putt.js vibrates in one place (buzz: whenever navigator.vibrate exists, the shared 40 ms limit, no setting read), for release, bounce and sink');
check(!/Audio|AudioContext|\.play\(/.test(puttCode), 'putt.js makes no sound');
const hexIn = (src) => (src.match(/#[0-9A-Fa-f]{6}\b/g) || []);
check(hexIn(puttCode).length === 0 && hexIn(simSrc).length === 0 && hexIn(genCode).length === 0, 'no colour literals in the game: tokens only');
check(/new Worker\(new URL\('\.\/gen\.js', import\.meta\.url\), \{ type: 'module' \}\)/.test(puttCode) && /WorkerGlobalScope/.test(genCode),
  'the next level is built in a module Web Worker running gen.js (static ES modules, no build step)');
check(/generateSteps/.test(puttCode) && /yield/.test(genCode), 'with no worker, levels are built in small slices (generateSteps yields)');

/* ---------- helpers ---------- */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const HEIGHTS = [240, 270, 300, 340, 400];
const planesOf = (L) => S.halfPlanes(L.poly);

/** Every placement rule of PLAN §6c; returns a list of what is broken. */
function placementErrors(L) {
  const err = [];
  const T = TB[L.diff];
  const planes = planesOf(L);
  const box = G.courseBox(L.H, L.top, L.bottom);
  if (L.x0 !== box.x0 || L.x1 !== box.x1 || L.y0 !== box.y0 || L.y1 !== box.y1) err.push('course box');
  if (L.x0 - S.WALL_T !== 6 || L.x1 + S.WALL_T !== 129 || L.y0 - S.WALL_T !== 6 + L.top || L.y1 + S.WALL_T !== L.H - 26 - L.bottom) err.push('course insets');
  const nc = L.cuts.filter((c) => c > 0).length;
  if (!L.fallback && (nc < T.cuts[0] || nc > T.cuts[1])) err.push(`cut count ${nc}`);
  if (L.cuts.some((c) => c !== 0 && (c < 10 || c > 24))) err.push('cut size');
  if (Math.abs(L.tee.x - 67.5) > 20 || L.tee.y < L.y1 - 12 || L.tee.y > L.y1 - S.BALL_R) err.push('tee');
  if (L.hole.r !== T.holeR) err.push('hole radius');
  if (L.hole.y > L.y0 + (L.y1 - L.y0) * 0.2 || S.insideDist(planes, L.hole.x, L.hole.y) < L.hole.r) err.push('hole outside the top fifth');
  const counts = { bars: L.bars.length, diags: L.diags.length, blocks: L.blocks.length, pegs: L.pegs.length, traps: L.traps.length, water: L.water.length };
  if (!L.fallback) for (const [k, n] of Object.entries(counts)) if (n < T[k][0] || n > T[k][1]) err.push(`${k} count ${n}`);
  for (const d of L.diags) {
    const len = Math.hypot(d.bx - d.ax, d.by - d.ay);
    if (Math.abs(Math.abs(d.bx - d.ax) - Math.abs(d.by - d.ay)) > EPS || len < 20 - EPS || len > 50 + EPS) err.push(`diagonal ${len.toFixed(1)}`);
  }
  for (const b of L.blocks) if (b.w < 8 || b.w > 24 || b.h < 8 || b.h > 12) err.push('block size');
  for (const t of [...L.traps, ...L.water]) if (t.w < 16 || t.w > 30 || t.h < 16 || t.h > 30) err.push('hazard size');
  const solids = G.solidPieces(L);
  const hazards = G.hazardPieces(L);
  const tee = S.shapeOf({ k: 'disc', x: L.tee.x, y: L.tee.y, r: S.BALL_R });
  const hole = S.shapeOf({ k: 'disc', x: L.hole.x, y: L.hole.y, r: L.hole.r });
  for (const p of [...solids, ...hazards]) {
    if (S.shapeDist(p.shape, tee) < 12 - EPS || S.shapeDist(p.shape, hole) < 12 - EPS) err.push(`${p.kind} within 12 px of the tee or hole`);
  }
  // Passages: solid to solid, and solid to wall, at least 14 px (a bar is joined to its own wall and leaves a gap of 22).
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const d = S.shapeDist(solids[i].shape, solids[j].shape);
      if (d < 14 - EPS) err.push(`passage ${solids[i].kind}-${solids[j].kind} ${d.toFixed(1)}`);
    }
    const p = solids[i];
    if (p.kind === 'bar') {
      const side = p.piece.side === 0 ? L.x0 : L.x1;
      for (const e of planes) {
        if (Math.abs(e.ax - e.bx) < EPS && Math.abs(e.ax - side) < EPS) {
          // its own wall: joined along the straight part
          if (!(e.ay <= p.piece.y && e.by >= p.piece.y + p.piece.h) && !(e.by <= p.piece.y && e.ay >= p.piece.y + p.piece.h)) err.push('bar not on a straight side');
          continue;
        }
        const d = S.shapeDist(p.shape, S.shapeOf({ k: 'seg', ax: e.ax, ay: e.ay, bx: e.bx, by: e.by, r: 0 }));
        if (d < 22 - EPS) err.push(`bar gap ${d.toFixed(1)}`);
      }
      if (p.piece.h !== S.BAR_T) err.push('bar thickness');
    } else if (G.wallDist(planes, p.shape) < 14 - EPS) err.push(`passage ${p.kind}-wall`);
  }
  // Nothing overlaps: hazards clear of each other, of solids and inside the course.
  for (let i = 0; i < hazards.length; i++) {
    if (G.wallDist(planes, hazards[i].shape) < 0) err.push('hazard outside');
    for (const s of solids) if (S.shapeDist(hazards[i].shape, s.shape) <= 0) err.push('hazard overlaps a solid');
    for (let j = i + 1; j < hazards.length; j++) if (S.shapeDist(hazards[i].shape, hazards[j].shape) <= 0) err.push('hazards overlap');
  }
  return err;
}

/* ---------- 200 generated levels per difficulty ---------- */

const levels = { 1: [], 2: [], 3: [] };
for (const diff of [1, 2, 3]) {
  const t0 = Date.now();
  let solvedIn = 0;
  let placeOk = 0;
  let straightOk = 0;
  let fallbacks = 0;
  let maxMs = 0;
  const bad = [];
  const strokes = {};
  for (let i = 0; i < 200; i++) {
    const seed = (diff * 1000003 + i * 7919) >>> 0;
    const H = HEIGHTS[i % HEIGHTS.length];
    const t = Date.now();
    const L = G.generate(seed, diff, H, PLAY);
    maxMs = Math.max(maxMs, Date.now() - t);
    levels[diff].push(L);
    if (L.fallback) fallbacks++;
    const range = TB[L.diff].strokes;
    const n = G.solve(S.buildWorld(L), PLAY, range[1]);
    strokes[n] = (strokes[n] || 0) + 1;
    if (n !== null && n >= range[0] && n <= range[1] && (L.fallback || n === L.strokes)) solvedIn++;
    else bad.push(`seed ${seed} H ${H}: solver ${n}, level says ${L.strokes}`);
    const e = placementErrors(L);
    if (!e.length) placeOk++;
    else bad.push(`seed ${seed} H ${H}: ${e.join('; ')}`);
    if (L.diff === 1 || !G.straightLine(L)) straightOk++;
    else bad.push(`seed ${seed} H ${H}: straight line from tee to hole`);
  }
  check(solvedIn === 200, `[level ${diff}] 200 generated levels (heights ${HEIGHTS.join(', ')}): every one solved by the solver within its stroke range ${JSON.stringify(TB[diff].strokes)} (solver strokes ${JSON.stringify(strokes)}) ${bad.slice(0, 3)}`);
  check(placeOk === 200, `[level ${diff}] no level breaks a placement rule ${bad.filter((b) => !/solver|straight/.test(b)).slice(0, 3)}`);
  if (diff > 1) check(straightOk === 200, `[level ${diff}] no course has a straight line from tee to hole`);
  check(fallbacks === 0, `[level ${diff}] every level generated without falling back (${fallbacks} fallbacks; generation ${((Date.now() - t0) / 1000).toFixed(1)} s with checks, slowest ${maxMs} ms)`);
  check(levels[diff].every((L) => L.diff === diff || L.fallback), `[level ${diff}] each level has the difficulty it was asked for`);
}

/* ---------- determinism ---------- */

{
  let ok = 0;
  let differs = 0;
  for (const diff of [1, 2, 3]) {
    for (let i = 0; i < 10; i++) {
      const seed = 4242 + i * 31;
      const a = G.generate(seed, diff, 300, PLAY);
      const b = G.generate(seed, diff, 300, PLAY);
      const c = G.generate(seed, diff, 340, PLAY);
      if (JSON.stringify(a) === JSON.stringify(b)) ok++;
      if (JSON.stringify(a) !== JSON.stringify(c)) differs++;
    }
  }
  check(ok === 30, `the same seed and height give the same level every time (${ok}/30)`);
  check(differs === 30, `another height gives another level (${differs}/30)`);
  const sliced = G.generateSteps(99, 3, 300, PLAY);
  let yields = 0;
  let r;
  while (!(r = sliced.next()).done) yields++;
  check(JSON.stringify(r.value) === JSON.stringify(G.generate(99, 3, 300, PLAY)) && yields > 0,
    `built in slices gives the same level (${yields} slices)`);
  const json = JSON.parse(JSON.stringify(G.generate(7, 2, 300, PLAY)));
  check(JSON.stringify(json) === JSON.stringify(G.generate(7, 2, 300, PLAY)), 'a level survives the trip to and from the worker (plain JSON)');
}

/* ---------- the fallback ---------- */

{
  const bad = [];
  let tried = 0;
  for (let H = 240; H <= 420; H += 10) {
    for (const seed of [0, 1, 2, 3, 7, 99, 1234, 0xDEADBEEF, 0x7FFFFFFF]) {
      const L = G.fallbackLevel(H, 0, 0, seed);
      const n = G.solve(S.buildWorld(L), PLAY, 2);
      const e = placementErrors(L);
      tried++;
      if (n === null || n < 1 || n > 2 || e.length || L.diff !== 1 || L.bars.length || L.diags.length || L.blocks.length !== 1) bad.push(`H ${H} seed ${seed}: ${n} ${e}`);
    }
  }
  check(!bad.length, `the open level-1 fallback is solved in 1 to 2 strokes and keeps the placement rules at heights 240 to 420 (${tried} courses, 9 seeds per height) ${bad}`);
  // The seed varies it: the block's place and size and the hole's x.
  const key = (L) => JSON.stringify([L.blocks, L.hole]);
  const layouts = new Set();
  const holeXs = new Set();
  const blockWs = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const L = G.fallbackLevel(300, 0, 0, seed);
    layouts.add(key(L));
    holeXs.add(L.hole.x);
    blockWs.add(L.blocks[0].w);
  }
  check(layouts.size >= 35 && holeXs.size >= 15 && blockWs.size >= 8,
    `the fallback follows its seed: 40 seeds give ${layouts.size} different courses (${holeXs.size} hole positions, ${blockWs.size} block widths)`);
  let detOk = true;
  for (const H of [240, 300, 420]) for (const seed of [1, 5, 77, 4000000000]) {
    if (JSON.stringify(G.fallbackLevel(H, 4, 8, seed)) !== JSON.stringify(G.fallbackLevel(H, 4, 8, seed))) detOk = false;
  }
  check(detOk, 'the fallback is deterministic: the same seed and height give the same course');
  // A screen too short for any candidate: 30 rejects, then the fallback.
  const L = G.generate(5, 3, 150, PLAY);
  check(L.fallback === true && L.diff === 1, 'after 30 rejected candidates the generator falls back to an open level-1 course');
}

/* ---------- difficulty draw ---------- */

{
  const r = G.rng(1);
  const n = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 30000; i++) n[G.pickDifficulty(r, false)]++;
  check(Object.values(n).every((v) => Math.abs(v - 10000) < 400), `difficulties drawn with equal odds ${JSON.stringify(n)}`);
  let duskOk = true;
  for (let i = 0; i < 3000; i++) if (G.pickDifficulty(r, true) !== 1) duskOk = false;
  check(duskOk, 'in the dusk phase the draw is level 1 only');
  check(/G\.pickDifficulty\(Math\.random, dusk\(\)\)/.test(puttCode) && /if \(dusk\(\)\) \{/.test(puttCode),
    'putt.js draws with the dusk flag and, from dusk on, takes only a level-1 course (or the fallback, also level 1)');
  check(SE.SESSION.rampMin === 10 && /clock\.active >= SESSION\.rampMin \* 60/.test(puttCode), 'dusk is minute 10 of the shared session clock');
}

/* ---------- physics ---------- */

/** A bare level for unit checks: a W x H box with optional pieces. */
function box(w, h, extra = {}) {
  const L = { x0: 0, y0: 0, x1: w, y1: h, cuts: [0, 0, 0, 0], bars: [], diags: [], blocks: [], pegs: [], traps: [], water: [], hole: { x: -1000, y: -1000, r: 5 }, ...extra };
  L.poly = S.coursePolygon(0, 0, w, h, L.cuts);
  return L;
}

function run(w, b, maxS = 30) {
  let ev = 0;
  let steps = 0;
  while (b.moving && steps < maxS * S.STEP_HZ) {
    ev |= S.step(w, b, PLAY);
    steps++;
  }
  return { ev, steps };
}

{
  // Deceleration: a full-power shot on open cloth travels about 440 px and stops below 4 px/s.
  const w = S.buildWorld(box(100, 2000));
  const b = S.newBall(50, 1990);
  S.shoot(b, 0, -1, 220);
  const { steps } = run(w, b);
  const dist = 1990 - b.y;
  check(Math.abs(dist - 440) < 4 && !b.moving && Math.abs(steps / 120 - (220 - 4) / 55) < 0.02, `a full-power shot travels ${dist.toFixed(1)} px in ${(steps / 120).toFixed(2)} s and comes to rest`);
  // Sand trap: deceleration tripled.
  const w2 = S.buildWorld(box(100, 2000, { traps: [{ x: 0, y: 0, w: 100, h: 2000 }] }));
  const b2 = S.newBall(50, 1990);
  S.shoot(b2, 0, -1, 220);
  run(w2, b2);
  check(Math.abs((1990 - b2.y) - 440 / 3) < 3, `in a sand trap the same shot travels ${(1990 - b2.y).toFixed(1)} px (a third)`);
  // Bounce: 85 percent of the speed, angle in equals angle out.
  const w3 = S.buildWorld(box(200, 200));
  const b3 = S.newBall(100, 100);
  S.shoot(b3, 1, -2, 200);
  let before = null;
  while (b3.moving) {
    const vx = b3.vx;
    const vy = b3.vy;
    const ev = S.step(w3, b3, PLAY);
    if (ev & S.EV_BOUNCE) { before = [vx, vy]; break; }
  }
  const after = [b3.vx, b3.vy];
  const sIn = Math.hypot(...before);
  const sOut = Math.hypot(...after);
  check(before && Math.abs(sOut / (sIn - 55 / 120) - 0.85) < 0.01 && Math.abs(Math.atan2(after[1], after[0]) - Math.atan2(-before[1], before[0])) < 0.02,
    `a wall returns ${(sOut / sIn).toFixed(3)} of the speed, angle in equals angle out`);
  // Pegs and blocks bounce too.
  const w4 = S.buildWorld(box(200, 200, { pegs: [{ x: 100, y: 50 }], blocks: [{ x: 90, y: 150, w: 20, h: 10, c: 0 }] }));
  const b4 = S.newBall(100, 100);
  S.shoot(b4, 0, -1, 100);
  let e4 = 0;
  while (b4.moving && !(e4 & S.EV_BOUNCE)) e4 |= S.step(w4, b4, PLAY);
  const b5 = S.newBall(100, 100);
  S.shoot(b5, 0, 1, 100);
  let e5 = 0;
  while (b5.moving && !(e5 & S.EV_BOUNCE)) e5 |= S.step(w4, b5, PLAY);
  check((e4 & S.EV_BOUNCE) && b4.vy > 0 && (e5 & S.EV_BOUNCE) && b5.vy < 0, 'pegs and blocks bounce the ball back');
  // A 45 degree diagonal sends a vertical ball sideways.
  const w6 = S.buildWorld(box(200, 200, { diags: [{ ax: 80, ay: 70, bx: 120, by: 30 }] }));
  const b6 = S.newBall(100, 150);
  S.shoot(b6, 0, -1, 150);
  let e6 = 0;
  while (b6.moving && !(e6 & S.EV_BOUNCE)) e6 |= S.step(w6, b6, PLAY);
  check((e6 & S.EV_BOUNCE) && Math.abs(b6.vy) < 1 && b6.vx > 0, `a diagonal is a true 45 degree line: straight up becomes sideways (v ${b6.vx.toFixed(1)}, ${b6.vy.toFixed(2)})`);
}

{
  // The hole: under 140 px/s the ball drops; faster it skips over.
  const hole = { x: 50, y: 100, r: 5 };
  const w = S.buildWorld(box(100, 400, { hole }));
  const slow = S.newBall(50, 150);
  S.shoot(slow, 0, -1, Math.sqrt(120 * 120 + 2 * 55 * 50));
  const r1 = run(w, slow);
  const fast = S.newBall(50, 150);
  S.shoot(fast, 0, -1, Math.sqrt(160 * 160 + 2 * 55 * 50));
  const r2 = { ev: 0 };
  while (fast.moving && fast.y > 80) r2.ev |= S.step(w, fast, PLAY); // its first pass over the hole
  check((r1.ev & S.EV_SINK) && slow.sunk && slow.x === 50 && slow.y === 100, 'the ball drops in when its centre comes within the hole radius under 140 px/s');
  check(!(r2.ev & S.EV_SINK) && !fast.sunk, 'faster than 140 px/s it skips over the hole');
  const edge = S.newBall(54.5, 150);
  S.shoot(edge, 0, -1, 80);
  const r3 = run(w, edge);
  const miss = S.newBall(55.6, 150);
  S.shoot(miss, 0, -1, 80);
  const r4 = run(w, miss);
  check((r3.ev & S.EV_SINK) && !(r4.ev & S.EV_SINK), 'the hole takes a centre within its radius and not beyond');
}

{
  // Haptics near the hole: the 24 ms sink tick always goes out. putt.js plays the shot at 60 frames a
  // second, handles each step's events at its frame's time and sends ticks through the shared 40 ms
  // limit; this replays that loop with the rule stepTicks (sim.js) gives and with the old rule (a bounce
  // ticks whenever it is 8 px/s or more), on shots that bounce off the top wall right beside the hole.
  const LOOK = Math.ceil(((HAPTICS.MIN_GAP_MS + 25) / 1000) * S.STEP_HZ);
  const lim = HAPTICS.MIN_GAP_MS;
  const oldRule = (w, b, ev) => ({ bounce: !!(ev & S.EV_BOUNCE) && b.vn >= CONFIG.bounceTickMinSpeed, sink: !!(ev & S.EV_SINK) });
  const newRule = (w, b, ev) => S.stepTicks(w, b, ev, PLAY, CONFIG.bounceTickMinSpeed, LOOK);
  /** Replays one shot: the ticks sent as [ms, time], the sink's frame time, and whether a bounce came within 40 ms before it. */
  function replay(w, x, y, dx, dy, v, rule, must) {
    const b = S.newBall(x, y);
    const sent = [];
    let last = -Infinity;
    let pendingMust = null;
    const buzz = (ms, now, isMust) => {
      if (now - last < lim) { if (isMust && must && !pendingMust) pendingMust = [ms, last + lim]; return; }
      last = now;
      sent.push([ms, now]);
    };
    S.shoot(b, dx, dy, v);
    buzz(CONFIG.hapticReleaseMs, 0, false);
    let acc = 0;
    let sinkAt = null;
    let lastBounceStep = -Infinity;
    let stepNo = 0;
    let sinkStep = null;
    for (let f = 1; f < 600 && b.moving; f++) {
      const now = (f * 1000) / 60;
      if (pendingMust && now >= pendingMust[1]) { buzz(pendingMust[0], pendingMust[1], false); pendingMust = null; }
      acc += 1 / 60;
      while (acc >= S.DT && b.moving) {
        acc -= S.DT;
        const ev = S.step(w, b, PLAY);
        stepNo++;
        if ((ev & S.EV_BOUNCE) && b.vn >= CONFIG.bounceTickMinSpeed) lastBounceStep = stepNo;
        const t = rule(w, b, ev);
        if (t.bounce) buzz(CONFIG.hapticBounceMs, now, false);
        if (t.sink) { buzz(CONFIG.hapticSinkMs, now, true); sinkAt = now; sinkStep = stepNo; }
      }
    }
    if (pendingMust) buzz(pendingMust[0], pendingMust[1], false);
    const close = sinkStep !== null && (sinkStep - lastBounceStep) * S.DT * 1000 <= lim;
    return { sent, sinkAt, close, sunk: b.sunk };
  }
  const hole = { x: 30, y: 8, r: 5 };
  const w = S.buildWorld(box(60, 120, { hole }));
  const cases = [];
  for (let x = 6; x <= 54; x += 2) {
    for (let a = 20; a <= 80; a += 4) {
      for (const sgn of [-1, 1]) {
        for (let v = 60; v <= 220; v += 20) {
          const rad = (a * Math.PI) / 180;
          const dx = sgn * Math.cos(rad);
          const dy = -Math.sin(rad);
          const r = replay(w, x, 100, dx, dy, v, newRule, false);
          if (r.sunk && r.close && r.sinkAt > lim + 20) cases.push([x, dx, dy, v]);
        }
      }
    }
  }
  let oldLost = 0;
  let newOk = 0;
  let gapsOk = true;
  for (const [x, dx, dy, v] of cases) {
    const o = replay(w, x, 100, dx, dy, v, oldRule, false);
    if (!o.sent.some(([ms]) => ms === CONFIG.hapticSinkMs)) oldLost++;
    const n = replay(w, x, 100, dx, dy, v, newRule, false);
    const sink = n.sent.filter(([ms]) => ms === CONFIG.hapticSinkMs);
    if (sink.length === 1 && sink[0][1] === n.sinkAt) newOk++;
    for (let i = 1; i < n.sent.length; i++) if (n.sent[i][1] - n.sent[i - 1][1] < lim) gapsOk = false;
  }
  check(cases.length >= 5 && oldLost >= 1, `test shots that bounce off the wall within 40 ms before the drop: ${cases.length}; with a bounce tick at every bounce the sink tick is lost on ${oldLost}`);
  check(cases.length >= 5 && newOk === cases.length && gapsOk,
    `with stepTicks the 24 ms sink tick goes out at the drop on all ${newOk}/${cases.length} of them, and every two ticks stay 40 ms apart`);
  // A bounce away from the hole still ticks; a bounce in the step that sinks does not.
  const far = S.buildWorld(box(100, 200, { hole: { x: 50, y: 20, r: 5 } }));
  const fb = S.newBall(50, 150);
  S.shoot(fb, 1, 0, 150);
  let fev = 0;
  while (fb.moving && !(fev & S.EV_BOUNCE)) fev = S.step(far, fb, PLAY);
  const ft = S.stepTicks(far, fb, fev, PLAY, CONFIG.bounceTickMinSpeed, LOOK);
  check(ft.bounce && !ft.sink && LOOK === 8, `a bounce far from the hole still ticks (look-ahead ${LOOK} steps, 40 ms + 25 ms)`);
  const both = S.stepTicks(far, { ...fb, vn: 100 }, S.EV_BOUNCE | S.EV_SINK, PLAY, CONFIG.bounceTickMinSpeed, LOOK);
  check(!both.bounce && both.sink, 'a bounce in the very step the ball drops gives only the sink tick');
  // A sink still inside the gap after a frame stall: putt.js sends it as soon as the gap ends.
  const quick = replay(w, 30, 15, 0, -1, 100, newRule, true);
  const qs = quick.sent.filter(([ms]) => ms === CONFIG.hapticSinkMs);
  check(quick.sunk && quick.sinkAt < lim && qs.length === 1 && qs[0][1] === lim,
    `a drop ${quick.sinkAt ? quick.sinkAt.toFixed(0) : '?'} ms after the release tick is sent when the 40 ms gap ends (at ${qs.length ? qs[0][1].toFixed(0) : 'never'} ms)`);
  check(/S\.stepTicks\(world, ball, ev, PLAY, CONFIG\.bounceTickMinSpeed, SINK_LOOK_STEPS\)/.test(puttCode)
    && /buzz\(CONFIG\.hapticSinkMs, true\)/.test(puttCode) && /if \(must && !mustTimer\) mustTimer = setTimeout/.test(puttCode)
    && /SINK_LOOK_STEPS = Math\.ceil\(\(\(MIN_GAP_MS \+ 25\) \/ 1000\) \* S\.STEP_HZ\)/.test(puttCode),
    'putt.js ticks by stepTicks with the same look-ahead, and a sink tick inside the gap is sent when the gap ends');
}

{
  // Water: the ball plops and returns to where that shot was taken.
  const w = S.buildWorld(box(200, 200, { water: [{ x: 80, y: 40, w: 30, h: 20 }] }));
  let ok = 0;
  for (let i = 0; i < 40; i++) {
    const ox = 60 + i;
    const oy = 150 + (i % 7);
    const b = S.newBall(ox, oy);
    S.shoot(b, 95 - ox, 50 - oy, 220);
    const r = run(w, b);
    if ((r.ev & S.EV_WATER) && !b.moving && b.x === ox && b.y === oy && b.ox === ox && b.oy === oy) ok++;
  }
  check(ok === 40, `a ball in water returns to the spot the shot was taken from (${ok}/40)`);
  // A second shot from the new spot returns there, not to the first.
  const b = S.newBall(20, 180);
  S.shoot(b, 0, -1, 30);
  run(w, b);
  const sx = b.x;
  const sy = b.y;
  S.shoot(b, 95 - sx, 50 - sy, 220);
  const r = run(w, b);
  check((r.ev & S.EV_WATER) && b.x === sx && b.y === sy, 'water returns the ball to the start of that shot, not the first tee');
}

{
  // pullShot: opposite to the pull, power capped at 60 px, 4 px or less cancels.
  const a = S.pullShot(50, 50, 50, 80, PLAY);
  const c = S.pullShot(50, 50, 50, 200, PLAY);
  check(a && a.dy < 0 && a.dx === 0 && Math.abs(a.speed - 110) < EPS && c.speed === 220 && c.power === 1, 'the shot goes opposite to the pull; power is the pull length, capped at 60 px');
  check(S.pullShot(50, 50, 53, 52, PLAY) === null && S.pullShot(50, 50, 54, 50, PLAY) === null && S.pullShot(50, 50, 54.1, 50, PLAY) !== null,
    'pulling back to within 4 px of the start and releasing cancels the shot');
}

{
  // The aim guide: to the first wall, then 12 px of the rebound.
  const w = S.buildWorld(box(100, 200));
  const g = S.aimPath(w, 50, 100, 0, -1, 12);
  const last = g.pts[g.pts.length - 1];
  check(g.hit && Math.abs(g.hit[1] - S.BALL_R) < 1.01 && Math.abs(last[1] - (g.hit[1] + 12)) < 1.01 && g.pts.length - g.leg === 12,
    `the aim guide runs to the first wall it would hit (${g.hit && g.hit[1].toFixed(2)}) plus 12 px of the rebound`);
}

/* ---------- no tunnelling, never leaves the course, always rests ---------- */

{
  const r = G.rng(77);
  let shots = 0;
  let worstPen = 0;
  let worstOut = Infinity;
  let nan = 0;
  let notRest = 0;
  let maxStep = 0;
  let maxSteps = 0;
  let sunk = 0;
  let water = 0;
  let crossed = 0;
  const sample = [...levels[1].slice(0, 40), ...levels[2].slice(0, 40), ...levels[3].slice(0, 40)];
  for (const L of sample) {
    const w = S.buildWorld(L);
    const planes = S.halfPlanes(L.poly);
    const solids = G.solidPieces(L);
    for (let k = 0; k < 25; k++) {
      // From the tee or a random free spot; a random direction; any power up to the top speed.
      let x = L.tee.x;
      let y = L.tee.y;
      if (k > 0) {
        for (let t = 0; t < 50; t++) {
          const px = L.x0 + r() * (L.x1 - L.x0);
          const py = L.y0 + r() * (L.y1 - L.y0);
          if (S.insideDist(planes, px, py) >= S.BALL_R && S.overlap(w, px, py) <= 0 && !S.inWater(w, px, py)) { x = px; y = py; break; }
        }
      }
      const a = r() * Math.PI * 2;
      const b = S.newBall(x, y);
      S.shoot(b, Math.cos(a), Math.sin(a), 20 + r() * 200);
      shots++;
      let steps = 0;
      while (b.moving && steps < 120 * 30) {
        const px = b.x;
        const py = b.y;
        const ev = S.step(w, b, PLAY);
        steps++;
        if (!finite(b.x) || !finite(b.y) || !finite(b.vx) || !finite(b.vy)) nan++;
        if (ev & S.EV_WATER) { water++; continue; }
        if (ev & S.EV_SINK) { sunk++; continue; }
        maxStep = Math.max(maxStep, Math.hypot(b.x - px, b.y - py));
        worstPen = Math.max(worstPen, S.overlap(w, b.x, b.y));
        worstOut = Math.min(worstOut, S.insideDist(planes, b.x, b.y));
        // Swept: the straight move of this step never crosses a solid's core.
        const move = S.shapeOf({ k: 'seg', ax: px, ay: py, bx: b.x, by: b.y, r: 0 });
        for (const p of solids) if (S.shapeDist(move, p.shape) <= 0) crossed++;
      }
      if (b.moving) notRest++;
      maxSteps = Math.max(maxSteps, steps);
    }
  }
  check(nan === 0, `${shots} random shots on 120 generated levels: no NaN`);
  check(crossed === 0 && worstPen < 0.05, `the ball never passes through a wall, block, diagonal or peg (deepest overlap ${worstPen.toFixed(4)} px, ${crossed} crossings)`);
  check(worstOut >= S.BALL_R - 0.05, `the ball never leaves the course (closest centre to the wall ${worstOut.toFixed(3)} px, radius ${S.BALL_R})`);
  check(notRest === 0 && maxSteps <= 120 * 4 + 2, `the ball always comes to rest, within 4 s (longest ${(maxSteps / 120).toFixed(2)} s); ${sunk} sank, ${water} in water`);
  check(maxStep <= 220 / 120 + EPS, `the ball moves at most ${(220 / 120).toFixed(3)} px per step (${maxStep.toFixed(3)})`);

  // Stress: ten times the top speed still never leaves the course or passes through a solid.
  let out = 0;
  for (const L of levels[3].slice(0, 30)) {
    const w = S.buildWorld(L);
    const planes = S.halfPlanes(L.poly);
    for (let k = 0; k < 10; k++) {
      const a = r() * Math.PI * 2;
      const b = S.newBall(L.tee.x, L.tee.y);
      S.shoot(b, Math.cos(a), Math.sin(a), 2200);
      for (let s = 0; s < 600 && b.moving; s++) {
        S.step(w, b, PLAY);
        if (S.insideDist(planes, b.x, b.y) < S.BALL_R - 0.05 || S.overlap(w, b.x, b.y) > 0.05) out++;
      }
    }
  }
  check(out === 0, `stress at 2200 px/s (ten times the top speed): never through a wall (${out} bad steps)`);
}

/* ---------- readability (the B4 standard, sunset and all 10 steps) ---------- */

{
  check(/const TRAP_AMOUNT = 0\.55;/.test(puttSrc) && /const DROP_AMOUNT = 0\.2;/.test(puttSrc)
    && /const sand = pal\.sky\[0\];/.test(puttSrc) && /const water = pal\.sea\[1\];/.test(puttSrc)
    && /const WALL = COLORS\.coral;/.test(puttSrc) && /const BLOCKS = \[BRICK_ROWS\[2\], BRICK_ROWS\[4\]\];/.test(puttSrc)
    && /const PEG = BRICK_ROWS\[5\];/.test(puttSrc) && /powerOff: mix\(COLORS\.coral, sand, 0\.6\)/.test(puttSrc)
    && /guideAfter: mix\(BALL, sand, 0\.45\)/.test(puttSrc) && /const HOLE = COLORS\.keel;/.test(puttSrc) && /const BALL = COLORS\.blue;/.test(puttSrc),
    'putt.js draws with the colours measured here');
  const P = CT.pairs();
  for (let k = 0; k <= SE.SESSION.sceneSteps; k++) {
    const pal = T.scenePalette(k / SE.SESSION.sceneSteps);
    const sand = pal.sky[0];
    const trap = T.mix(sand, T.BRICK_ROWS[3], 0.55);
    const water = pal.sea[1];
    const where = { k, tag: 'putt' };
    for (const [on, bg] of [['sand', sand], ['sand trap', trap]]) {
      P.add('ball', 'cr', T.COLORS.blue, null, on, bg, where);
      P.add('hole', 'cr', T.COLORS.keel, null, on, bg, where);
      P.add('wall', 'de', T.COLORS.coral, null, on, bg, where);
    }
    P.add('aim guide', 'cr', T.COLORS.blue, null, 'sand', sand, where);
    P.add('block (salmon)', 'de', T.BRICK_ROWS[2], null, 'sand', sand, where);
    P.add('block (pink)', 'de', T.BRICK_ROWS[4], null, 'sand', sand, where);
    P.add('peg', 'de', T.BRICK_ROWS[5], null, 'sand', sand, where);
    P.add('water', 'de', water, null, 'sand', sand, where);
    P.add('sand trap', 'de', trap, null, 'sand', sand, where);
    const powerOff = T.mix(T.COLORS.coral, sand, 0.6);
    P.add('power bar (lit)', 'de', T.COLORS.coral, null, 'sand', sand, where);
    P.add('power bar (unlit)', 'de', powerOff, null, 'sand', sand, where);
    P.add('power bar (lit)', 'de', T.COLORS.coral, null, 'unlit bar', powerOff, where);
    P.add('aim guide (rebound)', 'de', T.mix(T.COLORS.blue, sand, 0.45), null, 'sand', sand, where);
    P.add('pull ring', 'cr', T.COLORS.cloud, T.COLORS.ink, 'sand', sand, where);
    for (let i = 0; i < 3; i++) {
      P.add('course wall', 'de', T.COLORS.coral, null, `sea band ${i + 1}`, pal.sea[i], where);
      P.add('pull ring', 'cr', T.COLORS.cloud, T.COLORS.ink, `sea band ${i + 1}`, pal.sea[i], where);
    }
  }
  const under = P.rows.filter((x) => !x.ok);
  const w = CT.worst(P.rows);
  check(!under.length, `ball, hole, walls, blocks, pegs, water, traps, guide and pull ring meet the B4 standard at sunset and every step `
    + `(weakest ${CT.fmt(w)}) ${under.slice(0, 3).map(CT.fmt)}`);
}

console.log(`\n${passed + fails.length} checks, ${fails.length} failure(s)`);
process.exit(fails.length ? 1 : 0);
