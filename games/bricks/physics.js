// Bricks physics (PLAN §6). A fixed 120 Hz step with swept collisions, the
// endless refill, the miss and the respawn. Pure data in, events out: this
// module never touches the DOM, so tests/bricks-sim.mjs runs it in Node.
//
// Coordinates are logical px (PLAN §3), y down. Positions may be fractional;
// the renderer rounds them. The state is a plain JSON-able object, held in
// memory only: nothing is saved (PLAN §2).
//
// Pace (PLAN §2b, §6 Ball): s.pace is the hidden pace, the speed the next
// flight takes; s.speed is the speed of the ball in flight. The pace changes
// at a paddle return (+gain) and a miss (-loss), clamped between speedMin and
// a ceiling that falls from speedMax to speedMin over the dusk slowdown. The
// ball takes the pace only at a paddle bounce or a new serve, never in flight.
// The session clock is not read here: callers pass ease, how far the dusk
// slowdown has gone (0 to 1, shared/session.js slowdownOf), so tests drive it.

export const STEP_HZ = 120;
export const DT = 1 / STEP_HZ;

// Field (PLAN §6 Field, Endless refill)
export const COLS = 7;
export const BRICK_W = 15;
export const BRICK_H = 7;
export const GAP = 2;
export const COL_W = BRICK_W + GAP;
export const ROW_H = BRICK_H + GAP;
export const START_ROWS = 9;
export const MAX_ROWS = 12;
export const COLOURS = 9; // brick-row tokens, top to bottom
export const FULL = (1 << COLS) - 1;
export const SLIDE_S = 0.4;
export const FADE_S = 0.3;

// Ball, paddle, miss (PLAN §6 Ball, Miss, Paddle and control)
export const BALL = 5;
export const PADDLE_W = 30;
export const PADDLE_H = 6;
export const PADDLE_LIFT = 16; // paddle bottom sits this far above the horizon
export const RESPAWN_S = 0.6;
export const MAX_BOUNCE = (60 * Math.PI) / 180; // paddle edge, from vertical
export const MIN_ANGLE = (20 * Math.PI) / 180; // from horizontal, after any bounce

const SLIDE_V = ROW_H / SLIDE_S; // px per second while the field slides
const EPS = 1e-9;
const DEG = Math.PI / 180;

// Used when a caller's cfg leaves a tuning value out (bricks.js sets them all).
export const DEFAULTS = Object.freeze({
  speedMin: 80,
  speedStart: 90,
  speedMax: 125,
  gainPerReturn: 1,
  lossPerMiss: 12,
  refillBelow: 35,
  serveAngleDeg: 10, // each new ball leaves this far from vertical, alternating left and right
  loopBounces: 3, // serves and paddle bounces in a row with no brick popped before nudging
  loopNudgeDeg: 8, // the nudge turns the path this far per launch past loopBounces, alternating sign
});
const opt = (cfg, k) => (cfg && cfg[k] !== undefined ? cfg[k] : DEFAULTS[k]);

/** Field geometry for a screen: W wide, field top edge, horizon line. */
export function geometry(W, top, horizon) {
  const fieldW = COLS * BRICK_W + (COLS - 1) * GAP;
  return {
    W,
    top,
    horizon,
    paddleY: horizon - PADDLE_LIFT - PADDLE_H,
    left: Math.floor((W - fieldW) / 2),
  };
}

/* ---------- state ---------- */

export function create(geo, cfg) {
  const rows = [];
  for (let r = 0; r < MAX_ROWS; r++) rows.push({ c: r % COLOURS, m: r < START_ROWS ? FULL : 0 });
  const s = {
    geo: { ...geo },
    rows,
    colour: COLOURS - 1, // colour index of the next row to enter at the top
    paddleX: (geo.W - PADDLE_W) / 2,
    ball: null,
    respawn: 0,
    slide: null, // seconds into the current slide, or null
    fade: null, // { row, t } while the lowest row fades out, or null
    time: 0,
    serves: 0, // balls served so far: their parity picks the serve side
    idle: 0, // serves and paddle bounces since the last brick popped
    nudges: 0, // loop nudges so far: their parity picks the nudge side
    pace: opt(cfg, 'speedStart'), // hidden pace: the speed the next flight takes
    speed: opt(cfg, 'speedStart'), // speed of the ball in flight
  };
  spawn(s, cfg);
  return s;
}

const MAX_LAUNCH = 90 * DEG - MIN_ANGLE - EPS;

// Loop breaker: a serve or paddle bounce is a launch. After loopBounces
// launches in a row with no brick popped, each launch turns a further
// loopNudgeDeg (8, 16, 24 ...), alternating sides, until something pops.
// No fixed cycle of serves, misses and bounces can survive that.
function launch(s, cfg, a, side) {
  s.idle += 1;
  const over = s.idle - opt(cfg, 'loopBounces') + 1;
  if (over > 0) {
    const sign = side || (s.nudges % 2 === 0 ? 1 : -1);
    a += sign * over * opt(cfg, 'loopNudgeDeg') * DEG;
    s.nudges += 1;
  }
  return Math.max(-MAX_LAUNCH, Math.min(MAX_LAUNCH, a));
}

// A new ball rises from the paddle centre, a little off vertical, first to
// the left, then to the right, so a still thumb never serves the same line.
// ease: the dusk slowdown now; the pace is clamped to the ceiling as it
// stands at the serve, since the ceiling may have fallen during the respawn.
function spawn(s, cfg, ease = 0) {
  const side = s.serves % 2 === 0 ? -1 : 1;
  const a = launch(s, cfg, side * opt(cfg, 'serveAngleDeg') * DEG, side);
  s.ball = { x: s.paddleX + (PADDLE_W - BALL) / 2, y: s.geo.paddleY - BALL, vx: 0, vy: 0 };
  s.pace = clampPace(s.pace, cfg, ease);
  s.speed = s.pace; // a new flight takes the pace
  setAngle(s.ball, s.speed, a);
  s.serves += 1;
  s.respawn = 0;
}

function bits(m) {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
}

/** Live bricks; a fading row no longer counts. */
export function brickCount(s) {
  let n = 0;
  for (let r = 0; r < s.rows.length; r++) if (!s.fade || s.fade.row !== r) n += bits(s.rows[r].m);
  return n;
}

/** Index of the lowest row holding a brick, or -1. */
export function deepestRow(s) {
  for (let r = s.rows.length - 1; r >= 0; r--) if (s.rows[r].m) return r;
  return -1;
}

/** Current vertical offset of every row: -ROW_H at a slide's start, 0 at rest. */
export function slideOffset(s) {
  return s.slide === null ? 0 : -ROW_H * (1 - s.slide / SLIDE_S);
}

export function brickX(s, col) {
  return s.geo.left + col * COL_W;
}

export function rowY(s, row) {
  return s.geo.top + row * ROW_H + slideOffset(s);
}

/* ---------- refill ---------- */

function beginSlide(s) {
  s.rows.pop(); // always empty here: the cap check ran first
  s.rows.unshift({ c: s.colour, m: FULL });
  s.colour = (s.colour + COLOURS - 1) % COLOURS;
  s.slide = 0;
}

function startRefill(s) {
  if (deepestRow(s) >= MAX_ROWS - 1) s.fade = { row: deepestRow(s), t: 0 };
  else beginSlide(s);
}

/* ---------- collisions ---------- */

// Sweep the ball's top-left point against a box grown by the ball size.
// Returns { t, x, y }: time of entry and which axes it enters on, or null.
function sweep(px, py, vx, vy, bx, by, bw, bh, maxT) {
  const minX = bx - BALL;
  const maxX = bx + bw;
  const minY = by - BALL;
  const maxY = by + bh;
  let txE;
  let txX;
  let tyE;
  let tyX;
  if (vx === 0) {
    if (px <= minX || px >= maxX) return null;
    txE = -Infinity;
    txX = Infinity;
  } else {
    const a = (minX - px) / vx;
    const b = (maxX - px) / vx;
    txE = Math.min(a, b);
    txX = Math.max(a, b);
  }
  if (vy === 0) {
    if (py <= minY || py >= maxY) return null;
    tyE = -Infinity;
    tyX = Infinity;
  } else {
    const a = (minY - py) / vy;
    const b = (maxY - py) / vy;
    tyE = Math.min(a, b);
    tyX = Math.max(a, b);
  }
  const tE = Math.max(txE, tyE);
  const tX = Math.min(txX, tyX);
  if (tE >= tX - EPS || tE < -EPS || tE > maxT) return null;
  return { t: Math.max(0, tE), x: txE >= tyE - EPS, y: tyE >= txE - EPS };
}

function earliest(s, maxT, slideV) {
  const b = s.ball;
  const g = s.geo;
  let best = maxT + EPS;
  let hits = [];
  const consider = (h) => {
    if (!h) return;
    if (h.t < best - EPS) {
      best = h.t;
      hits = [h];
    } else if (h.t <= best + EPS) {
      hits.push(h);
    }
  };
  if (b.vx < 0) consider({ kind: 'left', t: Math.max(0, (0 - b.x) / b.vx) });
  if (b.vx > 0) consider({ kind: 'right', t: Math.max(0, (g.W - BALL - b.x) / b.vx) });
  if (b.vy < 0) consider({ kind: 'top', t: Math.max(0, (g.top - b.y) / b.vy) });
  const p = sweep(b.x, b.y, b.vx, b.vy, s.paddleX, g.paddleY, PADDLE_W, PADDLE_H, maxT);
  if (p) consider({ kind: 'paddle', ...p });
  // Bricks move together while the field slides: sweep in their frame.
  const rvy = b.vy - slideV;
  const off = slideOffset(s);
  for (let r = 0; r < s.rows.length; r++) {
    const m = s.rows[r].m;
    if (!m || (s.fade && s.fade.row === r)) continue;
    const y = g.top + r * ROW_H + off;
    for (let c = 0; c < COLS; c++) {
      if (!(m & (1 << c))) continue;
      const h = sweep(b.x, b.y, b.vx, rvy, g.left + c * COL_W, y, BRICK_W, BRICK_H, maxT);
      if (h) consider({ kind: 'brick', row: r, col: c, ...h });
    }
  }
  return hits.length && best <= maxT ? { t: best, hits } : null;
}

// The field slides at ROW_H / SLIDE_S = 22.5 px/s. A brick that is hit is
// popped at once, so the ball never meets the same moving brick twice.

/* ---------- pace ---------- */

/** The pace ceiling: speedMax, falling linearly to speedMin as ease goes 0 to 1. */
export function ceilingOf(cfg, ease = 0) {
  const e = Math.max(0, Math.min(1, ease || 0));
  return opt(cfg, 'speedMax') - (opt(cfg, 'speedMax') - opt(cfg, 'speedMin')) * e;
}

function clampPace(v, cfg, ease) {
  return Math.max(opt(cfg, 'speedMin'), Math.min(ceilingOf(cfg, ease), v));
}

/** The session clock was reset: the pace starts again. The ball in flight keeps its speed. */
export function resetPace(s, cfg) {
  s.pace = opt(cfg, 'speedStart');
}

function setAngle(b, speed, fromVertical) {
  b.vx = speed * Math.sin(fromVertical);
  b.vy = -speed * Math.cos(fromVertical);
}

/** After any bounce: never shallower than MIN_ANGLE, speed exactly constant. */
function settle(b, speed) {
  const minVy = speed * Math.sin(MIN_ANGLE);
  if (Math.abs(b.vy) < minVy) {
    const sy = b.vy < 0 ? -1 : 1;
    const sx = b.vx < 0 ? -1 : 1;
    b.vy = sy * minVy;
    b.vx = sx * speed * Math.cos(MIN_ANGLE);
  }
  const k = speed / Math.hypot(b.vx, b.vy);
  b.vx *= k;
  b.vy *= k;
}

function paddleBounce(s, cfg, ease) {
  const b = s.ball;
  // A clean return: the pace rises, and the ball takes it here, at the bounce.
  s.pace = clampPace(s.pace + opt(cfg, 'gainPerReturn'), cfg, ease);
  s.speed = s.pace;
  // -1 at the left end of the paddle, 0 at its centre, 1 at the right end.
  const off = (b.x + BALL / 2 - (s.paddleX + PADDLE_W / 2)) / (PADDLE_W / 2);
  const a = launch(s, cfg, Math.max(-1, Math.min(1, off)) * MAX_BOUNCE, 0);
  setAngle(b, s.speed, a);
}

/** Set vx to v, keep the sign of vy, keep the speed exact. */
function setVx(b, v, speed) {
  const vx = Math.max(-speed, Math.min(speed, v));
  b.vx = vx;
  b.vy = (b.vy < 0 ? -1 : 1) * Math.sqrt(Math.max(0, speed * speed - vx * vx));
}

function resolve(s, hits, cfg, events, ease) {
  const b = s.ball;
  const vx0 = b.vx;
  const vy0 = b.vy;
  // Paddle first (it sets the whole velocity); then sign rules, which are
  // idempotent, so two surfaces hit at once never flip an axis twice.
  for (const h of hits) {
    if (h.kind !== 'paddle') continue;
    if (h.y && vy0 > 0) {
      paddleBounce(s, cfg, ease);
      events.push({ type: 'paddle' });
    } else if (h.x) {
      b.vx = vx0 > 0 ? -Math.abs(b.vx) : Math.abs(b.vx);
    } else if (h.y) {
      b.vy = Math.abs(b.vy);
    }
  }
  for (const h of hits) {
    if (h.kind === 'left') b.vx = Math.abs(b.vx);
    else if (h.kind === 'right') b.vx = -Math.abs(b.vx);
    else if (h.kind === 'top') b.vy = Math.abs(b.vy);
    else if (h.kind === 'brick') {
      const row = s.rows[h.row];
      if (!(row.m & (1 << h.col))) continue;
      row.m &= ~(1 << h.col);
      s.idle = 0;
      events.push({
        type: 'brick',
        x: s.geo.left + h.col * COL_W + BRICK_W / 2,
        y: rowY(s, h.row) + BRICK_H / 2,
        c: row.c,
      });
      if (h.x) b.vx = vx0 > 0 ? -Math.abs(b.vx) : Math.abs(b.vx);
      if (h.y) b.vy = vy0 > 0 ? -Math.abs(b.vy) : Math.abs(b.vy);
    }
  }
  settle(b, s.speed);
}

function advanceSlide(s, dt) {
  if (s.slide === null) return;
  s.slide += dt;
  if (s.slide >= SLIDE_S - EPS) s.slide = null;
}

/* ---------- step ---------- */

/**
 * Advance the game by one fixed step (DT). cfg: the tuning block (speeds,
 * refillBelow, ...). ease: how far the dusk slowdown has gone, 0 to 1.
 * Returns events: { type: 'brick', x, y, c } | { type: 'paddle' } | { type: 'splash', x }.
 */
export function step(s, cfg, ease = 0) {
  const events = [];
  if (s.slide === null && !s.fade && brickCount(s) < cfg.refillBelow) startRefill(s);

  let t = DT;
  let zeroHits = 0;
  for (let guard = 0; t > EPS && guard < 24; guard++) {
    let seg = t;
    if (s.slide !== null) seg = Math.min(seg, SLIDE_S - s.slide);
    const b = s.ball;
    if (!b) {
      advanceSlide(s, seg);
      t -= seg;
      continue;
    }
    // Wedged sideways with no gap (wall on one side, paddle on the other):
    // after two zero-time bounces, move straight down or up for the rest of
    // the step, so the ball slides out instead of sticking.
    const vx = b.vx;
    if (zeroHits >= 2) b.vx = 0;
    const slideV = s.slide !== null ? SLIDE_V : 0;
    const hit = earliest(s, seg, slideV);
    const dt = hit ? hit.t : seg;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx = vx;
    advanceSlide(s, dt);
    t -= dt;
    zeroHits = dt > EPS ? 0 : zeroHits + 1;
    if (hit) resolve(s, hit.hits, cfg, events, ease);
  }
  // Rounding never lets the ball leave the walls.
  if (s.ball) {
    s.ball.x = Math.max(0, Math.min(s.geo.W - BALL, s.ball.x));
    s.ball.y = Math.max(s.geo.top, s.ball.y);
  }

  if (s.fade) {
    s.fade.t += DT;
    if (s.fade.t >= FADE_S - EPS) {
      s.rows[s.fade.row].m = 0; // no haptic
      s.fade = null;
      beginSlide(s);
    }
  }

  if (s.ball && s.ball.y + BALL / 2 >= s.geo.horizon) {
    events.push({ type: 'splash', x: s.ball.x + BALL / 2 });
    s.ball = null;
    s.respawn = RESPAWN_S;
    s.pace = clampPace(s.pace - opt(cfg, 'lossPerMiss'), cfg, ease); // a miss
  } else if (!s.ball) {
    s.respawn -= DT;
    if (s.respawn <= EPS) spawn(s, cfg, ease);
  }
  s.time += DT;
  return events;
}

/**
 * Move the paddle by dx logical px, clamped to the field. The ball never ends
 * up inside the paddle. live (the game is running): a paddle swept into the
 * ball bounces it, off the top if the ball's centre is above the paddle's,
 * else off the side, away from the paddle. Not live (paused or resuming):
 * nothing bounces and the paddle stops at the ball's side.
 */
export function movePaddle(s, dx, cfg, live = true, ease = 0) {
  const events = [];
  const from = s.paddleX;
  s.paddleX = Math.max(0, Math.min(s.geo.W - PADDLE_W, s.paddleX + dx));
  const b = s.ball;
  const g = s.geo;
  const inside = () => b && b.x + BALL > s.paddleX + EPS && b.x < s.paddleX + PADDLE_W - EPS
    && b.y + BALL > g.paddleY + EPS && b.y < g.paddleY + PADDLE_H - EPS;
  if (!inside()) return events;
  const left = b.x + BALL / 2 < s.paddleX + PADDLE_W / 2;
  if (!live) {
    // stop at the ball's side (the side the paddle came from)
    s.paddleX = s.paddleX > from ? b.x - PADDLE_W : b.x + BALL;
    s.paddleX = Math.max(0, Math.min(g.W - PADDLE_W, s.paddleX));
    if (inside()) s.paddleX = from;
    return events;
  }
  if (b.y + BALL / 2 < g.paddleY + PADDLE_H / 2) {
    b.y = g.paddleY - BALL;
    paddleBounce(s, cfg, ease);
    settle(b, s.speed);
    events.push({ type: 'paddle' });
    return events;
  }
  // Side: push the ball out, away from the paddle; against a wall, the
  // paddle stops at the ball instead.
  const speed = s.speed;
  const away = Math.max(Math.abs(b.vx), speed * Math.sin(MIN_ANGLE));
  if (left) {
    b.x = s.paddleX - BALL;
    if (b.x < 0) { b.x = 0; s.paddleX = BALL; }
    setVx(b, -away, speed);
  } else {
    b.x = s.paddleX + PADDLE_W;
    if (b.x > g.W - BALL) { b.x = g.W - BALL; s.paddleX = g.W - BALL - PADDLE_W; }
    setVx(b, away, speed);
  }
  settle(b, speed);
  return events;
}

/* ---------- geometry change ---------- */

/** Re-fit a running game to a new screen geometry (same width). */
export function setGeometry(s, geo) {
  const old = s.geo;
  if (old.top === geo.top && old.horizon === geo.horizon && old.W === geo.W && old.left === geo.left) return;
  const b = s.ball;
  if (b) {
    const oldField = old.top + MAX_ROWS * ROW_H;
    const newField = geo.top + MAX_ROWS * ROW_H;
    if (b.y < oldField) {
      b.y = geo.top + (b.y - old.top); // same place in the field
    } else if (b.y + BALL <= old.paddleY) {
      const f = (b.y - oldField) / Math.max(1, old.paddleY - BALL - oldField);
      b.y = newField + f * Math.max(0, geo.paddleY - BALL - newField);
    } else {
      b.y = geo.paddleY + (b.y - old.paddleY);
    }
    // never left inside the paddle
    if (b.y + BALL > geo.paddleY && b.y < geo.paddleY + PADDLE_H) b.y = geo.paddleY - BALL;
    b.x = Math.max(0, Math.min(geo.W - BALL, b.x));
    b.y = Math.max(geo.top, b.y);
  }
  s.paddleX = Math.max(0, Math.min(geo.W - PADDLE_W, s.paddleX));
  s.geo = { ...geo };
}
