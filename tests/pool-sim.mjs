#!/usr/bin/env node
// RLX v2: games/pool/sim.js in Node (docs/V2.md §6). No dependencies. Not needed to run the app.
// Run: node tests/pool-sim.mjs. Uses the CONFIG block of games/pool/pool.js, so it tests what ships.
// The list is the spec's and no more: bounds, no tunnelling, no energy gain in a collision, rest within
// 15 s, each pocket pots, the cue ball returns, a new rack follows, pullShot, determinism.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../games/pool/sim.js';

const ROOT = new URL('../', import.meta.url);
const src = readFileSync(fileURLToPath(new URL('games/pool/pool.js', ROOT)), 'utf8');
const m = src.match(/export const CONFIG = Object\.freeze\((\{[\s\S]*?\})\);/);
const CONFIG = m ? Function(`return (${m[1]});`)() : null;

let passed = 0;
const fails = [];
function check(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (cond) passed++;
  else fails.push(msg);
}
check(!!CONFIG, 'pool.js has one CONFIG block');
if (!CONFIG) process.exit(1);

// A small seeded generator: the tests themselves are deterministic.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = CONFIG.ballR;
const GEOS = [[135, 240, {}], [135, 300, { top: 6, bottom: 4 }], [135, 400, {}]];
const world = (g = GEOS[1]) => S.createWorld(S.makeTable(g[0], g[1], g[2], CONFIG), CONFIG);
const FULL = CONFIG.launchSpeed;
const energy = (w) => w.balls.reduce((a, b) => a + (b.potted ? 0 : b.vx * b.vx + b.vy * b.vy), 0);

/** Step until all is at rest or maxS seconds; calls each(world, events) after every step. Returns the steps taken. */
function run(w, maxS, each) {
  let n = 0;
  while (S.anyMoving(w) && n < maxS * S.STEP_HZ) {
    const ev = S.step(w);
    n++;
    if (each) each(w, ev);
  }
  return n;
}

function randomShot(w, r) {
  const cue = w.balls[0];
  const t = w.table;
  cue.potted = false;
  cue.x = t.x0 + R + r() * (t.x1 - t.x0 - 2 * R);
  cue.y = t.y0 + R + r() * (t.y1 - t.y0 - 2 * R);
  const a = r() * Math.PI * 2;
  S.shoot(w, Math.cos(a), Math.sin(a), FULL);
}

/* ---------- the table ---------- */

{
  const w = world();
  const t = w.table;
  check(t.pockets.length === 6 && t.pockets.filter((p) => p.r === CONFIG.cornerPocketR).length === 4
    && t.pockets.filter((p) => p.r === CONFIG.sidePocketR).length === 2, 'six pockets: four corner (radius 9), two side (radius 8)');
  check(w.balls.length === 11 && w.balls.slice(1).every((b) => !b.potted), 'a rack of ten object balls and the cue ball');
  check(Math.abs(t.apex.y - (t.outer.y0 + 0.32 * t.th)) < 1e-9 && Math.abs(t.baulkY - (t.outer.y0 + 0.74 * t.th)) < 1e-9
    && t.spot.y - t.baulkY === 9 && t.spot.x === t.cx, 'apex at 32 percent, baulk line at 74 percent, the cue spot 9 px below it, centred');
}

/* ---------- 1. no ball leaves the table ---------- */

{
  const r = rng(1);
  let out = 0;
  let shots = 0;
  for (let i = 0; i < 200; i++) {
    const w = world(GEOS[i % 3]);
    const t = w.table;
    randomShot(w, r);
    shots++;
    run(w, 20, (ww) => {
      for (const b of ww.balls) {
        if (b.potted) continue;
        if (b.x < t.x0 + R - 1e-6 || b.x > t.x1 - R + 1e-6 || b.y < t.y0 + R - 1e-6 || b.y > t.y1 - R + 1e-6 || Number.isNaN(b.x + b.y)) out++;
      }
    });
  }
  check(shots === 200 && out === 0, `no ball leaves the table in 200 random full-power shots (${out} samples outside)`);
}

/* ---------- 2. no tunnelling at top speed ---------- */

{
  // Two balls head-on at 300 each, and a full-power shot at a resting ball: they collide, never pass through.
  const w = world();
  const t = w.table;
  const a = w.balls[0];
  const b = w.balls[1];
  for (const o of w.balls.slice(2)) o.potted = true;
  a.x = t.cx - 30; a.y = (t.y0 + t.y1) / 2; a.vx = FULL; a.vy = 0;
  b.x = t.cx + 30; b.y = a.y; b.vx = -FULL; b.vy = 0;
  let crossed = false;
  let hit = false;
  for (let i = 0; i < 120; i++) {
    const ev = S.step(w);
    if (ev.some((e) => e.k === 'ball')) hit = true;
    if (a.x > b.x) crossed = true;
  }
  check(hit && !crossed, 'two balls head-on at top speed collide and never pass through each other');
  const w2 = world();
  const c = w2.balls[0];
  const o = w2.balls[1];
  for (const q of w2.balls.slice(2)) q.potted = true;
  c.x = w2.table.cx; c.y = w2.table.y1 - 20; o.x = w2.table.cx; o.y = w2.table.y1 - 80;
  S.shoot(w2, 0, -1, FULL);
  let struck = false;
  let through = false;
  for (let i = 0; i < 120; i++) {
    const ev = S.step(w2);
    if (ev.some((e) => e.k === 'ball')) struck = true;
    if (c.y < o.y) through = true;
  }
  check(struck && !through, 'a full-power shot at a resting ball strikes it, the cue ball never ends up past it');
  const r = rng(2);
  let deep = 0;
  for (let i = 0; i < 100; i++) {
    const w3 = world();
    randomShot(w3, r);
    run(w3, 6, (ww) => {
      const live = ww.balls.filter((q) => !q.potted);
      for (let x = 0; x < live.length; x++) for (let y = x + 1; y < live.length; y++) if (Math.hypot(live[x].x - live[y].x, live[x].y - live[y].y) < 2 * R - 1.5) deep++;
    });
  }
  check(deep === 0, `balls never overlap by more than 1.5 px in 100 full-power shots (${deep} samples)`);
}

/* ---------- 3. total speed never rises in a collision ---------- */

{
  // Measured as the total kinetic energy (sum of speed squared, equal masses): the sum of plain speeds can rise in a
  // glancing hit even when nothing gains energy.
  const r = rng(3);
  let rise = 0;
  let collisions = 0;
  for (let i = 0; i < 100; i++) {
    const w = world(GEOS[i % 3]);
    randomShot(w, r);
    let before = energy(w);
    run(w, 20, (ww, ev) => {
      const now = energy(ww);
      if (ev.some((e) => e.k === 'ball' || e.k === 'cushion')) collisions++;
      if (now > before + 1e-6) rise++;
      before = now;
    });
  }
  check(collisions > 200 && rise === 0, `total energy never rises in any step with a collision (${collisions} collision steps, ${rise} rises)`);
}

/* ---------- 4. every shot is at rest within 15 s ---------- */

{
  const r = rng(4);
  let worst = 0;
  let unrest = 0;
  for (let i = 0; i < 200; i++) {
    const w = world(GEOS[i % 3]);
    randomShot(w, r);
    const n = run(w, 15);
    worst = Math.max(worst, n / S.STEP_HZ);
    if (S.anyMoving(w)) unrest++;
  }
  check(unrest === 0, `every one of 200 random full-power shots is at rest within 15 s (slowest ${worst.toFixed(2)} s)`);
  // Never stuck: with a quarter of the friction a ball would roll for 20 s; 12 s after the shot deceleration triples, so it still stops in time.
  const slick = { ...CONFIG, decel: 15, cushionRestitution: 1 };
  const w = S.createWorld(S.makeTable(135, 300, {}, slick), slick);
  for (const o of w.balls.slice(1)) o.potted = true;
  S.shoot(w, 0, -1, FULL); // straight up and down the middle: no pocket, no energy lost at the cushions
  const n = run(w, 15);
  check(!S.anyMoving(w) && w.slow && n / S.STEP_HZ > CONFIG.stuckS, `a ball on a slick cloth (a third of the deceleration) still rests inside 15 s once the stuck rule triples deceleration (${(n / S.STEP_HZ).toFixed(1)} s)`);
}

/* ---------- 5. a ball rolled at each pocket is potted ---------- */

{
  const w0 = world();
  const t = w0.table;
  t.pockets.forEach((p, i) => {
    const w = world();
    for (const o of w.balls.slice(2)) o.potted = true;
    const b = w.balls[1];
    // start 40 px from the pocket's centre, towards the middle of the table, and roll at its centre
    const mx = t.cx - p.x;
    const my = (t.y0 + t.y1) / 2 - p.y;
    const side = i >= 4;
    const dx = side ? Math.sign(mx) : mx;
    const dy = side ? 0 : my;
    const d = Math.hypot(dx, dy);
    b.x = p.x + (dx / d) * 40;
    b.y = p.y + (dy / d) * 40;
    b.vx = (-dx / d) * 120;
    b.vy = (-dy / d) * 120;
    let potted = false;
    run(w, 10, (ww, ev) => { if (ev.some((e) => e.k === 'pot' && e.id === 1)) potted = true; });
    check(potted && w.balls[1].potted, `a ball rolled at pocket ${i + 1} (${i < 4 ? 'corner' : 'side'}) is potted`);
  });
}

/* ---------- 6. the cue ball comes back after a pot ---------- */

{
  const w = world();
  const t = w.table;
  const cue = w.balls[0];
  const p = t.pockets[0];
  cue.x = p.x + 30; cue.y = p.y + 30;
  S.shoot(w, -1, -1, 150);
  let at = -1;
  let back = -1;
  for (let i = 0; i < 20 * S.STEP_HZ; i++) {
    const ev = S.step(w);
    if (ev.some((e) => e.k === 'pot' && e.id === 0) && at < 0) at = w.t;
    if (ev.some((e) => e.k === 'cue')) { back = w.t; break; }
  }
  const dt = back - at;
  check(at > 0 && back > 0 && Math.abs(dt - 0.6) < 0.02 && !cue.potted && cue.x === t.spot.x && cue.y === t.spot.y && !S.anyMoving(w),
    `a potted cue ball rises on its spot after ${dt.toFixed(3)} s (no penalty, at rest)`);
  // a ball on the spot: the nearest free place
  const w2 = world();
  w2.balls[0].potted = true;
  w2.cueAt = w2.t + 0.1;
  w2.balls[1].x = w2.table.spot.x + 1;
  w2.balls[1].y = w2.table.spot.y;
  for (let i = 0; i < 30; i++) S.step(w2);
  const c2 = w2.balls[0];
  const near = Math.hypot(c2.x - w2.table.spot.x, c2.y - w2.table.spot.y);
  const clear = w2.balls.every((q) => q === c2 || Math.hypot(q.x - c2.x, q.y - c2.y) >= 2 * R);
  check(!c2.potted && clear && near > 0 && near < 20, `with a ball on the spot the cue ball rises on the nearest free place (${near.toFixed(1)} px away)`);
}

/* ---------- 7. a new rack follows the last ball ---------- */

{
  const w = world();
  const t = w.table;
  for (const o of w.balls.slice(1, 10)) o.potted = true; // nine are already in the pools
  const last = w.balls[10];
  const p = t.pockets[3];
  last.x = p.x - 30; last.y = p.y - 30;
  last.vx = 120 * Math.SQRT1_2; last.vy = 120 * Math.SQRT1_2;
  w.balls[0].x = t.cx; w.balls[0].y = (t.y0 + t.y1) / 2 - 40;
  let potAt = -1;
  let rackAt = -1;
  for (let i = 0; i < 20 * S.STEP_HZ; i++) {
    const ev = S.step(w);
    if (ev.some((e) => e.k === 'pot' && e.id === 10)) potAt = w.t;
    if (ev.some((e) => e.k === 'rack')) { rackAt = w.t; break; }
  }
  const fresh = S.rackPositions(t, CONFIG);
  const ok = w.balls.length === 11 && w.balls.every((b) => !b.potted)
    && fresh.every((q) => { const b = w.balls[q.id]; return b.x === q.x && b.y === q.y; })
    && w.balls[0].x === t.spot.x && w.balls[0].y === t.spot.y;
  check(potAt > 0 && Math.abs(rackAt - potAt - 0.9) < 0.02 && ok, `a new rack and the cue ball on its spot follow the last ball after ${(rackAt - potAt).toFixed(3)} s`);
}

/* ---------- 8. pullShot ---------- */

{
  const f = (len) => S.pullShot(50, 50, 50, 50 + len, CONFIG);
  const cap = CONFIG.pullCapPx;
  check(cap === 20 && f(20) && Math.abs(f(20).speed - FULL) < 1e-9 && f(20).power === 1, 'a pull of 20 px is full power');
  check(f(60) && Math.abs(f(60).speed - FULL) < 1e-9 && f(200).power === 1, 'a longer pull stays at full power');
  check(f(4) === null && f(3) === null && f(4.01) !== null && f(0) === null, 'a pull of 4 px or less is no shot');
  const curve = [6, 8, 10, 14, 18, 19].every((len) => Math.abs(f(len).speed - FULL * Math.pow(len / cap, 1.5)) < 1e-9);
  check(curve && Math.abs(f(10).speed - FULL * 0.5 ** 1.5) < 1e-9, 'between 4 and 20 px the speed follows the 1.5 curve');
  const a = S.pullShot(50, 50, 20, 90, CONFIG);
  const b = S.pullShot(50, 50, 80, 10, CONFIG);
  check(Math.abs(a.dx / a.len - 30 / 50) < 1e-9 && Math.abs(a.dy / a.len + 40 / 50) < 1e-9 && a.power === 1
    && Math.abs(b.dx / b.len + 30 / Math.hypot(30, 40)) < 1e-9, 'the shot goes opposite to the pull, and past the cap the direction keeps following the thumb');
}

/* ---------- 9. determinism ---------- */

{
  const play = () => {
    const r = rng(9);
    const w = world();
    const out = [];
    for (let i = 0; i < 6; i++) {
      randomShot(w, r);
      run(w, 15);
      out.push(JSON.stringify(w.balls));
    }
    return out.join('|');
  };
  check(play() === play(), 'the same inputs give the same result');
}

console.log(`\n${passed} checks, ${fails.length} failure(s)`);
process.exit(fails.length ? 1 : 0);
