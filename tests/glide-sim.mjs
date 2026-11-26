#!/usr/bin/env node
// RLX row A1 headless checks: runs games/glide/sim.js and bot.js in Node (PLAN
// §6i Tests and Accept). Not needed to run the app.
// Run: node tests/glide-sim.mjs
// Uses the play values of glide.js's CONFIG block, sim.js's SIM and bot.js's
// BOT, so it tests what ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../games/glide/sim.js';
import * as B from '../games/glide/bot.js';
import * as T from '../shared/tokens.js';
import * as SE from '../shared/session.js';
import * as CT from './contrast.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');
let passed = 0;
const fails = [];
let TAG = '';
function check(cond, msg) {
  msg = TAG + msg;
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (cond) passed++;
  else fails.push(msg);
}
const EPS = 1e-6;
const { SIM } = S;
const R = SIM.puckR;
const M = SIM.malletR;
const NEED = R + M;

/* ---------- the source: config blocks, no DOM, nothing stored, no text ---------- */

const glideSrc = read('games/glide/glide.js');
const simSrc = read('games/glide/sim.js');
const botSrc = read('games/glide/bot.js');
const m = glideSrc.match(/export const CONFIG = Object\.freeze\((\{[\s\S]*?\})\);/);
const CONFIG = m ? Function(`return (${m[1]});`)() : null;
check(!!CONFIG && glideSrc.indexOf('export const CONFIG') < glideSrc.indexOf('import '), 'glide.js has one CONFIG block, at the top');
check(CONFIG && CONFIG.resumeDelayMs === 250 && CONFIG.hapticHitMinMs === 8 && CONFIG.hapticHitMaxMs === 14
  && CONFIG.hapticWallMs === 6 && CONFIG.hapticGoalMs === 24,
  `CONFIG holds the PLAN values: resume 250 ms, hit 8 to 14 ms, wall 6 ms, goal 24 ms ${JSON.stringify(CONFIG)}`);
check(SIM.puckR === 5 && SIM.malletR === 9 && SIM.topSpeed === 220 && SIM.wallBounce === 0.9 && SIM.stallSpeed === 15
  && SIM.stallS === 2 && SIM.serveSpeed === 60 && SIM.goalW === 45 && SIM.seaMax === 16 && SIM.seaFrac === 0.05 && S.STEP_HZ === 120,
  'SIM holds the PLAN values: puck radius 5, ring and crab 9, top speed 220, 90 percent bounce, stall under 15 px/s for 2 s, serve 60 px/s, goals 45 px, sea strip 5 percent and at most 16 px, 120 Hz');
check(B.BOT.delayMs[0] === 300 && B.BOT.delayMs[1] === 150 && B.BOT.steps === 3, 'BOT: reaction delay 150 to 300 ms, three steps each way');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^'\n]*$/gm, '');
for (const [name, src] of [['sim.js', simSrc], ['bot.js', botSrc]]) {
  const c = code(src);
  check(!/\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|HTMLCanvasElement)\b/.test(c) && !/^\s*import\b/m.test(c),
    `${name}: no DOM and no imports`);
}
for (const [name, src] of [['glide.js', glideSrc], ['sim.js', simSrc], ['bot.js', botSrc]]) {
  const c = code(src);
  check(!/localStorage|sessionStorage|indexedDB|document\.cookie|caches\./.test(c), `${name}: nothing written to storage`);
  check(!/fillText|strokeText|font\s*=/.test(c), `${name}: no text drawn`);
  check(!/AudioContext|new Audio|\.play\(/.test(c), `${name}: no sound`);
}
check(!/navigator\.vibrate/.test(code(glideSrc)) && (code(glideSrc).match(/\bsend\(/g) || []).length === 1,
  'glide.js vibrates through shared/haptics.js send() at one call site, never navigator.vibrate itself');
check(/atSideEdge\(e\)/.test(glideSrc) && /thumbSensitivity\(/.test(glideSrc), 'glide.js ignores touches in the side band and uses the shared thumb travel');
check(!/#[0-9A-Fa-f]{3,8}\b/.test(code(glideSrc) + code(simSrc) + code(botSrc)), 'no colour literal in glide.js, sim.js or bot.js (every colour a token or a mix)');

/* ---------- the table at the tested sizes ---------- */

const VIEWS = [
  [240, { top: 0, bottom: 0 }], [240, { top: 12, bottom: 6 }], [300, { top: 0, bottom: 0 }], [300, { top: 12, bottom: 6 }],
  [343, { top: 0, bottom: 0 }], [400, { top: 0, bottom: 0 }], [400, { top: 11, bottom: 6 }],
];
for (const [H, ins] of VIEWS) {
  const safe = { left: 0, right: 0, ...ins };
  const g = S.geometry(135, H, safe);
  const tag = `H${H}${ins.top ? ' insets' : ''}`;
  const want = Math.min(16, Math.round(H * 0.05));
  check(g.sea === Math.max(want, safe.top) && g.sea <= 16 && (ins.top || g.sea === want),
    `[${tag}] the sea strip is ${g.sea} px: about 5 percent of ${H} (${(H * 0.05).toFixed(1)}), at most 16`);
  check(g.G >= safe.top && g.yB + SIM.band <= H - safe.bottom && g.mx1 - g.mx0 === 45 && Math.abs((g.mx0 + g.mx1) / 2 - 67.5) < EPS,
    `[${tag}] both goals 45 px wide, centred, inside the safe area (goal line ${g.G}, bottom wall ${g.yB})`);
  check(g.xL === SIM.band && g.xR === 135 - SIM.band && g.T === g.sea,
    `[${tag}] the table runs to the side edges (walls at ${g.xL} and ${g.xR}) and from the tide line down`);
  check(g.ring.y0 > g.mid && g.crab.y1 < g.mid && g.ring.y1 <= g.yB - M && g.crab.y0 >= g.G + M,
    `[${tag}] the ring keeps to the player's half, the crab to its own; neither reaches a goal mouth`);
}

/* ---------- physics units ---------- */

const G300 = S.geometry(135, 300);
const away = (s) => { s.ring.x = 15; s.ring.y = s.geo.ring.y1; s.crab.x = 120; s.crab.y = s.geo.crab.y0; };
function fresh(g = G300) {
  const s = S.create(g, 5);
  s.phase = 'play';
  away(s);
  return s;
}
const still = (s) => ({ ring: { x: s.ring.x, y: s.ring.y }, crab: { x: s.crab.x, y: s.crab.y, max: 0 } });

// Drag: a full-speed puck rolls at least two table lengths before it would stop.
{
  const s = fresh();
  s.puck = { x: 20, y: s.geo.yB - 20, vx: 0, vy: -220 };
  let dist = 0;
  let n = 0;
  while (S.speedOf(s.puck) > 0 && n < 120 * 60) {
    const x0 = s.puck.x;
    const y0 = s.puck.y;
    s.stall = 0;
    S.step(s, still(s), 0);
    if (S.speedOf(s.puck) > 0) dist += Math.hypot(s.puck.x - x0, s.puck.y - y0);
    n++;
  }
  const L = s.geo.yB - s.geo.G;
  check(dist >= 2 * L, `a full-speed puck rolls ${dist.toFixed(0)} px before it stops: ${(dist / L).toFixed(2)} table lengths (at least 2)`);
}

// Wall bounce: 90 percent off the walls.
{
  const s = fresh();
  s.puck = { x: 40, y: 150, vx: -100, vy: 0 };
  let out = null;
  let before = 0;
  for (let i = 0; i < 120 && !out; i++) {
    // the speed it comes in at: this step's drag taken off first, as the step does
    before = Math.abs(s.puck.vx) - S.drag(s.geo) * S.DT;
    const ev = S.step(s, still(s), 0);
    if (ev.some((e) => e.type === 'wall')) out = { ...s.puck };
  }
  check(out && out.vx > 0 && Math.abs(out.vx / before - 0.9) < 1e-6, `a puck off a side wall keeps 90 percent of its speed (${out && out.vx.toFixed(2)} from ${before.toFixed(2)})`);
}

// A mallet hit adds the mallet's velocity along the contact normal, clamped to the top speed.
for (const [vm, wantMax] of [[60, 220], [100, 220], [400, 220]]) {
  const s = fresh();
  s.puck = { x: 67.5, y: 200, vx: 0, vy: 0 };
  s.ring.x = 67.5;
  s.ring.y = 200 + NEED + 0.25;
  s.ring.yield = 0;
  const ev = S.step(s, { ring: { x: 67.5, y: s.ring.y - vm * S.DT }, crab: { x: s.crab.x, y: s.crab.y, max: 0 } }, 0);
  const hit = ev.find((e) => e.type === 'hit');
  const v = S.speedOf(s.puck);
  const expect = Math.min(220, vm * (1 + SIM.hitBounce));
  check(hit && hit.by === 'ring' && s.puck.vy < 0 && Math.abs(s.puck.vx) < 1e-6 && Math.abs(v - expect) < 1.5 && v <= wantMax + EPS,
    `a ring moving at ${vm} px/s into a still puck sends it straight on at ${v.toFixed(1)} px/s (its speed along the normal added, at most 220)`);
}

// Stall rule: a puck under 15 px/s for 2 s gets a gentle push toward the half it is not in.
for (const half of ['player', 'crab']) {
  const s = fresh();
  const y = half === 'player' ? s.geo.mid + 40 : s.geo.mid - 40;
  s.puck = { x: 67.5, y, vx: 0, vy: 0 };
  let t = 0;
  let pushed = null;
  for (let i = 0; i < 120 * 3 && !pushed; i++) {
    const ev = S.step(s, still(s), 0);
    t += S.DT;
    if (ev.some((e) => e.type === 'stall')) pushed = { t, vy: s.puck.vy, v: S.speedOf(s.puck) };
  }
  const ok = pushed && Math.abs(pushed.t - 2) <= S.DT + EPS && (half === 'player' ? pushed.vy < 0 : pushed.vy > 0) && pushed.v <= SIM.stallPush + EPS;
  check(ok, `a still puck in the ${half}'s half is pushed after ${pushed && pushed.t.toFixed(3)} s toward the other half at ${pushed && pushed.v.toFixed(1)} px/s`);
}

// Pin rule: a puck held against a wall or a corner by a mallet goes out along the wall; the mallet gives way.
for (const [name, px, py, mx, my] of [
  ['left wall', 7, 250, 22, 250], ['bottom wall', 30, 293, 30, 279], ['bottom-left corner', 7, 293, 12, 280],
  ['bottom-right corner', 128, 293, 123, 280], ['right wall', 128, 230, 113, 230],
]) {
  const s = fresh();
  s.puck = { x: px, y: py, vx: 0, vy: 0 };
  s.ring.x = mx;
  s.ring.y = Math.min(my, s.geo.ring.y1);
  const into = { x: px, y: py }; // the thumb keeps pushing the ring into the puck
  let pinned = 0;
  let overlap = 0;
  let escaped = false;
  for (let i = 0; i < 120 * 2; i++) {
    S.step(s, { ring: into, crab: { x: s.crab.x, y: s.crab.y, max: 0 } }, 0);
    if (s.pinned) pinned++;
    if (Math.hypot(s.puck.x - s.ring.x, s.puck.y - s.ring.y) < NEED - 1e-3) overlap++;
    if (Math.hypot(s.puck.x - px, s.puck.y - py) > 12) { escaped = true; break; }
  }
  check(pinned > 0 && escaped && overlap === 0, `pin rule, ${name}: pinned (${pinned} steps), then the puck goes out along the wall; the ring never overlaps it`);
}

// Serve: the first serve of an opening goes to the player; then to whoever conceded.
{
  const s = S.create(G300, 9);
  check(s.phase === 'ready' && s.puck.x === G300.cx && s.puck.y === G300.mid && S.speedOf(s.puck) === 0,
    'a fresh table: the puck on the centre spot, still, before the first serve (opening paused)');
  const ev = S.step(s, still(s), 0);
  check(ev.some((e) => e.type === 'serve' && e.to === 'player') && s.puck.vy > 0 && Math.abs(S.speedOf(s.puck) - 60) < 1,
    `the first serve goes to the player at 60 px/s (${S.speedOf(s.puck).toFixed(1)})`);
  // Through the top mouth: a goal for the player, the next serve to the crab.
  const t = fresh();
  t.puck = { x: 67.5, y: t.geo.G + 20, vx: 0, vy: -150 };
  let goal = null;
  let serve = null;
  for (let i = 0; i < 120 * 3 && !serve; i++) {
    for (const e of S.step(t, still(t), 0)) {
      if (e.type === 'goal') goal = e;
      if (e.type === 'serve') serve = { ...e, vy: t.puck.vy, x: t.puck.x, y: t.puck.y };
    }
  }
  check(goal && goal.by === 'player' && serve && serve.to === 'crab' && serve.vy < 0 && serve.x === t.geo.cx && serve.y === t.geo.mid,
    'the puck out to sea through the inlet is a goal for the player; after the pause the serve goes from the centre to the crab');
  const u = fresh();
  u.puck = { x: 67.5, y: u.geo.yB - 20, vx: 0, vy: 150 };
  goal = null;
  serve = null;
  for (let i = 0; i < 120 * 3 && !serve; i++) {
    for (const e of S.step(u, still(u), 0)) {
      if (e.type === 'goal') goal = e;
      if (e.type === 'serve') serve = { ...e, vy: u.puck.vy };
    }
  }
  check(goal && goal.by === 'crab' && serve && serve.to === 'player' && serve.vy > 0,
    'the puck between the sandcastles is a goal for the crab; the next serve goes to the player');
  // Off the tide line outside the inlet: a bounce, no goal.
  const w = fresh();
  w.puck = { x: 20, y: w.geo.T + 30, vx: 0, vy: -150 };
  let g2 = false;
  for (let i = 0; i < 60; i++) for (const e of S.step(w, still(w), 0)) if (e.type === 'goal') g2 = true;
  check(!g2 && w.puck.vy > 0, 'a puck at the tide line beside the inlet bounces back onto the sand');
}

// No tunnelling: a top-speed puck at a still mallet from every side, and a mallet swept through a still puck at full speed.
{
  let bad = 0;
  for (let a = 0; a < 360; a += 5) {
    const s = fresh();
    s.ring.x = 67.5;
    s.ring.y = s.geo.ring.y0 + 40;
    const r = (a * Math.PI) / 180;
    s.puck = { x: s.ring.x + Math.cos(r) * 40, y: s.ring.y + Math.sin(r) * 40, vx: -Math.cos(r) * 220, vy: -Math.sin(r) * 220 };
    const side0 = Math.sign((s.puck.x - s.ring.x) * Math.cos(r) + (s.puck.y - s.ring.y) * Math.sin(r));
    for (let i = 0; i < 40; i++) {
      S.step(s, still(s), 0);
      if (Math.hypot(s.puck.x - s.ring.x, s.puck.y - s.ring.y) < NEED - EPS) bad++;
    }
    const side1 = Math.sign((s.puck.x - s.ring.x) * Math.cos(r) + (s.puck.y - s.ring.y) * Math.sin(r));
    if (s.phase === 'play' && side1 !== side0) bad++;
  }
  check(bad === 0, `a 220 px/s puck at a still ring from 72 directions never enters it or passes through it (${bad} bad)`);
  let thru = 0;
  for (let a = 0; a < 360; a += 10) {
    const s = fresh();
    s.puck = { x: 67.5, y: s.geo.mid + 60, vx: 0, vy: 0 };
    const r = (a * Math.PI) / 180;
    s.ring.x = 67.5 - Math.cos(r) * 30;
    s.ring.y = s.puck.y - Math.sin(r) * 30;
    if (s.ring.y < s.geo.ring.y0 || s.ring.y > s.geo.ring.y1) continue;
    const goal = { x: 67.5 + Math.cos(r) * 60, y: s.puck.y + Math.sin(r) * 60 };
    for (let i = 0; i < 20; i++) {
      S.step(s, { ring: goal, crab: { x: s.crab.x, y: s.crab.y, max: 0 } }, 0);
      if (Math.hypot(s.puck.x - s.ring.x, s.puck.y - s.ring.y) < NEED - EPS) thru++;
    }
    if (S.speedOf(s.puck) < 50 && s.phase === 'play' && s.stall === 0) thru++; // it must have been struck
  }
  check(thru === 0, `a ring swept at full speed (${SIM.ringMaxSpeed} px/s) at a still puck always strikes it, never passes through it (${thru} bad)`);
}

/* ---------- the crab ---------- */

{
  const b = B.createBot();
  check(b.level === 0, 'the crab starts at the middle step');
  for (let i = 0; i < 6; i++) B.onGoal(b, 'player');
  const top = b.level;
  for (let i = 0; i < 9; i++) B.onGoal(b, 'crab');
  check(top === 3 && b.level === -3, `the rubber band: one step sharper after each player goal, one gentler after each crab goal, never past three (${top}, ${b.level})`);
  const lo = B.tuning(-3);
  const mid = B.tuning(0);
  const hi = B.tuning(3);
  check(Math.abs(lo.delayS - 0.3) < EPS && Math.abs(hi.delayS - 0.15) < EPS && lo.speed < mid.speed && mid.speed < hi.speed && lo.aimErrDeg > hi.aimErrDeg && hi.aimErrDeg > 0,
    `gentler means slower and less accurate: delay ${lo.delayS}..${hi.delayS} s, speed ${lo.speed}..${hi.speed}, aim error ${lo.aimErrDeg}..${hi.aimErrDeg} degrees`);
  // The exit ramp slows the puck's top speed and the crab together.
  const s = fresh();
  const want0 = B.think(B.createBot(), s, S.DT, 0, () => 0.5, NEED);
  const want1 = B.think(B.createBot(), s, S.DT, 1, () => 0.5, NEED);
  check(Math.abs(want1.max / want0.max - B.BOT.duskFactor) < EPS && S.topSpeed(1) === SIM.topSpeedDusk && S.topSpeed(0) === 220 && SIM.topSpeedDusk < 220,
    `the exit ramp: the crab's speed cap ${want0.max} -> ${want1.max} and the puck's top speed 220 -> ${S.topSpeed(1)} together`);
}

/* ---------- ten minutes of play ---------- */

function lcg(seed) {
  let r = seed >>> 0;
  return () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
}

// The scripted player: tracks the puck with a short delay and a thumb's speed, holds a line in front of its goal,
// steps forward to hit a slow puck in its half toward the crab's goal (with an aim error), and looks away now and then.
function scriptedPlayer(rnd) {
  const P = { hist: [], mode: 'hold', aim: 0, away: 0, windT: 0 };
  return (s) => {
    const g = s.geo;
    if (P.away > 0) { P.away -= S.DT; return { x: s.ring.x, y: s.ring.y }; }
    if (rnd() < 0.003) P.away = 0.6 + rnd();
    const p = s.puck;
    P.hist.push([p.x, p.y, p.vx, p.vy]);
    while (P.hist.length > 14) P.hist.shift();
    const [sx, sy, svx, svy] = P.hist[0];
    const line = { x: Math.max(g.mx0 - 14, Math.min(g.mx1 + 14, sx)), y: g.ring.y1 - 6 };
    let want = line;
    if (s.phase === 'play' && sy > g.mid && Math.hypot(svx, svy) < 90) {
      if (P.mode === 'hold') { P.mode = 'windup'; P.windT = 0; P.aim = (rnd() * 2 - 1) * 0.25; }
      const base = Math.atan2(g.cx - sx, g.G - sy) + P.aim;
      const dx = Math.sin(base);
      const dy = Math.cos(base);
      const clampB = (v, a, b) => Math.max(a, Math.min(b, v));
      const back = { x: clampB(sx - dx * (NEED + 7), g.ring.x0, g.ring.x1), y: clampB(sy - dy * (NEED + 7), g.ring.y0, g.ring.y1) };
      const along = (s.ring.x - sx) * dx + (s.ring.y - sy) * dy;
      if (P.mode === 'strike' && along > 0) { P.mode = 'windup'; P.windT = 0; } // past it: line up again
      if (P.mode === 'windup' && (Math.hypot(s.ring.x - back.x, s.ring.y - back.y) < 3.5 || (P.windT += S.DT) >= 0.8)) P.mode = 'strike';
      want = P.mode === 'windup' ? back : { x: sx + dx * NEED * 1.5, y: sy + dy * NEED * 1.5 };
      if (P.mode === 'windup' && along > -NEED * 0.6) { // round the puck first
        const side = Math.sign((s.ring.x - sx) * -dy + (s.ring.y - sy) * dx) || 1;
        want = { x: clampB(sx - dy * side * (NEED + 7) - dx * NEED * 0.5, g.ring.x0, g.ring.x1), y: sy + dx * side * (NEED + 7) - dy * NEED * 0.5 };
      }
    } else P.mode = 'hold';
    // a thumb's speed: at most 300 px/s
    const d = Math.hypot(want.x - s.ring.x, want.y - s.ring.y);
    const lim = 300 * S.DT;
    return d > lim ? { x: s.ring.x + ((want.x - s.ring.x) * lim) / d, y: s.ring.y + ((want.y - s.ring.y) * lim) / d } : want;
  };
}

function inTable(s) {
  const g = s.geo;
  const p = s.puck;
  const inMouth = p.x > g.mx0 && p.x < g.mx1;
  const xOk = p.x >= g.xL + R - EPS && p.x <= g.xR - R + EPS;
  const top = inMouth ? g.G - R - 1 : g.T + R - EPS; // across the inlet the puck may reach the rope (and cross it: a goal)
  const bottom = inMouth ? g.yB + R + 1 : g.yB - R + EPS;
  return xOk && p.y >= top && p.y <= bottom;
}

function tenMinutes(H, safe, seed, minutes = 10, ramp = false) {
  const g = S.geometry(135, H, { left: 0, right: 0, top: 0, bottom: 0, ...safe });
  const s = S.create(g, seed);
  const bot = B.createBot();
  const rnd = lcg(seed * 7 + 1);
  const player = scriptedPlayer(lcg(seed * 13 + 5));
  const out = { nan: 0, off: 0, inside: 0, stallMax: 0, goals: { player: 0, crab: 0 }, rallies: [], levels: new Set(), maxSpeed: 0, maxCrab: 0, hits: 0, walls: 0, maxSpeedAfter12: 0 };
  let rally = 0;
  const last = { ring: -99, crab: -99 };
  let slowT = 0;
  const clock = SE.freshClock();
  for (let i = 0; i < minutes * 60 * 120; i++) {
    if (ramp) SE.addPlay(clock, S.DT);
    const ease = ramp ? SE.slowdownOf(clock.active) : 0;
    const crab = B.think(bot, s, S.DT, ease, rnd, NEED);
    const ev = S.step(s, { ring: player(s), crab }, ease);
    for (const e of ev) {
      if (e.type === 'hit') {
        if (i - last[e.by] > 6) { rally++; out.hits++; } // one touch, however many steps it lasts
        last[e.by] = i;
        if (e.by === 'crab') B.onHit(bot);
      } else if (e.type === 'wall') out.walls++;
      else if (e.type === 'goal') {
        out.goals[e.by]++;
        out.rallies.push(rally);
        rally = 0;
        B.onGoal(bot, e.by);
      }
    }
    out.levels.add(bot.level);
    const vals = [s.puck.x, s.puck.y, s.puck.vx, s.puck.vy, s.ring.x, s.ring.y, s.crab.x, s.crab.y];
    if (vals.some((v) => !Number.isFinite(v))) out.nan++;
    if (s.phase === 'play') {
      if (!inTable(s)) out.off++;
      for (const mm of [s.ring, s.crab]) if (Math.hypot(s.puck.x - mm.x, s.puck.y - mm.y) < NEED - 1e-3) out.inside++;
      if (S.speedOf(s.puck) < SIM.stallSpeed) { slowT += S.DT; out.stallMax = Math.max(out.stallMax, slowT); } else slowT = 0;
      out.maxSpeed = Math.max(out.maxSpeed, S.speedOf(s.puck));
      if (ramp && clock.active >= 12 * 60) out.maxSpeedAfter12 = Math.max(out.maxSpeedAfter12, S.speedOf(s.puck));
    } else slowT = 0;
    if (ramp && clock.active >= 12 * 60) out.maxCrab = Math.max(out.maxCrab, crab.max);
    for (const [who, b] of [['ring', g.ring], ['crab', g.crab]]) {
      const mm = s[who];
      if (mm.x < b.x0 - EPS || mm.x > b.x1 + EPS || mm.y < b.y0 - EPS || mm.y > b.y1 + EPS) out.off++;
    }
  }
  out.rallies.sort((a, b) => a - b);
  out.median = out.rallies.length ? out.rallies[out.rallies.length >> 1] : 0;
  return out;
}

for (const [H, safe, seed] of [[300, {}, 1], [240, {}, 2], [400, {}, 3], [300, { top: 12, bottom: 6 }, 4]]) {
  const tag = `10 min H${H}${safe.top ? ' insets' : ''}`;
  const o = tenMinutes(H, safe, seed);
  check(o.nan === 0, `[${tag}] no NaN`);
  check(o.off === 0, `[${tag}] the puck never leaves the table but through a goal mouth; the ring and crab stay in their halves (${o.off} bad steps)`);
  check(o.inside === 0, `[${tag}] no tunnelling: the puck is never inside a mallet (${o.inside} steps)`);
  check(o.stallMax <= SIM.stallS + S.DT + EPS, `[${tag}] no stall longer than 2 s (longest ${o.stallMax.toFixed(3)} s under 15 px/s)`);
  check(o.goals.player > 0 && o.goals.crab > 0, `[${tag}] goals at both ends: player ${o.goals.player}, crab ${o.goals.crab}`);
  check(o.median >= 6, `[${tag}] median rally ${o.median} hits (6 or more) over ${o.rallies.length} goals; ${o.hits} hits, ${o.walls} wall touches`);
  check([...o.levels].every((l) => l >= -3 && l <= 3), `[${tag}] the rubber band stays inside its three steps (${[...o.levels].sort((a, b) => a - b)})`);
  check(o.maxSpeed <= SIM.topSpeed + EPS, `[${tag}] the puck never beats its top speed (${o.maxSpeed.toFixed(1)})`);
}
{
  const o = tenMinutes(300, {}, 11, 14, true);
  check(o.nan === 0 && o.off === 0 && o.inside === 0 && o.maxSpeedAfter12 <= SIM.topSpeedDusk + EPS && o.maxCrab > 0
    && o.maxCrab <= B.BOT.speed[1] * B.BOT.duskFactor + EPS,
    `[14 min, the exit ramp] from minute 12 the puck stays at or under ${SIM.topSpeedDusk} px/s (${o.maxSpeedAfter12.toFixed(1)}) and the crab at or under ${(B.BOT.speed[1] * B.BOT.duskFactor).toFixed(1)} px/s (${o.maxCrab.toFixed(1)}); play goes on (${o.goals.player + o.goals.crab} goals)`);
}

/* ---------- haptics ---------- */

{
  const hitMsSrc = glideSrc.match(/export function hitMs\(speed\) \{([\s\S]*?)\n\}/);
  const hitMs = hitMsSrc ? Function('CONFIG', `return (speed) => {${hitMsSrc[1]}}`)(CONFIG) : null;
  const vals = hitMs ? [0, 10, 20, 60, 110, 160, 200, 300].map(hitMs) : [];
  check(hitMs && vals[0] === 8 && vals[vals.length - 1] === 14 && vals.every((v, i) => i === 0 || v >= vals[i - 1]) && vals.every((v) => v >= 8 && v <= 14),
    `a mallet hit ticks 8 to 14 ms by its speed (${vals})`);
  check(/buzz\(CONFIG\.hapticGoalMs, true\)/.test(glideSrc) && /CONFIG\.hapticWallMs/.test(glideSrc) && /MIN_GAP_MS/.test(glideSrc),
    'goal 24 ms (always sent, after the 40 ms gap if need be), wall 6 ms, at most one call per 40 ms');
}

/* ---------- contrast: the B4 standard in light and dark, at sunset and every step ---------- */

for (const THEME of [T.LIGHT, T.DARK]) {
  T.forceTheme(THEME);
  TAG = THEME === T.DARK ? '[dark] ' : '';
  const P = CT.pairs();
  const pc = S.pieceColours(T, THEME);
  const pieces = {
    shell: { fill: pc.puck.p, edge: pc.puck.o, face: pc.puck.w },
    ring: { fill: pc.ring['#'], edge: pc.ring.o },
    crab: { fill: pc.crab['#'], edge: pc.crab.o },
  };
  const goalposts = [];
  for (let k = 0; k <= 10; k++) {
    const c = S.tableColours(T, k / 10, THEME);
    // Everything a piece can be over on the sand: the ground, the tide line's foam and wet sand, the lines,
    // the decor, a piece's shadow, the goal gap; the shell also the sea (going out through the inlet).
    const behind = [['sand', c.ground], ['wet sand', c.wet], ['foam', c.foam], ['line', c.line], ['pink starfish', c.pink],
      ['blue starfish', c.blue], ['pebble', c.pebble], ['shadow', c.shadow]];
    for (const [name, pc_] of Object.entries(pieces)) {
      // Outside the standard (PLAN §6i build choices): the shell over the inlet's sea in the last px before its centre
      // crosses the goal line, when it is already going out; measured below for the record only.
      // Review of A1: the ring's lowest place and the shell beside a castle reach the sandcastles (body, highlight
      // row, pole, pennant) and the bottom band; the shell touches a buoy's rim. The crab reaches neither.
      const castles = [['sandcastle', c.castle], ['castle highlight', c.castleHi], ['castle pole', c.pole], ['pennant', c.flag], ['bottom band', c.wall]];
      const list = name === 'shell' ? [...behind, ...castles, ['goal gap', c.gap], ['buoy', c.buoy], ['buoy edge', c.buoyEdge], ['buoy band', c.buoyBand]]
        : name === 'ring' ? [...behind, ...castles] : behind;
      for (const [on, bg] of list) {
        // The shell's face is most of it: measured as its fill where its pink ring or edge does not clear.
        const fill = name === 'shell' && CT.contrast(pc_.face, bg) > CT.contrast(pc_.fill, bg) ? pc_.face : pc_.fill;
        P.add(name, 'cr', fill, pc_.edge, on, bg, { k, tag: THEME.name });
      }
    }
    // The goalposts against the sand (castles) and the sea and sand (buoys): delta E 20, fill or edge.
    goalposts.push(['sandcastle', c.castle, null, 'sand', c.ground, k], ['buoy', c.buoy, c.buoyEdge, 'sand', c.ground, k],
      ...c.sea.map((v, i) => ['buoy', c.buoy, c.buoyEdge, `sea band ${i + 1}`, v, k]));
    // Decor never in the tracked colours.
    const tracked = new Set([...Object.values(pc.puck), ...Object.values(pc.ring), ...Object.values(pc.crab)]);
    if (k === 0 || k === 10) check(![c.pink, c.blue, c.pebble].some((d) => tracked.has(d)), `step ${k}: the decor colours are not the tracked pieces' colours`);
  }
  for (const [what, fill, edgeC, on, bg, k] of goalposts) P.add(what, 'de', fill, edgeC, on, bg, { k, tag: THEME.name });
  {
    const rec = CT.pairs();
    for (let k = 0; k <= 10; k++) {
      const c = S.tableColours(T, k / 10, THEME);
      rec.add('shell over the inlet', 'cr', pieces.shell.face, pieces.shell.edge, 'sea band 3', c.sea[2], { k, tag: THEME.name });
    }
    console.log(`  for the record (outside the standard): ${CT.fmt(CT.worst(rec.rows))}`);
  }
  const under = P.rows.filter((r) => !r.ok);
  const w = CT.worst(P.rows);
  check(under.length === 0, `contrast (B4): shell, ring and crab (WCAG 3, fill or edge) on everything they cross, buoys and sandcastles (delta E 20), sunset and all 10 steps: ${P.rows.length} pairs; weakest ${CT.fmt(w)}${under.length ? `; under: ${under.slice(0, 3).map(CT.fmt).join('; ')}` : ''}`);
  T.forceTheme(null);
  TAG = '';
}

console.log(`\n${passed + fails.length} checks, ${fails.length} failure(s)`);
process.exit(fails.length ? 1 : 0);
