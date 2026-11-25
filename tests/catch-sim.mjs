#!/usr/bin/env node
// RLX row C1 headless checks: runs games/catch/sim.js and the shared session
// clock in Node (PLAN §6b Accept). Not needed to run the app.
// Run: node tests/catch-sim.mjs
// Uses the tuning block from games/catch/catch.js, so it tests what ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../games/catch/sim.js';
import * as SE from '../shared/session.js';
import * as T from '../shared/tokens.js';
import * as PX from '../shared/pixel.js';

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

const catchSrc = read('games/catch/catch.js');
const m = catchSrc.match(/export const CONFIG = Object\.freeze\((\{[\s\S]*?\})\);/);
const CONFIG = m ? Function(`return (${m[1]});`)() : null;
check(!!CONFIG, 'catch.js has one CONFIG block');
check(catchSrc.indexOf('export const CONFIG') < catchSrc.indexOf('import '), 'CONFIG block sits at the top of catch.js');
check(CONFIG && CONFIG.paceStart === 0.3 && CONFIG.gainPerCatch === 0.02 && CONFIG.lossPerMiss === 0.15
  && CONFIG.fallMin === 32 && CONFIG.fallMax === 48 && CONFIG.gapMax === 1.7 && CONFIG.gapMin === 1.1
  && CONFIG.nastyMinS === 20 && CONFIG.nastyMaxS === 30 && CONFIG.nastySpeed === 30 && CONFIG.tapMs === 200
  && CONFIG.tapMovePx === 4 && CONFIG.graceMs === 400 && CONFIG.fishSpeed === 220 && CONFIG.hapticCatchMs === 8
  && CONFIG.hapticBiteMs === 16 && CONFIG.resumeDelayMs === 250 && CONFIG.sensitivity === 1.2 && CONFIG.maxItems === 3
  && CONFIG.spawnSpreadPx === 70 && CONFIG.swayPx === 3 && CONFIG.treatMinS === 90 && CONFIG.treatMaxS === 150
  && CONFIG.kindsStart === 2 && CONFIG.kindEvery === 40 && CONFIG.fishKindsStart === 2 && CONFIG.fishKindEvery === 5
  && CONFIG.fishKindsMax === 6, `CONFIG holds the PLAN values ${JSON.stringify(CONFIG)}`);
const simSrc = read('games/catch/sim.js').replace(/\/\/.*$/gm, '');
check(!/\b(document|window|navigator|localStorage|requestAnimationFrame|HTMLElement|import)\b/.test(simSrc),
  'sim.js touches no DOM and imports nothing');
const hexIn = (src) => (src.replace(/\/\/.*$/gm, '').match(/#[0-9A-Fa-f]{6}\b/g) || []);
check(hexIn(catchSrc).length === 0 && hexIn(simSrc).length === 0, 'no colour literals in the game: tokens only');
check(!/\bvibrate\b/.test(catchSrc.replace(/\/\/.*$/gm, '')) && (catchSrc.match(/\btick\(/g) || []).length === 2,
  'catch.js vibrates only through shared/haptics.js tick(), in two places (catch and bite)');
check(S.STEP_HZ === 120, 'the simulation steps at a fixed 120 Hz');

/* ---------- geometry ---------- */

// Logical heights 240 (smallest design height, with and without a status-bar
// inset), 300 (both test phones) and 400; the HUD ends at back.y + 13 + 5.
const geoFor = (H, safeTop = 0) => S.geometry(135, 5 + safeTop + 13 + 5, H - PX.SEA_HEIGHT);
const GEOS = [['H240', geoFor(240)], ['H240-safe', geoFor(240, 10)], ['H300', geoFor(300)], ['H400', geoFor(400)]];
for (const [tag, g] of GEOS) {
  check(g.horizon - g.deckY === S.DECK_ABOVE && g.deckY + S.BOAT_H > g.horizon, `[${tag}] the boat floats on the horizon line (deck ${g.horizon - g.deckY} px above it)`);
  const minFall = (g.deckY - S.ITEM - g.top) / CONFIG.fallMax;
  check(minFall >= 3, `[${tag}] every item falls at least 3 s before it reaches the deck (${minFall.toFixed(2)} s at the top speed)`);
}

/* ---------- the long run: 15 simulated minutes ---------- */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
function allFinite(o) {
  if (typeof o === 'number') return Number.isFinite(o);
  if (o && typeof o === 'object') return Object.values(o).every(allFinite);
  return true;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A boat that tracks the thing nearest to landing at up to 150 px/s, looks
 * away for 5 s every minute (so it misses now and then), and taps on every
 * nasty at a random point of its fall, a third of them in the last 0.5 percent.
 * The session clock runs with it and drives the dusk slowdown.
 */
function longRun(tag, geo, seed, minutes) {
  const r = rng(seed);
  const s = S.create(geo, CONFIG, {}, seed);
  const clock = SE.freshClock();
  const st = {
    steps: 0, nan: 0, maxItems: 0, maxNasty: 0, maxTreat: 0, spawned: 0, catches: 0, misses: 0, treatCatches: 0,
    nasties: 0, taps: 0, bites: 0, landedNasty: 0, biteLate: 0, spread: 0, outField: 0, speedChanged: 0, speedOut: 0,
    upward: 0, tooLong: 0, paceOut: 0, overCeil: 0, paceAt12: [], nastyGaps: [], treatGaps: [], kindOut: 0, fishKindOut: 0,
    countDown: 0, sky: 0, unlockedMax: s.unlocked, reshuffles: 0,
  };
  const seen = new Map(); // thing -> { vy, y, t0, kind }
  let lastSpawnX = s.lastX;
  let lastNastyAt = null;
  let lastTreatAt = null;
  let tapAt = null;
  let fraction = 0;
  let prevCaught = s.caught;
  let prevOrder = s.order.join();
  const [minX, maxX] = S.spawnRange(geo, CONFIG);
  const total = minutes * 60 * S.STEP_HZ;
  for (let i = 0; i < total; i++) {
    const t = i * S.DT;
    const ease = SE.slowdownOf(clock.active);
    // The tracker.
    const away = t % 60 >= 50 && t % 60 < 55;
    const things = [...s.items, ...(s.treat ? [s.treat] : [])].filter((o) => !o.low);
    let want = s.boatX;
    if (things.length) {
      const o = things.reduce((a, b) => (b.y > a.y ? b : a));
      want = S.swayX(o, CONFIG) + S.ITEM / 2 - S.BOAT_W / 2;
      if (away) want = want < geo.W / 2 ? geo.W - S.BOAT_W : 0;
    }
    S.moveBoat(s, Math.max(-1.25, Math.min(1.25, want - s.boatX)));
    // Taps on every nasty.
    const n = s.nasty;
    if (n && !n.hunted) {
      const over = S.swayX(n, CONFIG) + S.NASTY / 2;
      // The deck line is the first place it could land (the boat may slide under it); once low, the water.
      const land = n.low ? geo.horizon : geo.deckY;
      const start = geo.top + S.NASTY;
      // Tap at the step that reaches the chosen point (or just before, so a point late in the fall is never skipped).
      if (n.y + S.NASTY + n.vy * S.DT >= start + fraction * (land - start)) {
        const ev = S.tap(s, CONFIG);
        st.taps += 1;
        if (ev.length !== 1 || ev[0].type !== 'leap') st.landedNasty += 1000;
        tapAt = { t, y: n.y + S.NASTY };
      }
    }
    const before = new Set(s.items);
    const nastyBefore = s.nasty;
    const treatBefore = s.treat;
    SE.addPlay(clock, S.DT, i);
    const ev = S.step(s, CONFIG, SE.slowdownOf(clock.active));
    st.steps += 1;
    if (!allFinite(s)) st.nan += 1;
    st.maxItems = Math.max(st.maxItems, s.items.length);
    st.maxNasty = Math.max(st.maxNasty, s.nasty ? 1 : 0);
    st.maxTreat = Math.max(st.maxTreat, s.treat ? 1 : 0);
    // New spawns.
    const fresh = [...s.items.filter((o) => !before.has(o))];
    if (s.nasty && s.nasty !== nastyBefore) {
      fresh.push(s.nasty);
      st.nasties += 1;
      if (lastNastyAt !== null) st.nastyGaps.push(t - lastNastyAt);
      lastNastyAt = t;
      fraction = r() < 0.33 ? 0.995 + 0.005 * r() : r();
    }
    if (s.treat && s.treat !== treatBefore) {
      fresh.push(s.treat);
      if (lastTreatAt !== null) st.treatGaps.push(t - lastTreatAt);
      lastTreatAt = t;
    }
    for (const o of fresh) {
      // Every spawn within 70 px of the last normal item; only normal items move it,
      // so consecutive normal items are always within 70 px of each other.
      if (Math.abs(o.x - lastSpawnX) > CONFIG.spawnSpreadPx + 1e-9) st.spread += 1;
      if (o.x < minX - 1e-9 || o.x > maxX + 1e-9) st.outField += 1;
      if (s.items.includes(o)) {
        lastSpawnX = o.x;
        st.spawned += 1;
        if (!s.order.slice(0, s.unlocked).includes(o.k)) st.kindOut += 1;
        if (Math.abs(o.vy - S.fallSpeed(CONFIG, s.pace)) > 1e-9 && !ev.some((e) => e.type === 'catch' || e.type === 'miss')) st.speedOut += 1;
      }
      seen.set(o, { vy: o.vy, y: o.y, t0: t });
    }
    // Every thing in the air: same speed it was spawned with, always falling, inside the field.
    for (const o of [...s.items, ...(s.nasty ? [s.nasty] : []), ...(s.treat ? [s.treat] : [])]) {
      const k = seen.get(o);
      if (!k) continue;
      if (o.vy !== k.vy) st.speedChanged += 1;
      if (o.vy < CONFIG.fallMin - 1e-9 && o !== s.nasty && o !== s.treat) st.speedOut += 1;
      if (o.vy > CONFIG.fallMax + 1e-9) st.speedOut += 1;
      if (o.y < k.y - 1e-9) st.upward += 1;
      k.y = o.y;
      const x = S.swayX(o, CONFIG);
      if (x < -1e-9 || x > geo.W - S.ITEM + 1e-9 || o.y > geo.horizon) st.outField += 1;
      if (t - k.t0 > (geo.horizon - geo.top) / o.vy + 0.05) st.tooLong += 1;
    }
    for (const e of ev) {
      if (e.type === 'catch') { st.catches += 1; if (e.treat) st.treatCatches += 1; }
      else if (e.type === 'miss') st.misses += 1;
      else if (e.type === 'bite') {
        st.bites += 1;
        // A bite comes from the fish rising at 220 px/s against the nasty at 30: well before it can land.
        if (!tapAt || t - tapAt.t > (geo.fishY - tapAt.y) / (CONFIG.fishSpeed) + 2 * S.DT) st.biteLate += 1;
        tapAt = null;
      } else if (e.type === 'nastyBoat' || e.type === 'nastyWater') st.landedNasty += 1;
      else if (e.type === 'sky') st.sky += 1;
    }
    if (s.pace < -1e-12 || s.pace > 1 + 1e-12 || !finite(s.pace)) st.paceOut += 1;
    if (s.pace > S.ceilingOf(SE.slowdownOf(clock.active)) + 1e-12) st.overCeil += 1;
    if (clock.active >= 12 * 60) st.paceAt12.push(s.pace);
    for (const f of s.fish) if (f.k >= S.fishKinds(s, CONFIG)) st.fishKindOut += 1;
    st.maxFish = Math.max(st.maxFish || 0, s.fish.length);
    if (s.caught < prevCaught) st.countDown += 1;
    prevCaught = s.caught;
    st.unlockedMax = Math.max(st.unlockedMax, s.unlocked);
    if (s.order.join() !== prevOrder) { st.reshuffles += 1; prevOrder = s.order.join(); }
  }
  st.inAir = s.items.length;
  st.nastyLeft = s.nasty ? 1 : 0;
  st.final = s;
  return st;
}

const MIN = 15;
const runs = [];
GEOS.forEach(([tag, g], i) => runs.push([tag, longRun(tag, g, 1000 + i * 77, MIN), g]));
for (const [tag, st] of runs) {
  console.log(`  [${tag}] ${MIN} min: ${st.spawned} items, ${st.catches} caught (${st.treatCatches} treats), ${st.misses} missed, `
    + `${st.nasties} nasties, ${st.taps} taps, ${st.bites} bites, ${st.sky} sky events, kinds ${st.unlockedMax}, reshuffles ${st.reshuffles}`);
  check(st.nan === 0, `[${tag}] no NaN in ${st.steps} steps`);
  check(st.maxItems <= 3 && st.maxNasty <= 1 && st.maxTreat <= 1, `[${tag}] never more than 3 items and 1 nasty in the air (max ${st.maxItems}, ${st.maxNasty}; treat ${st.maxTreat})`);
  check(st.maxItems === 3, `[${tag}] the 3-item limit is reached and held`);
  check(st.spread === 0 && st.outField === 0,
    `[${tag}] consecutive normal items always within 70 px of each other, every nasty and treat within 70 px of the last item, all inside the field; nothing leaves the field`);
  check(st.spawned === st.catches - st.treatCatches + st.misses + st.inAir,
    `[${tag}] every item spawned is caught or missed, none lost (${st.spawned} = ${st.catches - st.treatCatches} + ${st.misses} + ${st.inAir} in the air)`);
  check(st.upward === 0 && st.tooLong === 0, `[${tag}] nothing stuck: everything falls every step and lands within its fall time`);
  check(st.catches > 0 && st.misses > 0, `[${tag}] the boat catches and misses now and then (${st.catches}, ${st.misses})`);
  check(st.nasties >= 15 && st.taps >= st.nasties - st.nastyLeft && st.bites === st.nasties - st.nastyLeft && st.landedNasty === 0,
    `[${tag}] every nasty eaten: ${st.nasties} nasties (${st.nastyLeft} still in the air at the end), ${st.taps} taps, ${st.bites} bites, ${st.landedNasty} landed`);
  check(st.biteLate === 0, `[${tag}] each bite comes within the fish's rise time of its tap, never after a landing`);
  check(st.nastyGaps.every((d) => d >= 20 - 1e-6 && d <= 30 + S.DT + 1e-6),
    `[${tag}] one nasty every 20 to 30 s (${Math.min(...st.nastyGaps).toFixed(2)} to ${Math.max(...st.nastyGaps).toFixed(2)})`);
  check(st.treatGaps.length >= 3 && st.treatGaps.every((d) => d >= 90 - 1e-6 && d <= 150 + 30),
    `[${tag}] the treat every 90 to 150 s, or as soon as the last one is down (${st.treatGaps.map((d) => d.toFixed(0)).join(', ')})`);
  check(st.speedChanged === 0, `[${tag}] a pace change never alters the speed of a thing already falling`);
  check(st.speedOut === 0, `[${tag}] items fall at 32 to 48 px/s, the speed set by the pace at their spawn`);
  check(st.paceOut === 0 && st.overCeil === 0, `[${tag}] pace stays between 0 and its ceiling (1 falling to 0 over minutes 10 to 12)`);
  check(st.paceAt12.length > 0 && st.paceAt12.every((p) => p === 0), `[${tag}] pace is 0 from minute 12 of active play (${st.paceAt12.length} steps)`);
  check(st.kindOut === 0 && st.fishKindOut === 0, `[${tag}] spawned kinds come from the unlocked set; fish kinds from the eaten count`);
  check(st.countDown === 0, `[${tag}] the count never goes down`);
}
check(runs.some(([, st]) => st.unlockedMax === 8 && st.reshuffles > 0), 'all 8 kinds join over a long run, then the order reshuffles');
check(runs.some(([, st]) => st.sky > 0), 'a caught treat sets off a sky event');

/* ---------- unit checks ---------- */

const G = GEOS[2][1]; // H300
const fresh = (seed = 7) => S.create(G, CONFIG, {}, seed);
const stepN = (s, n, ease = 0) => { const out = []; for (let i = 0; i < n; i++) out.push(...S.step(s, CONFIG, ease)); return out; };
const quiet = (s) => { s.spawnIn = 999; s.nastyIn = 999; s.treatIn = 999; s.items = []; s.nasty = null; s.treat = null; s.fish = []; };
const clone = (o) => JSON.parse(JSON.stringify(o));

{
  // A fresh scene.
  const s = fresh();
  check(s.pace === 0.3 && s.unlocked === 2 && s.caught === 0 && s.items.length === 0 && s.boatX === (135 - 24) / 2,
    'a fresh scene: pace 0.3, 2 kinds, count 0, boat centred');
  check(s.nastyIn >= 20 && s.nastyIn <= 30 && s.treatIn >= 90 && s.treatIn <= 150 && Math.abs(s.spawnIn - S.spawnGap(CONFIG, 0.3)) < 1e-12,
    'timers start in range: nasty 20 to 30 s, treat 90 to 150 s, spawn gap by the pace');
  check(S.fallSpeed(CONFIG, 0) === 32 && S.fallSpeed(CONFIG, 1) === 48 && S.fallSpeed(CONFIG, 0.5) === 40
    && S.spawnGap(CONFIG, 0) === 1.7 && Math.abs(S.spawnGap(CONFIG, 1) - 1.1) < 1e-12 && Math.abs(S.spawnGap(CONFIG, 0.5) - 1.4) < 1e-12,
    'pace sets fall speed 32 to 48 and spawn gap 1.7 to 1.1, linearly');
}

function itemAt(s, x, y, vy = 40) {
  const it = { x, y, vy, ph: 0, k: s.order[0], low: false };
  s.items.push(it);
  return it;
}

{
  // Caught: on the deck, count +1, dip, pace +0.02, run +1.
  const s = fresh();
  quiet(s);
  itemAt(s, s.boatX + 8, G.deckY - S.ITEM - 2);
  const ev = [];
  for (let i = 0; i < 60 && !ev.some((e) => e.type === 'catch'); i++) ev.push(...S.step(s, CONFIG));
  const c = ev.filter((e) => e.type === 'catch');
  check(c.length === 1 && s.caught === 1 && s.items.length === 0 && Math.abs(s.pace - 0.32) < 1e-12 && s.dip > 0 && s.dip <= S.DIP_S,
    `caught on the deck: count +1, pace +0.02 (${s.pace.toFixed(3)}), the boat dips`);
  check(S.runAfter(4, ev) === 5, 'the run goes up by one per catch');
  stepN(s, 13);
  check(s.dip === 0, 'the dip lasts 100 ms');
  // Missed: the water, pace -0.15, no count change, run back to 0.
  s.boatX = 0;
  itemAt(s, 100, G.horizon - S.ITEM - 2);
  const ev2 = stepN(s, 30);
  check(ev2.some((e) => e.type === 'miss') && s.caught === 1 && Math.abs(s.pace - 0.17) < 1e-12,
    `missed: a splash in the water, count unchanged, pace -0.15 (${s.pace.toFixed(3)})`);
  check(S.runAfter(9, ev2) === 0, 'the run resets silently on a miss');
  s.pace = 0.05;
  itemAt(s, 100, G.horizon - S.ITEM - 1);
  stepN(s, 30);
  check(s.pace === 0, 'pace is clamped at 0');
  s.pace = 0.995;
  s.boatX = 50;
  itemAt(s, 58, G.deckY - S.ITEM - 1);
  stepN(s, 30);
  check(s.pace === 1, 'pace is clamped at 1');
  // An item beside the boat that passes the deck line cannot be caught by sliding under it later.
  s.boatX = 0;
  const it = itemAt(s, 100, G.deckY - S.ITEM - 0.5);
  stepN(s, 5);
  s.boatX = 100 - 8;
  const ev3 = stepN(s, 60);
  check(it.low && ev3.some((e) => e.type === 'miss') && !ev3.some((e) => e.type === 'catch'), 'past the deck line beside the boat, a thing can only reach the water');
}

{
  // The pace applies to new spawns only.
  const s = fresh();
  quiet(s);
  s.pace = 0;
  s.spawnIn = 0;
  stepN(s, 1);
  const a = s.items[0];
  check(a && a.vy === 32, 'an item spawned at pace 0 falls at 32');
  s.pace = 1;
  stepN(s, 10);
  check(a.vy === 32, 'raising the pace does not change an item in the air');
  s.spawnIn = 0;
  stepN(s, 1);
  const b = s.items[1];
  check(b && b.vy === 48 && Math.abs(s.spawnIn - 1.1) < 1e-9, 'the next spawn takes the new pace: 48 px/s, next gap 1.1 s');
  s.items.length = 0;
  S.resetPace(s, CONFIG);
  check(s.pace === 0.3, 'a session-clock reset starts the pace at 0.3 again');
  // The ceiling falls from 1 to 0 over minutes 10 to 12 and the pace follows it down.
  check(SE.slowdownOf(600) === 0 && SE.slowdownOf(660) === 0.5 && SE.slowdownOf(720) === 1 && S.ceilingOf(0.5) === 0.5 && S.ceilingOf(1) === 0,
    'the ceiling: 1 at minute 10, 0.5 at minute 11, 0 at minute 12');
  s.pace = 0.9;
  quiet(s);
  stepN(s, 1, 0.5);
  check(s.pace === 0.5, 'the pace follows the falling ceiling down');
  stepN(s, 1, 1);
  check(s.pace === 0, 'at the end of the slowdown the pace is 0');
}

{
  // Spawn limits and the nasty in place of a normal spawn.
  const s = fresh();
  quiet(s);
  s.spawnIn = 0;
  for (let i = 0; i < 3; i++) { s.spawnIn = 0; stepN(s, 1); }
  s.spawnIn = 0;
  stepN(s, 1);
  check(s.items.length === 3 && s.spawnIn === 0, 'with 3 in the air the next spawn waits for a free slot');
  s.nastyIn = 0;
  stepN(s, 1);
  check(s.nasty && s.nasty.vy === 30 && s.items.length === 3 && Math.abs(s.spawnIn - (S.spawnGap(CONFIG, s.pace))) < 1e-9
    && s.nastyIn >= 20 - 1e-9 && s.nastyIn <= 30,
    'a nasty spawns at 30 px/s in place of a normal spawn (the spawn gap starts again), the next one 20 to 30 s later');
  s.pace = 1;
  const n = s.nasty;
  stepN(s, 10);
  check(n.vy === 30, 'the nasty does not follow the pace');
  s.nastyIn = 0;
  stepN(s, 1);
  check(s.nasty === n, 'never more than one nasty in the air: a due nasty waits');
}

{
  // A tap with a nasty in the air always bites before it lands, wherever it is.
  let cases = 0;
  let bad = 0;
  let maxMs = 0;
  let worstHold = 0;
  for (const [tag, g] of GEOS) {
    for (const over of [false, true, 'slide']) {
      for (let k = 0; k <= 400; k++) {
        const s = S.create(g, CONFIG, {}, 11 + k);
        quiet(s);
        const nx = 60;
        s.boatX = over === true ? nx - 8 : 0;
        const land = over === true ? g.deckY : g.horizon;
        // Bottom from just under the HUD to a hair above where it would land.
        const f = k < 300 ? k / 300 : 1 - 10 ** -(1 + (k - 300) / 20);
        const bottom = g.top + S.NASTY + f * (land - 0.0001 - g.top - S.NASTY);
        s.nasty = { x: nx, y: bottom - S.NASTY, vy: 30, k: 0, low: over !== true && bottom >= g.deckY, hunted: false };
        const ev = S.tap(s, CONFIG);
        if (over === 'slide') s.boatX = nx - 8; // the boat slides under it after the tap
        let out = [];
        let n = 0;
        let lowest = 0;
        while (n < 400 && !out.some((e) => e.type === 'bite' || e.type === 'nastyBoat' || e.type === 'nastyWater')) {
          out = S.step(s, CONFIG);
          n++;
          if (s.nasty) lowest = Math.max(lowest, s.nasty.y + S.NASTY - bottom);
        }
        cases++;
        const bite = out.find((e) => e.type === 'bite');
        if (ev[0].type !== 'leap' || !bite || out.some((e) => e.type !== 'bite' && e.type !== 'catch' && e.type !== 'miss')
          || bite.y >= land || s.eaten !== 1) bad++;
        maxMs = Math.max(maxMs, n * S.DT * 1000);
        if (f > 0.99) worstHold = Math.max(worstHold, n);
      }
    }
  }
  check(bad === 0, `a tap with a nasty in the air bites it before it lands: ${cases} cases (every height, over the water, over the boat, boat sliding under), ${bad} failures`);
  console.log(`  [bite] slowest bite ${maxMs.toFixed(0)} ms after the tap; a nasty about to land is bitten within ${worstHold} steps`);
  check(worstHold <= 6, `a nasty tapped at the last moment is held at most ${worstHold} steps (${(worstHold * S.DT * 1000).toFixed(0)} ms) before the bite`);

  // The fish leaps from directly below; the bite is counted and the fish arcs back with a splash.
  const s = fresh();
  quiet(s);
  s.nasty = { x: 40, y: 100, vy: 30, k: 1, low: false, hunted: false };
  S.tap(s, CONFIG);
  const f = s.fish[0];
  check(f.m === 'leap' && f.cx === 43.5 && f.y === G.fishY && f.y > G.horizon, 'the fish leaps from the sea directly below the nasty');
  const y0 = f.y;
  S.step(s, CONFIG);
  check(Math.abs((y0 - f.y) - 220 * S.DT) < 1e-9, 'the fish rises at 220 px/s');
  const ev = stepN(s, 200);
  check(ev.filter((e) => e.type === 'bite').length === 1 && s.eaten === 1 && ev.some((e) => e.type === 'dive') && s.fish.length === 0,
    'it eats the nasty where they meet, arcs over and dives back with a splash');
  // No nasty: a small hop beside the boat, no bite.
  const h = fresh();
  quiet(h);
  const hop = S.tap(h, CONFIG);
  const hev = stepN(h, 120);
  check(hop[0].type === 'hop' && !hev.some((e) => e.type === 'bite' || e.type === 'dive') && h.fish.length === 0 && h.eaten === 0,
    'a tap with no nasty: a small hop beside the boat, no bite, no splash');
  // A second tap while a fish is already after the nasty: a hop.
  const d = fresh();
  quiet(d);
  d.nasty = { x: 40, y: 100, vy: 30, k: 1, low: false, hunted: false };
  S.tap(d, CONFIG);
  check(S.tap(d, CONFIG)[0].type === 'hop' && d.fish.filter((x) => x.m === 'leap').length === 1, 'a second tap while a fish is on its way is a hop');
  // Rapid taps fill the hops, then a nasty: the leap still happens and the
  // fish stay within MAX_FISH, so the scene saves and restores the same.
  {
    const q = fresh(31);
    quiet(q);
    q.spawnIn = 1; q.nastyIn = 25; q.treatIn = 100; // timers in their saved ranges
    const hops = [0, 1, 2, 3].map(() => S.tap(q, CONFIG));
    q.nasty = { x: 40, y: 100, vy: 30, k: 1, low: false, hunted: false };
    const leap = S.tap(q, CONFIG);
    const more = S.tap(q, CONFIG);
    check(leap.length === 1 && leap[0].type === 'leap' && q.nasty.hunted && q.fish.length <= S.MAX_FISH,
      `4 rapid taps, then a nasty: the tap still sends a leap, ${q.fish.length} fish up (at most ${S.MAX_FISH}; hops ${hops.filter((e) => e.length).length}, then ${more.length ? more[0].type : 'nothing'})`);
    const saved = clone(q);
    const r = S.restore(clone(saved), G, CONFIG);
    check(r && JSON.stringify(r) === JSON.stringify(saved), 'that scene (hops, a leap and a tap more) saves and restores the same');
    const ev = stepN(q, 240);
    check(ev.filter((e) => e.type === 'bite').length === 1 && q.eaten === 1, 'and the leaping fish still eats the nasty');
  }
  // Fish kinds: 2 at start, +1 every 5 eaten, up to 6.
  check([0, 4, 5, 9, 10, 20, 100].map((e) => S.fishKinds({ eaten: e }, CONFIG)).join() === '2,2,3,3,4,6,6', 'fish kinds: 2, then one more every 5 eaten, up to 6');
}

{
  // A nasty landing uneaten changes nothing but the cosmetics.
  const s = fresh();
  quiet(s);
  s.pace = 0.5;
  s.boatX = 50;
  s.nasty = { x: 58, y: G.deckY - S.NASTY - 1, vy: 30, k: 0, low: false, hunted: false };
  const before = clone({ caught: s.caught, eaten: s.eaten, pace: s.pace });
  const ev = stepN(s, 60);
  check(ev.some((e) => e.type === 'nastyBoat') && s.rock > 0 && s.rock <= S.ROCK_S && s.ink === 0
    && JSON.stringify({ caught: s.caught, eaten: s.eaten, pace: s.pace }) === JSON.stringify(before) && S.runAfter(7, ev) === 7,
    'a nasty on the boat: the boat rocks for 1 s; count, pace and run unchanged');
  stepN(s, 120);
  check(s.rock === 0, 'the rocking stops after a second');
  s.boatX = 0;
  s.nasty = { x: 100, y: G.horizon - S.NASTY - 1, vy: 30, k: 2, low: false, hunted: false };
  const ev2 = stepN(s, 60);
  check(ev2.some((e) => e.type === 'nastyWater') && s.ink > S.INK_S - 1 && s.rock === 0
    && JSON.stringify({ caught: s.caught, eaten: s.eaten, pace: s.pace }) === JSON.stringify(before) && S.runAfter(7, ev2) === 7,
    'a nasty in the water: the ink cloud darkens the sea; count, pace and run unchanged');
  stepN(s, Math.ceil((S.INK_S + S.INK_FADE_S) * S.STEP_HZ));
  check(s.ink === 0, `the ink lasts ${S.INK_S} s, then fades over ${S.INK_FADE_S} s`);
}

{
  // The rare treat.
  const s = fresh();
  quiet(s);
  s.treatIn = 0;
  stepN(s, 1);
  const t = s.treat;
  check(t && t.vy === CONFIG.treatSpeed && s.treatIn >= 90 - 1e-9 && s.treatIn <= 150 && s.items.length === 0,
    'the treat drifts down slowly on its own timer, 90 to 150 s');
  s.boatX = t.x - 8;
  t.y = G.deckY - S.ITEM - 0.5;
  t.ph = 0;
  const ev = stepN(s, 10);
  check(ev.some((e) => e.type === 'catch' && e.treat) && ev.some((e) => e.type === 'sky') && s.sky && S.SKY_EVENTS.includes(s.sky.k),
    `catching it sets off one sky event (${s.sky && s.sky.k})`);
  const m2 = fresh(9);
  quiet(m2);
  m2.boatX = 0;
  m2.pace = 0.6;
  m2.treat = { x: 100, y: G.horizon - S.ITEM - 1, vy: 20, ph: 0, k: 0, low: false };
  const ev2 = stepN(m2, 30);
  check(!m2.treat && ev2.length === 0 && m2.pace === 0.6 && !m2.sky, 'missing it does nothing: no splash, no pace change, no run reset');
}

{
  // Variety: 2 kinds, one more every 40 catches until all 8, then the order reshuffles.
  const s = fresh();
  quiet(s);
  s.boatX = 50;
  const unl = [];
  for (let i = 1; i <= 40 * 8; i++) {
    itemAt(s, 58, G.deckY - S.ITEM - 0.2);
    stepN(s, 2);
    if (i % 40 === 0) unl.push(s.unlocked);
  }
  check(unl.join() === '3,4,5,6,7,8,8,8', `a new kind every 40 catches up to 8 (${unl.join()})`);
  const o1 = s.order.join();
  for (let i = 0; i < 40; i++) { itemAt(s, 58, G.deckY - S.ITEM - 0.2); stepN(s, 2); }
  check(s.order.join() !== o1 && [...s.order].sort().join() === '0,1,2,3,4,5,6,7', 'with all 8 in, the order reshuffles');
  // A fresh or rebuilt scene takes its kinds from the all-time count, as fish kinds from eaten.
  const u = [0, 39, 40, 79, 80, 239, 240, 500].map((c) => S.create(G, CONFIG, { caught: c }, 3).unlocked);
  check(u.join() === '2,2,3,3,4,7,8,8', `a fresh scene unlocks 2 + one per 40 stored catches, up to 8 (${u.join()})`);
  const mid = S.create(G, CONFIG, { caught: 50 }, 3);
  check(mid.kindCatches === 10, 'and the next kind joins at the next multiple of 40 catches');
}

/* ---------- input: taps, the pause grace, the resume ---------- */

{
  const C = CONFIG;
  const play = () => {
    const c = S.createControl();
    S.ctlDown(c, 1, 0, 50, 200, C);
    S.ctlTick(c, 250);
    return c;
  };
  // First launch: paused; finger down resumes after 250 ms; that touch is never a tap.
  const c = S.createControl();
  check(c.mode === 'paused', 'the control starts paused');
  S.ctlDown(c, 1, 0, 50, 200, C);
  check(c.mode === 'resuming' && S.ctlTick(c, 249) === null && S.ctlTick(c, 250) === 'start' && c.mode === 'running',
    'finger down while paused resumes after 250 ms');
  check(S.ctlUp(c, 1, 260, C) === false, 'the touch that resumed play never counts as a tap, however quick');
  const c2 = S.createControl();
  S.ctlDown(c2, 1, 0, 50, 200, C);
  check(S.ctlUp(c2, 1, 100, C) === false && c2.mode === 'paused', 'lifted before the resume: no tap, still paused');

  // A tap: down and up within 200 ms, moving under 4 px.
  const tapCase = (ms, dx, dy) => {
    const k = play();
    S.ctlUp(k, 1, 1000, C);
    S.ctlDown(k, 2, 1100, 60, 200, C);
    if (dx || dy) S.ctlMove(k, 2, 60 + dx, 200 + dy, C);
    return S.ctlUp(k, 2, 1100 + ms, C);
  };
  check(tapCase(150, 2, 1) === true && tapCase(200, 0, 0) === true, 'down and up within 200 ms, moving under 4 px: a tap');
  check(tapCase(201, 0, 0) === false && tapCase(350, 0, 0) === false && tapCase(1200, 0, 0) === false,
    'a slow lift (over 200 ms) is not a tap');
  check(tapCase(100, 4, 0) === false && tapCase(100, 0, 3.99) === true && tapCase(100, 3, 3) === false,
    'moving 4 logical px or more is not a tap');
  {
    // Moved away and back still counts as moved.
    const k = play();
    S.ctlUp(k, 1, 1000, C);
    S.ctlDown(k, 2, 1100, 60, 200, C);
    S.ctlMove(k, 2, 70, 200, C);
    S.ctlMove(k, 2, 60, 200, C);
    check(S.ctlUp(k, 2, 1150, C) === false, 'a quick drag out and back is not a tap');
  }
  // The resume delay is longer than a tap, and a touch that starts while
  // paused never fires a fish, however quickly it lifts.
  check(C.resumeDelayMs > C.tapMs, `the resume delay (${C.resumeDelayMs} ms) is longer than a tap (${C.tapMs} ms)`);
  {
    const s = fresh();
    quiet(s);
    s.nasty = { x: 40, y: 100, vy: 30, k: 0, low: false, hunted: false };
    let taps = 0;
    for (let hold = 0; hold <= C.resumeDelayMs + C.tapMs + 50; hold += 1) {
      const k = S.createControl();
      S.ctlDown(k, 1, 1000, 60, 200, C);
      for (let t = 1000; t <= 1000 + hold; t += 1) S.ctlTick(k, t);
      if (S.ctlUp(k, 1, 1000 + hold, C)) { taps += 1; S.tap(s, C); }
    }
    check(taps === 0 && s.fish.length === 0 && !s.nasty.hunted,
      'a touch that begins while paused, lifted after 0 to 500 ms, never fires a fish');
  }
  // A slow lift with a nasty in the air never fires a fish (the game taps only on a tap).
  {
    const s = fresh();
    quiet(s);
    s.nasty = { x: 40, y: 100, vy: 30, k: 0, low: false, hunted: false };
    const k = play();
    S.ctlUp(k, 1, 1000, C);
    S.ctlDown(k, 2, 1100, 60, 200, C);
    if (S.ctlUp(k, 2, 1100 + 260, C)) S.tap(s, C);
    check(s.fish.length === 0 && !s.nasty.hunted, 'a slow lift with a nasty in the air fires no fish');
  }
  // The pause grace: play goes on for 400 ms after the finger lifts; a tap is never read as a pause.
  {
    const k = play();
    S.ctlUp(k, 1, 1000, C); // the thumb lifts: grace
    let paused = false;
    for (let t = 1000; t < 1100; t += 4) if (S.ctlTick(k, t) === 'pause') paused = true;
    S.ctlDown(k, 2, 1100, 60, 200, C); // a tap inside the grace
    for (let t = 1100; t < 1250; t += 4) if (S.ctlTick(k, t) === 'pause') paused = true;
    const wasTap = S.ctlUp(k, 2, 1250, C);
    for (let t = 1250; t < 1650; t += 4) if (S.ctlTick(k, t) === 'pause') paused = true;
    check(wasTap && !paused && k.mode === 'running', 'a tap is never read as a pause: play runs through the tap and 400 ms after it');
    check(S.ctlTick(k, 1650) === 'pause' && k.mode === 'paused', 'with no finger down, play pauses 400 ms after the last lift');
    // Every tap timing: down at any point of the grace, up within 200 ms: never a pause before up + 400 ms.
    let bad = 0;
    for (let d = 0; d <= 400; d += 10) {
      for (let hold = 10; hold <= 200; hold += 30) {
        const q = play();
        S.ctlUp(q, 1, 1000, C);
        let p = null;
        for (let t = 1000; t < 1000 + d; t += 2) p = p || S.ctlTick(q, t);
        if (p) continue; // grace was over: the touch resumes and is not a tap (checked above)
        S.ctlDown(q, 2, 1000 + d, 60, 200, C);
        for (let t = 1000 + d; t < 1000 + d + hold; t += 2) p = p || S.ctlTick(q, t);
        const up = 1000 + d + hold;
        const was = S.ctlUp(q, 2, up, C);
        for (let t = up; t < up + 400; t += 2) p = p || S.ctlTick(q, t);
        if (p || !was) bad++;
      }
    }
    check(bad === 0, `taps at every point of the grace: each is a tap and none pauses play before 400 ms after it (${bad} bad)`);
  }
  // Finger down during the grace keeps playing at once, no resume wait.
  {
    const k = play();
    S.ctlUp(k, 1, 1000, C);
    S.ctlDown(k, 2, 1300, 60, 200, C);
    check(k.mode === 'running' && S.ctlTick(k, 1800) === null && k.mode === 'running', 'finger down during the grace: play goes on, no resume delay');
  }
  // Relative drag: the first finger drives at 1.2; a second finger does not.
  {
    const k = play();
    check(Math.abs(S.ctlMove(k, 1, 60, 200, C) - 12) < 1e-9, 'relative drag at 1.2: 10 px of finger moves the boat 12');
    S.ctlDown(k, 2, 300, 20, 200, C);
    check(S.ctlMove(k, 2, 40, 200, C) === 0, 'a second finger does not move the boat');
    S.ctlUp(k, 1, 400, C);
    check(Math.abs(S.ctlMove(k, 2, 45, 200, C) - 6) < 1e-9 && k.mode === 'running', 'when the first lifts, the next finger drives from where it is');
    const s = fresh();
    S.moveBoat(s, 500);
    const r = s.boatX;
    S.moveBoat(s, -500);
    check(r === 135 - 24 && s.boatX === 0, 'the boat is clamped to the field');
  }
  // Hidden or closed: paused at once.
  {
    const k = play();
    S.ctlSleep(k);
    check(k.mode === 'paused' && k.pointers.size === 0 && k.graceEnd === null, 'page hidden: paused at once, fingers cleared');
  }
}

/* ---------- save and restore ---------- */

{
  const s = fresh(21);
  for (let i = 0; i < 120 * 40; i++) {
    if (s.nasty && !s.nasty.hunted && s.nasty.y > 120) S.tap(s, CONFIG);
    S.step(s, CONFIG);
  }
  s.nasty = { x: 40, y: 100, vy: 30, k: 1, low: false, hunted: false };
  S.tap(s, CONFIG);
  s.treat = { x: 60, y: 90, vy: 20, ph: 1, k: s.order[0], low: false };
  s.sky = { k: 'gull', t: 1 };
  const saved = clone(s);
  const r = S.restore(clone(saved), G, CONFIG);
  check(r && JSON.stringify(r) === JSON.stringify(saved), 'save and restore: items in the air, the hunting fish, boat, counts, timers, kinds, all the same');
  stepN(s, 120 * 20);
  stepN(r, 120 * 20);
  check(JSON.stringify(r) === JSON.stringify(s), 'a restored game plays on exactly as the original (same seed, same 20 s)');
  const bad = [
    '{nope', null, 5, { ...saved, v: 0 }, { ...saved, v: 2 }, { ...saved, pace: 1.5 }, { ...saved, pace: NaN },
    { ...saved, items: [...saved.items, ...saved.items, ...saved.items, ...saved.items] }, { ...saved, order: [0, 1, 2] },
    { ...saved, boatX: 'x' }, { ...saved, nasty: { ...saved.nasty, hunted: false } }, { ...saved, fish: 'x' },
    { ...saved, geo: { ...saved.geo, W: 200 } }, { ...saved, spawnIn: -1 }, { ...saved, unlocked: 9 },
  ];
  check(bad.every((b) => S.restore(typeof b === 'string' ? b : clone(b), G, CONFIG) === null),
    `corrupt or old-version saves are refused (${bad.length} kinds)`);
  {
    // As catch.js loadGame(): a corrupt save is refused, a fresh scene built from its readable counts.
    const corrupt = { ...clone(saved), caught: 500, pace: 'x' };
    const rebuilt = S.restore(clone(corrupt), G, CONFIG) === null ? S.create(G, CONFIG, S.readCounts(corrupt), 5) : null;
    check(rebuilt && rebuilt.caught === 500 && rebuilt.unlocked === 8,
      `a corrupt save with 500 catches rebuilds a scene with all 8 kinds (${rebuilt && rebuilt.unlocked})`);
  }
  check(JSON.stringify(S.readCounts({ ...saved, v: 0 })) === JSON.stringify({ caught: saved.caught, eaten: saved.eaten })
    && JSON.stringify(S.readCounts({ caught: -1, eaten: 'x' })) === JSON.stringify({ caught: null, eaten: null })
    && JSON.stringify(S.readCounts('{nope')) === JSON.stringify({ caught: null, eaten: null }),
    'the counts are read from an old or corrupt save where they can be');
  const tall = S.restore(clone(saved), GEOS[3][1], CONFIG);
  check(tall && tall.items.every((it) => it.y >= GEOS[3][1].top && it.y <= GEOS[3][1].horizon) && tall.fish.every((f) => f.y > -50),
    'a save restored on a taller screen fits the new sky');
}

/* ---------- the look: shapes and readability ---------- */

{
  const L = S.LOOK;
  check(L.items.length === 8 && L.nasties.length === 3 && L.fish.colours.length === 6, '8 kinds to catch, 3 nasty kinds, 6 fish kinds');
  check(L.items.every((it) => { const g = S.spriteGrid(it.mask, true); return g.length === 7 && g[0].length === 7; }), 'things to catch are 7 x 7');
  check(L.nasties.every((n) => n.mask.length === 7 && n.mask[0].length === 7), 'nasty ones are 7 x 7');
  const fg = S.spriteGrid(L.fish.mask, true);
  check(fg.length === 5 && fg[0].length === 9, 'fish are 9 x 5');
  const warm = new Set(['coral', 'sun', 'row0', 'row1', 'row2', 'row3', 'row4', 'row5', 'row6']);
  check(L.items.every((it) => warm.has(it.colour)) && L.nasties.every((n) => n.colour === 'blue'),
    'things to catch in the warm tokens; the nasty ones in the blue token');
  check(L.items.every((it) => [...S.edgeKeys(S.spriteGrid(it.mask, true))].join() === 'o'),
    'every thing to catch is edged all round by its outline');
  check(L.nasties.every((n) => [...S.edgeKeys(n.mask)].join() === '#'), 'every nasty one is edged by its blue body, its shade inside');
  // Shape, not colour alone: spiky or ragged against round, measured as
  // perimeter squared over area of the drawn silhouette (a disc is lowest).
  const ragged = (g) => {
    let a = 0;
    let p = 0;
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[0].length; c++) {
        if (g[r][c] === '.') continue;
        a++;
        for (const [y, x] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) if (!g[y] || !g[y][x] || g[y][x] === '.') p++;
      }
    }
    return (p * p) / a;
  };
  const rn = L.nasties.map((n) => ragged(n.mask));
  const ri = L.items.map((it) => ragged(S.spriteGrid(it.mask, true)));
  check(Math.min(...rn) > Math.max(...ri),
    `the nasty ones are spiky or ragged, the things to catch rounder: perimeter^2/area ${rn.map((v) => v.toFixed(0)).join(',')} against at most ${Math.max(...ri).toFixed(0)}`);
}

{
  // Readability (PLAN §6b Accept, as B2): the boat, the things to catch, the
  // nasty ones and the fish against every scene colour under them, at sunset
  // and at each of the 10 steps. CIE76 colour difference in CIELAB (D65),
  // threshold 10. Each sprite is measured by the colours on its edge, the
  // ones that meet the scene: an outlined sprite's outline, a nasty's blue body.
  const THRESH = 10;
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lab = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(lin);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  };
  const dE = (a, b) => { const p = lab(a); const q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  const colour = (name) => (name.startsWith('row') ? T.BRICK_ROWS[Number(name.slice(3))] : T.COLORS[name]);
  const keyColour = (k, body) => ({ '#': body, h: T.highlight(body), s: T.shade(body), o: T.shade(body), c: T.COLORS.sun })[k];
  const edges = (grid, body) => [...S.edgeKeys(grid)].map((k) => keyColour(k, body));
  const ink = T.shade(T.COLORS.blue);
  const screens = [['H240', 240, 0], ['H240-safe', 240, 10], ['H300', 300, 0], ['H400', 400, 0]];
  const results = [];
  const info = [];
  for (const [tag, H, safeTop] of screens) {
    const g = geoFor(H, safeTop);
    const horizon = g.horizon;
    const bandsOver = (y0, y1) => {
      const out = [];
      for (let i = 0; i < T.SKY_BANDS; i++) {
        const a = Math.round((i * horizon) / T.SKY_BANDS);
        const b = Math.round(((i + 1) * horizon) / T.SKY_BANDS);
        if (a < y1 && b > y0) out.push(i);
      }
      return out;
    };
    const sky = bandsOver(g.top, horizon); // things fall through the whole open sky
    const boatSky = bandsOver(g.deckY - 11, g.deckY + 1); // mast, sails, hull top (dip included)
    const hud = bandsOver(5 + safeTop, 5 + safeTop + 16);
    for (let k = 0; k <= 10; k++) {
      const pal = T.scenePalette(k / 10);
      const sun = k < 10 ? [['sun', T.COLORS.sun]] : [];
      const skyBg = [...sky.map((i) => [`sky band ${i + 1}`, pal.sky[i]]), ...sun, ['cloud', T.COLORS.cloud]];
      const seaBg = pal.sea.flatMap((c, i) => [[`sea band ${i + 1}`, c], [`inked sea band ${i + 1}`, T.mix(c, ink, 0.35)]]);
      const add = (what, fgs, bgs) => {
        for (const fg of fgs) for (const [on, bg] of bgs) results.push({ tag, k, what, fg, on, bg, d: dE(fg, bg) });
      };
      // The boat: hull (its top in the sky and the sun, its bottom 2 px in the first sea band), mast, sail and jib edges.
      const boatBg = [...boatSky.map((i) => [`sky band ${i + 1}`, pal.sky[i]]), ...sun];
      add('boat hull', [T.COLORS.coral], [...boatBg, [`sea band 1`, pal.sea[0]], ['inked sea band 1', T.mix(pal.sea[0], ink, 0.35)]]);
      add('boat mast', [T.shade(T.COLORS.coral)], boatBg);
      add('boat sail edge', [T.shade(T.COLORS.sun)], boatBg);
      add('boat jib edge', [T.shade(T.BRICK_ROWS[4])], boatBg);
      for (const it of S.LOOK.items) add(`item ${it.name}`, edges(S.spriteGrid(it.mask, true), colour(it.colour)), skyBg);
      for (const n of S.LOOK.nasties) add(`nasty ${n.name}`, edges(n.mask, colour(n.colour)), skyBg);
      const fishGrid = S.spriteGrid(S.LOOK.fish.mask, true);
      for (const name of S.LOOK.fish.colours) add(`fish ${name}`, edges(fishGrid, colour(name)), [...skyBg, ...seaBg]);
      add('count and run', [T.COLORS.blue], hud.map((i) => [`sky band ${i + 1}`, pal.sky[i]]));
      // For the record only: the sail's cream fill and the parachute (cosmetic).
      for (const [on, bg] of boatBg) info.push({ tag, k, what: 'sail fill (cream)', fg: T.COLORS.sun, on, bg, d: dE(T.COLORS.sun, bg) });
    }
  }
  const worst = (rows) => rows.reduce((a, b) => (b.d < a.d ? b : a));
  const fmt = (r) => `${r.what} ${r.fg} on ${r.on} ${r.bg}, step ${r.k}, ${r.tag}: dE ${r.d.toFixed(2)}`;
  console.log(`  [readability] weakest at sunset: ${fmt(worst(results.filter((r) => r.k === 0)))}`);
  console.log(`  [readability] weakest over the 10 steps: ${fmt(worst(results.filter((r) => r.k > 0)))}`);
  for (const group of ['boat', 'item', 'nasty', 'fish', 'count']) {
    const mine = results.filter((r) => r.what.startsWith(group));
    console.log(`  [readability] ${group}: weakest ${fmt(worst(mine))}`);
  }
  const under = results.filter((r) => r.d < THRESH);
  for (const u of under) console.log(`  [readability] UNDER THRESHOLD: ${fmt(u)}`);
  for (const [tag] of screens) {
    const mine = results.filter((r) => r.tag === tag);
    check(mine.every((r) => r.d >= THRESH),
      `[${tag}] boat, items, nasties, fish and count readable at sunset and all 10 steps: every edge and scene pair dE >= ${THRESH} (weakest ${worst(mine).d.toFixed(2)})`);
  }
  const sailUnder = info.filter((r) => r.d < THRESH);
  console.log(`  [readability] for the record: the sail's cream fill (inside its shaded edge) is under ${THRESH} on ${sailUnder.length} of ${info.length} pairs, weakest ${fmt(worst(info))}`);
}

/* ---------- haptics: the shared tick with the game's events ---------- */

{
  let clockMs = 0;
  const calls = [];
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clockMs }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', {
    value: { vibrate: (ms) => { calls.push([clockMs, ms]); return true; } }, configurable: true,
  });
  const H = await import('../shared/haptics.js');
  const { setHaptics } = await import('../shared/settings.js');
  // As catch.js handle(): catch 8 ms, bite 16 ms, nothing else.
  const feed = (events, t) => {
    clockMs = t * 1000;
    for (const e of events) {
      if (e.type === 'catch') H.tick(CONFIG.hapticCatchMs);
      else if (e.type === 'bite') H.tick(CONFIG.hapticBiteMs);
    }
  };
  const play = (minutes, seed) => {
    const s = fresh(seed);
    let n = 0;
    for (let i = 0; i < minutes * 60 * 120; i++) {
      const items = s.items.filter((o) => !o.low);
      if (items.length) {
        const o = items.reduce((a, b) => (b.y > a.y ? b : a));
        S.moveBoat(s, Math.max(-1.5, Math.min(1.5, S.swayX(o, CONFIG) + 3.5 - 12 - s.boatX)));
      }
      if (s.nasty && !s.nasty.hunted && s.nasty.y > 150) S.tap(s, CONFIG);
      const ev = S.step(s, CONFIG);
      n += ev.filter((e) => e.type === 'catch' || e.type === 'bite').length;
      feed(ev, i * S.DT);
    }
    return { n, s };
  };
  setHaptics(true);
  const on = play(3, 5);
  const kinds = new Set(calls.map((c) => c[1]));
  let minGap = Infinity;
  for (let i = 1; i < calls.length; i++) minGap = Math.min(minGap, calls[i][0] - calls[i - 1][0]);
  console.log(`  [haptics on] ${calls.length} vibrate calls for ${on.n} catches and bites, min gap ${minGap.toFixed(1)} ms`);
  check(calls.length > 0 && [...kinds].every((k) => k === 8 || k === 16) && kinds.has(8) && kinds.has(16),
    `haptics on: only 8 ms (catch) and 16 ms (bite) ticks ${JSON.stringify([...kinds])}`);
  check(minGap >= 40 && calls.length <= on.n, `at most one vibrate call per 40 ms, never more calls than events (min gap ${minGap.toFixed(1)} ms)`);
  // Dense events: two catches in one step, a bite right after.
  calls.length = 0;
  clockMs += 1000;
  feed([{ type: 'catch' }, { type: 'catch' }, { type: 'bite' }], clockMs / 1000);
  feed([{ type: 'bite' }], (clockMs + 39) / 1000);
  feed([{ type: 'bite' }], (clockMs + 41) / 1000);
  check(calls.length === 2 && calls[0][1] === 8 && calls[1][1] === 16, `the 40 ms limiter drops ticks inside 40 ms (${JSON.stringify(calls.map((c) => c[1]))})`);
  calls.length = 0;
  setHaptics(false);
  const off = play(3, 6);
  check(calls.length === 0 && off.n > 0, `haptics off: zero vibrate calls over ${off.n} catches and bites`);
  // Missed items, hops, dives, uneaten nasties and sky events never vibrate.
  setHaptics(true);
  calls.length = 0;
  clockMs += 1000;
  feed([{ type: 'miss' }, { type: 'hop' }, { type: 'leap' }, { type: 'dive' }, { type: 'nastyBoat' }, { type: 'nastyWater' }, { type: 'sky' }, { type: 'kinds' }], clockMs / 1000);
  check(calls.length === 0, 'misses, hops, leaps, dives, uneaten nasties and sky events never vibrate');
}

console.log(`\n${passed + fails.length} checks, ${fails.length} failure(s)`);
process.exit(fails.length ? 1 : 0);
