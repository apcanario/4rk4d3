// Pool simulation (docs/V2.md §4): the table, the balls, a fixed 120 Hz step
// in sub-steps of at most 1 px, pockets that capture, cushions, the loop of
// the game (the cue ball returning, a new rack). No DOM, no imports, no
// randomness: the same inputs always give the same result, so it runs in Node.
// Every play value is passed in as cfg (the CONFIG block at the top of pool.js).

export const STEP_HZ = 120;
export const DT = 1 / STEP_HZ;

/**
 * The table for a screen: width W (135), and the safe-area insets. The table
 * is the screen less the insets; its cushions are a band of cfg.cushionPx
 * along its four edges, and the balls play inside the band's inner face.
 */
export function makeTable(W, H, safe, cfg) {
  const s = { top: 0, right: 0, bottom: 0, left: 0, ...(safe || {}) };
  const ox0 = s.left;
  const ox1 = W - s.right;
  const oy0 = s.top;
  const oy1 = H - s.bottom;
  const th = oy1 - oy0;
  const c = cfg.cushionPx;
  const x0 = ox0 + c;
  const x1 = ox1 - c;
  const y0 = oy0 + c;
  const y1 = oy1 - c;
  const cx = (ox0 + ox1) / 2;
  const cp = cfg.cornerInsetPx;
  const pockets = [
    { x: ox0 + cp, y: oy0 + cp, r: cfg.cornerPocketR },
    { x: ox1 - cp, y: oy0 + cp, r: cfg.cornerPocketR },
    { x: ox0 + cp, y: oy1 - cp, r: cfg.cornerPocketR },
    { x: ox1 - cp, y: oy1 - cp, r: cfg.cornerPocketR },
    { x: x0, y: (oy0 + oy1) / 2, r: cfg.sidePocketR },
    { x: x1, y: (oy0 + oy1) / 2, r: cfg.sidePocketR },
  ];
  const baulkY = oy0 + cfg.baulkAt * th;
  return {
    W, H, outer: { x0: ox0, y0: oy0, x1: ox1, y1: oy1 }, x0, y0, x1, y1, cx, th,
    pockets, baulkY, spot: { x: cx, y: baulkY + cfg.spotBelowPx },
    apex: { x: cx, y: oy0 + cfg.rackApexAt * th },
  };
}

/** The ten object balls of a fresh rack, ids 1..10, apex toward the player (the bottom of the screen). */
export function rackPositions(table, cfg) {
  const out = [];
  const d = cfg.ballR * 2 + cfg.rackGapPx;
  const rowH = d * Math.sqrt(3) / 2;
  let id = 1;
  for (let row = 0; row < 4; row++) {
    const n = row + 1;
    const y = table.apex.y - row * rowH;
    for (let i = 0; i < n; i++) out.push({ id: id++, x: table.cx + (i - (n - 1) / 2) * d, y });
  }
  return out;
}

const ball = (id, x, y) => ({ id, x, y, vx: 0, vy: 0, potted: false });

/** A new world: a fresh rack and the cue ball (id 0) on its spot. */
export function createWorld(table, cfg) {
  const world = {
    table, cfg, t: 0, balls: [], events: [], sinceShot: 0, slow: false,
    cueAt: -1, // sim time at which the potted cue ball rises, or -1
    rackAt: -1, // sim time at which a new rack appears, or -1
  };
  newRack(world);
  return world;
}

/** A fresh rack and the cue ball on its spot; any timers are cleared. */
export function newRack(world) {
  const { table, cfg } = world;
  world.balls = [ball(0, table.spot.x, table.spot.y), ...rackPositions(table, cfg).map((p) => ball(p.id, p.x, p.y))];
  world.cueAt = -1;
  world.rackAt = -1;
  world.sinceShot = 0;
  world.slow = false;
}

export const speedOf = (b) => Math.hypot(b.vx, b.vy);
export const cueBall = (world) => world.balls[0];
export const anyMoving = (world) => world.balls.some((b) => !b.potted && (b.vx !== 0 || b.vy !== 0));
/** True while the game still has something to do on its own: a ball moving, or a timer pending. */
export const busy = (world) => anyMoving(world) || world.cueAt >= 0 || world.rackAt >= 0;

function free(world, x, y, skip) {
  const { table, cfg } = world;
  const R = cfg.ballR;
  if (x < table.x0 + R || x > table.x1 - R || y < table.y0 + R || y > table.y1 - R) return false;
  for (const p of table.pockets) if (Math.hypot(x - p.x, y - p.y) < p.r + R) return false;
  for (const b of world.balls) if (b !== skip && !b.potted && Math.hypot(x - b.x, y - b.y) < 2 * R + 0.5) return false;
  return true;
}

/** Put the cue ball on its spot, or on the nearest free place if a ball is there. */
export function placeCue(world) {
  const { table } = world;
  const cue = world.balls[0];
  cue.vx = 0;
  cue.vy = 0;
  cue.potted = false;
  let at = { x: table.spot.x, y: table.spot.y };
  if (!free(world, at.x, at.y, cue)) {
    search: for (let r = 0.5; r < 200; r += 0.5) {
      const n = Math.max(8, Math.ceil(r * 3));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = table.spot.x + Math.cos(a) * r;
        const y = table.spot.y + Math.sin(a) * r;
        if (free(world, x, y, cue)) { at = { x, y }; break search; }
      }
    }
  }
  cue.x = at.x;
  cue.y = at.y;
}

/**
 * The shot of a pull: the thumb went down at x0, y0 and is now at x1, y1
 * (logical px). The shot goes the opposite way. Power is the pull over
 * cfg.pullCapPx, capped at 1 (the direction keeps following the thumb past
 * it); speed = launchSpeed * power ^ cfg.powerCurve. A pull of cfg.cancelPx or
 * less is no shot (null).
 */
export function pullShot(x0, y0, x1, y1, cfg) {
  const dx = x0 - x1;
  const dy = y0 - y1;
  const len = Math.hypot(dx, dy);
  if (!(len > cfg.cancelPx)) return null;
  const power = Math.min(len, cfg.pullCapPx) / cfg.pullCapPx;
  return { dx, dy, len, power, speed: cfg.launchSpeed * Math.pow(power, cfg.powerCurve) };
}

/** Shoot the cue ball along (dx, dy) at speed. */
export function shoot(world, dx, dy, speed) {
  const cue = world.balls[0];
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || cue.potted) return false;
  cue.vx = (dx / len) * speed;
  cue.vy = (dy / len) * speed;
  world.sinceShot = 0;
  world.slow = false;
  return true;
}

/** One 120 Hz step. Returns world.events: {k:'ball'|'cushion', speed}, {k:'pot', id, x, y}, {k:'cue'}, {k:'rack'}. */
export function step(world) {
  const { cfg, table } = world;
  const ev = world.events;
  ev.length = 0;
  const live = world.balls.filter((b) => !b.potted);
  let vmax = 0;
  for (const b of live) vmax = Math.max(vmax, speedOf(b));
  const n = Math.max(1, Math.ceil(vmax * DT / cfg.subStepPx));
  const dt = DT / n;
  const R = cfg.ballR;
  const e = cfg.ballRestitution;
  for (let s = 0; s < n; s++) {
    for (const b of live) {
      if (b.potted) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    // pockets first: the ball is potted when its centre is within the pocket's radius
    for (const b of live) {
      if (b.potted) continue;
      for (const p of table.pockets) {
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
          b.potted = true;
          b.vx = 0;
          b.vy = 0;
          ev.push({ k: 'pot', id: b.id, x: b.x, y: b.y, px: p.x, py: p.y });
          break;
        }
      }
    }
    // ball on ball
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (a.potted) continue;
      for (let j = i + 1; j < live.length; j++) {
        const c = live[j];
        if (c.potted) continue;
        let dx = c.x - a.x;
        let dy = c.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= 2 * R) continue;
        if (d < 1e-9) { dx = 1; dy = 0; d = 1; }
        const nx = dx / d;
        const ny = dy / d;
        const push = (2 * R - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        c.x += nx * push;
        c.y += ny * push;
        const vn = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny; // closing speed along the normal
        if (vn > 0) {
          const j2 = ((1 + e) * vn) / 2; // equal masses
          a.vx -= j2 * nx;
          a.vy -= j2 * ny;
          c.vx += j2 * nx;
          c.vy += j2 * ny;
          ev.push({ k: 'ball', speed: vn });
        }
      }
    }
    // cushions
    for (const b of live) {
      if (b.potted) continue;
      let hit = 0;
      if (b.x < table.x0 + R) { b.x = table.x0 + R; if (b.vx < 0) { hit = Math.max(hit, -b.vx); b.vx = -b.vx * cfg.cushionRestitution; } }
      else if (b.x > table.x1 - R) { b.x = table.x1 - R; if (b.vx > 0) { hit = Math.max(hit, b.vx); b.vx = -b.vx * cfg.cushionRestitution; } }
      if (b.y < table.y0 + R) { b.y = table.y0 + R; if (b.vy < 0) { hit = Math.max(hit, -b.vy); b.vy = -b.vy * cfg.cushionRestitution; } }
      else if (b.y > table.y1 - R) { b.y = table.y1 - R; if (b.vy > 0) { hit = Math.max(hit, b.vy); b.vy = -b.vy * cfg.cushionRestitution; } }
      if (hit > 0) ev.push({ k: 'cushion', speed: hit });
    }
  }
  // constant deceleration, once a step; a ball stops under cfg.stopSpeed
  let moving = false;
  for (const b of live) {
    if (b.potted) continue;
    const v = speedOf(b);
    if (v === 0) continue;
    const nv = v - cfg.decel * (world.slow ? cfg.stuckFactor : 1) * DT;
    if (nv < cfg.stopSpeed) { b.vx = 0; b.vy = 0; } else { b.vx *= nv / v; b.vy *= nv / v; moving = true; }
  }
  if (moving) {
    world.sinceShot += DT;
    if (world.sinceShot > cfg.stuckS) world.slow = true; // never stuck: deceleration triples until all is at rest
  }
  world.t += DT;

  // the loop of the game
  for (const x of ev) {
    if (x.k !== 'pot') continue;
    if (x.id === 0) world.cueAt = world.t + cfg.cueBackMs / 1000;
    else if (world.rackAt < 0 && !world.balls.some((b) => b.id !== 0 && !b.potted)) world.rackAt = world.t + cfg.rackMs / 1000;
  }
  if (world.rackAt >= 0 && world.t >= world.rackAt) {
    newRack(world);
    ev.push({ k: 'rack' });
  } else if (world.cueAt >= 0 && world.t >= world.cueAt) {
    world.cueAt = -1;
    placeCue(world);
    ev.push({ k: 'cue' });
  }
  return ev;
}

/**
 * The aim guide for a shot along (dx, dy) from the cue ball: the first
 * contact, ball or cushion. Always full length, whatever the power. Returns
 * { t, hit: 'ball'|'cushion', x, y (the cue ball's centre at contact),
 *   ball (the struck ball, or null), nx, ny (the struck ball's line), lineLen }.
 */
export function aimPath(world, dx, dy) {
  const { table, cfg } = world;
  const cue = world.balls[0];
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || cue.potted) return null;
  const ux = dx / len;
  const uy = dy / len;
  const R = cfg.ballR;
  let best = Infinity;
  let hit = 'cushion';
  let struck = null;
  const wall = (t) => { if (t >= 0 && t < best) { best = t; hit = 'cushion'; struck = null; } };
  if (ux < 0) wall((table.x0 + R - cue.x) / ux);
  if (ux > 0) wall((table.x1 - R - cue.x) / ux);
  if (uy < 0) wall((table.y0 + R - cue.y) / uy);
  if (uy > 0) wall((table.y1 - R - cue.y) / uy);
  for (const b of world.balls) {
    if (b.id === 0 || b.potted) continue;
    const fx = cue.x - b.x;
    const fy = cue.y - b.y;
    const B = fx * ux + fy * uy;
    const C = fx * fx + fy * fy - 4 * R * R;
    const disc = B * B - C;
    if (disc < 0) continue;
    const t = -B - Math.sqrt(disc);
    if (t >= 0 && t < best) { best = t; hit = 'ball'; struck = b; }
  }
  const x = cue.x + ux * best;
  const y = cue.y + uy * best;
  const out = { t: best, hit, x, y, ball: struck ? struck.id : null, nx: 0, ny: 0, lineLen: 0 };
  if (struck) {
    const sx = struck.x - x;
    const sy = struck.y - y;
    const sl = Math.hypot(sx, sy) || 1;
    out.nx = sx / sl;
    out.ny = sy / sl;
    out.lineLen = cfg.guideStruckPx;
  }
  return out;
}

/** A copy of the world, to try a shot on (the browser test's bot and the Node tests use it). */
export function cloneWorld(world) {
  return { ...world, balls: world.balls.map((b) => ({ ...b })), events: [] };
}
