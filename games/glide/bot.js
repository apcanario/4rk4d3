// Glide's crab (PLAN §6i Bot). No DOM, no imports: tests/glide-sim.mjs runs it in
// Node with sim.js. Each step it says where the crab wants to be and how fast
// it may go; sim.js moves it there and does the hitting.
//
// It follows the puck's x as it was a reaction delay ago, holds a line in
// front of its goal, and steps forward to hit only when the puck is slow and
// in its half; every hit it aims carries an aim error. A silent rubber band,
// three steps each way from the middle: after the crab scores it gets one step
// slower and less accurate, after the player scores one step sharper. The exit
// ramp slows it with the puck. Nothing is shown, counted or stored: the step
// lives in memory and starts at the middle on every opening.

export const BOT = Object.freeze({
  steps: 3, // the rubber band: -3 (gentlest) .. 0 (start) .. +3 (sharpest)
  delayMs: [300, 150], // reaction delay at -3 and at +3 (PLAN: 150 to 300 ms)
  speed: [55, 115], // speed cap, px/s, at -3 and at +3
  aimErrDeg: [22, 5], // the largest aim error of a hit, at -3 and at +3
  duskFactor: 0.6, // the exit ramp: the crab's speed falls to this share over minutes 10 to 12, with the puck's top speed
  slowPuck: 70, // a puck slower than this, in its half, is one to step forward and hit
  lineGap: 5, // the line it holds: this far below its lowest place, in front of its goal
  lineReach: 14, // on that line it follows the puck's x no further than this outside the goal mouth
  windUp: 7, // it lines up this far behind the puck, then goes through it
  aligned: 3.5, // close enough to the wind-up point to go through...
  aimSpread: 12, // it aims this far to the side of the middle of the player's goal the ring is not on
  windUpS: 0.8, // ...or after this long lining up (a puck by a wall leaves no room behind it)
});

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** A fresh crab mind: the middle step, no memory of the puck. */
export function createBot() {
  return { level: 0, hist: [], mode: 'hold', aim: 0, spot: 0, windT: 0 };
}

/** The values at the crab's current step (t: 0 at -3, 1 at +3). */
export function tuning(level) {
  const t = (clamp(level, -BOT.steps, BOT.steps) + BOT.steps) / (BOT.steps * 2);
  return {
    delayS: lerp(BOT.delayMs[0], BOT.delayMs[1], t) / 1000,
    speed: lerp(BOT.speed[0], BOT.speed[1], t),
    aimErrDeg: lerp(BOT.aimErrDeg[0], BOT.aimErrDeg[1], t),
  };
}

/** The rubber band: after a goal, one step toward the other side, never past three. */
export function onGoal(bot, by) {
  bot.level = clamp(bot.level + (by === 'player' ? 1 : -1), -BOT.steps, BOT.steps);
  bot.mode = 'hold';
}

/** A session-clock reset: back to the middle step. */
export function reset(bot) {
  bot.level = 0;
  bot.hist.length = 0;
  bot.mode = 'hold';
}

/**
 * Where the crab wants to be this step: { x, y, max }. s is the sim state
 * (sim.js), dt the step, ease the dusk slowdown (0 to 1), rnd() a random
 * number in [0, 1), r the sum of the puck's and a mallet's radius, R the puck's.
 */
export function think(bot, s, dt, ease, rnd, r) {
  const g = s.geo;
  const tu = tuning(bot.level);
  const max = tu.speed * lerp(1, BOT.duskFactor, clamp(ease, 0, 1));
  const p = s.puck;
  // What the crab sees: the puck as it was a reaction delay ago.
  bot.hist.push([p.x, p.y, p.vx, p.vy]);
  const keep = Math.max(1, Math.round(tu.delayS / dt));
  while (bot.hist.length > keep + 1) bot.hist.shift();
  const [sx, sy, svx, svy] = bot.hist[0];
  const c = s.crab;
  const line = { x: clamp(sx, g.mx0 - BOT.lineReach, g.mx1 + BOT.lineReach), y: g.crab.y0 + BOT.lineGap, max };
  if (s.phase !== 'play') {
    bot.mode = 'hold';
    return { x: g.cx, y: line.y, max };
  }
  const slow = Math.hypot(svx, svy) < BOT.slowPuck;
  const mine = sy < g.mid;
  if (!(slow && mine)) {
    bot.mode = 'hold';
    return line;
  }
  // Step forward to hit, aimed at the player's goal with an error drawn once per approach.
  if (bot.mode === 'hold') {
    bot.mode = 'windup';
    bot.windT = 0;
    bot.aim = ((rnd() * 2 - 1) * tu.aimErrDeg * Math.PI) / 180;
    // A place across the player's goal mouth: the side the ring is not on (it sees the ring as it is).
    const off = s.ring.x - g.cx;
    bot.spot = Math.abs(off) > 4 ? -Math.sign(off) * BOT.aimSpread : (rnd() < 0.5 ? -1 : 1) * BOT.aimSpread;
  }
  const ax = g.cx + bot.spot - sx;
  const ay = g.yB - sy;
  const base = Math.atan2(ax, ay) + bot.aim;
  const dx = Math.sin(base);
  const dy = Math.cos(base);
  // Past the puck without hitting it (it moved): line up again.
  const along = (c.x - sx) * dx + (c.y - sy) * dy;
  if (bot.mode === 'strike' && along > 0) { bot.mode = 'windup'; bot.windT = 0; }
  // On the wrong side of the puck: round it first, beside it, so it is not pushed back toward the crab's own goal.
  if (bot.mode === 'windup' && along > -r * 0.6) {
    const px = -dy;
    const py = dx;
    const side = Math.sign((c.x - sx) * px + (c.y - sy) * py) || 1;
    const wx = sx + px * side * (r + BOT.windUp) - dx * r * 0.5;
    const wy = sy + py * side * (r + BOT.windUp) - dy * r * 0.5;
    if (wx >= g.crab.x0 && wx <= g.crab.x1) return { x: wx, y: clamp(wy, g.crab.y0, g.crab.y1), max };
    return { x: clamp(sx - px * side * (r + BOT.windUp), g.crab.x0, g.crab.x1), y: clamp(wy, g.crab.y0, g.crab.y1), max };
  }
  // Behind the puck, as near as its half allows (by a wall there may be no room).
  const back = {
    x: clamp(sx - dx * (r + BOT.windUp), g.crab.x0, g.crab.x1),
    y: clamp(sy - dy * (r + BOT.windUp), g.crab.y0, g.crab.y1),
    max,
  };
  if (bot.mode === 'windup') {
    bot.windT += dt;
    if (Math.hypot(c.x - back.x, c.y - back.y) <= BOT.aligned || bot.windT >= BOT.windUpS) bot.mode = 'strike';
    else return back;
  }
  // Through the puck, along the aim.
  return { x: sx + dx * r, y: sy + dy * r, max };
}

/** A hit by the crab ends its approach: the next one draws a new aim error. */
export function onHit(bot) {
  bot.mode = 'hold';
}
