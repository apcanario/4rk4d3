// Glide simulation (PLAN §6i): beach air hockey against a crab. A fixed 120 Hz
// step with swept collisions (sub-steps of at most half a pixel of relative
// motion), the table, the goals, the serve, the stall and pin rules. Pure data
// in, events out: this module never touches the DOM and imports nothing, so
// tests/glide-sim.mjs runs it in Node. The crab's mind is bot.js; the caller
// hands this module where each mallet wants to go.
//
// Coordinates are logical px (PLAN §3), y down. The state is a plain JSON-able
// object held in memory only; nothing is counted or stored (PLAN §2): a goal is
// an event, never a number. The session clock is not read here: callers pass
// ease, how far the dusk slowdown has gone (0 to 1, shared/session.js
// slowdownOf), so tests drive it.

export const STEP_HZ = 120;
export const DT = 1 / STEP_HZ;

// Table and play values (PLAN §6i). glide.js and the tests read them from here.
export const SIM = Object.freeze({
  seaFrac: 0.05, // the sea strip across the top: about 5 percent of the height...
  seaMax: 16, // ...never more than 16 px
  band: 2, // the darker sand band along the side and bottom edges (the walls)
  goalW: 45, // both goal mouths, centred (post centre to post centre)
  inlet: 6, // the inlet reaches this far into the sand below the tide line; its floor is the goal line
  buoyR: 3, // the buoys at the inlet's two corners (round posts)
  castleR: 3.5, // the sandcastles at the bottom mouth: a short upright capsule each
  castleH: 3, // its length above the bottom wall line
  puckR: 5, // the shell
  malletR: 9, // the life ring, and the crab's collision radius
  topSpeed: 220, // px/s
  topSpeedDusk: 150, // the exit ramp lowers the top speed to this over minutes 10 to 12 (with the crab, bot.js)
  crossings: 2.4, // drag: a full-speed puck rolls this many table lengths before it would stop (PLAN: twice or more)
  wallBounce: 0.9,
  hitBounce: 0.9, // a mallet hit: the puck's speed along the contact normal, relative to the mallet, comes back at this
  stallSpeed: 15, // a puck under this...
  stallS: 2, // ...for this long...
  stallPush: 45, // ...gets a push of this speed toward the half it is not in
  pinPush: 70, // a pinned puck is pushed out along the wall at this speed...
  yieldS: 0.25, // ...and the mallet that pinned it gives way: it holds still this long
  serveSpeed: 60, // from the centre spot toward whoever conceded
  serveSpreadDeg: 20, // the serve leaves up to this far either side of straight
  ringMaxSpeed: 900, // the ring follows the thumb, at most this fast
  goalS: 1.1, // after a goal: the puck runs on out, a pulse and a wave, then the serve
  maxSub: 0.5, // sub-step length, px of relative motion
  hitMin: 8, // a touch slower than this (px/s, along the normal) is a push, not a hit: no event, no tick
});

// Drawing values (glide.js and the hub's card; the tests measure the colours they give).
export const LOOK = Object.freeze({
  shadowAmount: 0.15, // the pieces' soft shadow: the ground mixed this far toward the shade target
  pebbleShare: 0.6, // pebbles and the little shell: the decor amount times this toward the shade target
  glintAmount: 0.15, // the sun's (the moon's) reflection on the strip: the sun mixed this far toward sea band 1, as the scene's glints
  castleHiMin: 0.28, // review: the castles' highlight row goes at least this far toward white (dark's 0.24 left the ring at WCAG 2.74 on it)
});

const EPS = 1e-9;

/* ---------- colours: from the token module the caller passes (this module imports nothing) ---------- */

/**
 * The table's colours at mix t of the exit ramp (0 sunset .. 1 dusk; the step / sceneSteps). T is
 * shared/tokens.js; set is a token set (T.LIGHT or T.DARK), or the active one.
 * Every value is a token or a PLAN §3 mix of tokens.
 */
export function tableColours(T, t, set) {
  const s = set || T.tokens();
  const C = s.COLORS;
  const pal = T.scenePalette(t, s);
  const ground = T.mix(C.sand, s.DUSK.sand, t);
  return {
    ground,
    sea: pal.sea,
    glint: T.mix(C.sun, pal.sea[0], LOOK.glintAmount),
    foam: C.foam,
    wet: C.wetSand,
    wall: C.sandWall,
    gap: T.shade(C.sandWall, s),
    line: C.courtLine,
    shadow: T.mix(ground, C.shadeTarget, LOOK.shadowAmount),
    pink: T.mix(ground, s.BRICK_ROWS[5], s.decorAmount), // starfish: pale tints, never the tracked colours
    blue: T.mix(ground, C.blue, s.decorAmount),
    pebble: T.mix(ground, C.shadeTarget, s.decorAmount * LOOK.pebbleShare),
    castle: C.sandWall,
    // The ring and the shell can pass over the castles (the ring's lowest place reaches them): the highlight row,
    // the pole and the pennant clear both (review of A1; the pole was shade(sandWall), the pennant brick row 6).
    castleHi: T.mix(C.sandWall, C.white, Math.max(s.highlightAmount, LOOK.castleHiMin)),
    flag: s.BRICK_ROWS[6],
    pole: C.sandWall,
    buoy: C.coral,
    buoyEdge: T.edge(C.coral, s),
    buoyBand: C.white,
  };
}

/** Every colour each piece draws, by its mask keys (PUCK_MASK, RING_MASK, CRAB_MASK). */
export function pieceColours(T, set) {
  const s = set || T.tokens();
  const C = s.COLORS;
  const coralEdge = T.edge(C.coral, s);
  return {
    puck: { o: coralEdge, p: s.BRICK_ROWS[6], w: C.white },
    ring: { o: coralEdge, '#': C.coral, w: C.white },
    crab: { o: coralEdge, '#': C.coral, w: C.white, e: C.shadeTarget, s: T.shade(C.coral, s), h: T.highlight(C.coral, s) },
  };
}

/* ---------- the pieces' masks (data only; glide.js and the hub's card colour them) ---------- */

// Discs by distance from the centre of a (2r+1) square: '.' outside.
function disc(r, paint) {
  const n = r * 2 + 1;
  const rows = [];
  for (let y = 0; y < n; y++) {
    let row = '';
    for (let x = 0; x < n; x++) row += paint(Math.hypot(x - r, y - r), Math.atan2(y - r, x - r)) || '.';
    rows.push(row);
  }
  return rows;
}

// The shell: a pale face, a pink ring, a pink centre, and a 1 px edge all round (o).
export const PUCK_MASK = disc(SIM.puckR, (d) => (d > SIM.puckR + 0.5 ? null : d > SIM.puckR - 0.5 ? 'o' : d > SIM.puckR - 1.5 ? 'p' : d > 1.2 ? 'w' : 'p'));

// The life ring: coral with four white bands on the diagonals, its edge outside and round the hole.
export const RING_MASK = disc(SIM.malletR, (d, a) => {
  if (d > SIM.malletR + 0.5 || d <= 3.5) return null;
  if (d > SIM.malletR - 0.5 || d <= 4.5) return 'o';
  const q = Math.abs(((a + Math.PI * 2) % (Math.PI / 2)) - Math.PI / 4); // distance from a diagonal
  return q < 0.22 ? 'w' : '#';
});

// The crab, 19 x 14, drawn from shapes then outlined (o): claws raised, eyes on stalks, legs out.
export const CRAB_MASK = (() => {
  const W = 19;
  const H = 14;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (x, y0, k) => {
    const y = y0 + 1; // one row of room above the claws for their outline
    if (x >= 0 && x < W && y >= 0 && y < H && (g[y][x] === '.' || k !== '#')) g[y][x] = k;
  };
  // body: an oval
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) if (((x - 9) / 6.6) ** 2 + ((y - 8) / 3.4) ** 2 <= 1) set(x, y, '#');
  // claws: two rounded pincers up at the sides, open toward the middle
  for (const [cx, dir] of [[2, 1], [16, -1]]) {
    for (let y = 1; y <= 4; y++) for (let x = cx - 1; x <= cx + 1; x++) set(x, y, '#');
    set(cx + dir * 1, 0, '#');
    set(cx - dir * 1, 0, '#');
    set(cx + dir * 2, 1, '#');
    set(cx, 1, '.'); // the pincer's gap
    set(cx, 0, '.');
    set(cx + dir, 5, '#'); // the arm down to the body
    set(cx + dir * 2, 6, '#');
  }
  // eye stalks and eyes
  for (const ex of [7, 11]) { set(ex, 4, '#'); set(ex, 3, 'w'); set(ex, 2, 'w'); }
  set(7, 2, 'e');
  set(11, 2, 'e');
  // legs: three short strokes each side
  for (const [x, y] of [[2, 9], [1, 10], [3, 11], [2, 12], [16, 9], [17, 10], [15, 11], [16, 12]]) set(x, y, '#');
  // the mouth, and the highlight row of the shell
  for (let x = 8; x <= 10; x++) set(x, 9, 's');
  for (let x = 6; x <= 12; x++) set(x, 6, 'h');
  // outline: every empty pixel next to the crab
  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      const near = [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => g[y + dy] && g[y + dy][x + dx] && g[y + dy][x + dx] !== '.');
      if (near) out[y][x] = 'o';
    }
  }
  return out.map((row) => row.join(''));
})();


/* ---------- random: a seeded generator kept in the state ---------- */

export function rand(s) {
  let t = (s.seed = (s.seed + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ---------- the table ---------- */

/**
 * The table for a logical screen W x H with safe insets (logical px). The sea
 * strip runs from the top to the tide line T (5 percent of H, at most 16 px;
 * never above the top inset, so the goal is inside the safe area). The inlet is
 * a notch of sea, goalW wide, from T down to the goal line G, with a buoy at each
 * corner. Sand from T to the screen's bottom; the walls are the side edges and
 * the bottom wall line yB, a band above the bottom inset; the player's goal is
 * the gap between two sandcastles on it.
 */
export function geometry(W, H, safe = { top: 0, bottom: 0, left: 0, right: 0 }) {
  const sea = Math.min(SIM.seaMax, Math.round(H * SIM.seaFrac));
  const T = Math.max(sea, safe.top);
  const G = T + SIM.inlet;
  const xL = SIM.band;
  const xR = W - SIM.band;
  const yB = H - safe.bottom - SIM.band;
  const mx0 = (W - SIM.goalW) / 2;
  const mx1 = mx0 + SIM.goalW;
  const mid = (G + yB) / 2;
  const cx = W / 2;
  const m = SIM.malletR + 1; // a mallet's drawn disc stays clear of the bands and the halfway line
  return {
    W, H, sea: T, T, G, xL, xR, yB, mx0, mx1, mid, cx,
    ring: { x0: xL + m, x1: xR - m, y0: mid + m, y1: yB - m },
    crab: { x0: xL + m, x1: xR - m, y0: G + m, y1: mid - m },
    // Static colliders for the puck: segments (capsules of radius r) and the side walls as planes.
    segs: [
      { x0: xL, y0: T, x1: mx0, y1: T, r: 0, kind: 'wall' }, // the tide line, left of the inlet
      { x0: mx1, y0: T, x1: xR, y1: T, r: 0, kind: 'wall' }, // and right of it
      { x0: mx0, y0: T, x1: mx0, y1: G, r: 0, kind: 'wall' }, // the inlet's sides (the buoy lines)
      { x0: mx1, y0: T, x1: mx1, y1: G, r: 0, kind: 'wall' },
      { x0: mx0, y0: G, x1: mx0, y1: G, r: SIM.buoyR, kind: 'post' }, // the buoys
      { x0: mx1, y0: G, x1: mx1, y1: G, r: SIM.buoyR, kind: 'post' },
      { x0: xL, y0: yB, x1: mx0, y1: yB, r: 0, kind: 'wall' }, // the bottom wall, either side of the player's goal
      { x0: mx1, y0: yB, x1: xR, y1: yB, r: 0, kind: 'wall' },
      { x0: mx0, y0: yB - SIM.castleH, x1: mx0, y1: yB, r: SIM.castleR, kind: 'post' }, // the sandcastles
      { x0: mx1, y0: yB - SIM.castleH, x1: mx1, y1: yB, r: SIM.castleR, kind: 'post' },
    ],
  };
}

/* ---------- state ---------- */

/** A fresh game: the puck on the centre spot, still; the first serve, at the first step, goes to the player. */
export function create(geo, seed = 1) {
  const s = {
    geo,
    seed: seed >>> 0,
    puck: { x: geo.cx, y: geo.mid, vx: 0, vy: 0 },
    ring: { x: geo.cx, y: clampN(geo.mid + (geo.yB - geo.mid) * 0.6, geo.ring.y0, geo.ring.y1), vx: 0, vy: 0, yield: 0 },
    crab: { x: geo.cx, y: geo.crab.y0 + 4, vx: 0, vy: 0, yield: 0 },
    phase: 'ready', // 'ready' (on the spot, before the first serve) | 'play' | 'goal'
    serveTo: 'player', // the first serve of an opening goes to the player
    goal: null, // { by: 'player' | 'crab', t } during the goal pause
    stall: 0, // seconds the puck has been under stallSpeed
    pinned: 0, // steps in a row the puck was pinned (for the tests)
    t: 0,
  };
  s.crab.y = clampN(s.crab.y, geo.crab.y0, geo.crab.y1);
  return s;
}

/** A new table (a resize): everything is placed again inside it, nothing else changes. */
export function setGeometry(s, geo) {
  const kx = geo.W / s.geo.W;
  const ky = (y) => geo.G + ((y - s.geo.G) * (geo.yB - geo.G)) / (s.geo.yB - s.geo.G);
  s.puck.x *= kx;
  s.puck.y = ky(s.puck.y);
  for (const m of [s.ring, s.crab]) { m.x *= kx; m.y = ky(m.y); }
  s.geo = geo;
  clampMallet(s.ring, geo.ring);
  clampMallet(s.crab, geo.crab);
  if (s.phase !== 'goal') keepOnTable(s);
}

function clampN(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function clampMallet(m, b) {
  m.x = clampN(m.x, b.x0, b.x1);
  m.y = clampN(m.y, b.y0, b.y1);
}

/** The puck's top speed at a point of the dusk slowdown (0 to 1). */
export function topSpeed(ease = 0) {
  return SIM.topSpeed + (SIM.topSpeedDusk - SIM.topSpeed) * clampN(ease, 0, 1);
}

/** Constant drag (px/s^2) for a table: a full-speed puck rolls SIM.crossings table lengths before it stops. */
export function drag(geo) {
  const L = geo.yB - geo.G;
  return (SIM.topSpeed * SIM.topSpeed) / (2 * SIM.crossings * L);
}

export const speedOf = (p) => Math.hypot(p.vx, p.vy);

function serve(s) {
  const g = s.geo;
  const a = ((rand(s) * 2 - 1) * SIM.serveSpreadDeg * Math.PI) / 180;
  const dir = s.serveTo === 'player' ? 1 : -1;
  s.puck = { x: g.cx, y: g.mid, vx: Math.sin(a) * SIM.serveSpeed, vy: Math.cos(a) * SIM.serveSpeed * dir };
  s.phase = 'play';
  s.goal = null;
  s.stall = 0;
}

/* ---------- collisions ---------- */

// Closest point on a segment to p.
function closest(seg, px, py) {
  const dx = seg.x1 - seg.x0;
  const dy = seg.y1 - seg.y0;
  const L2 = dx * dx + dy * dy;
  let u = L2 > 0 ? ((px - seg.x0) * dx + (py - seg.y0) * dy) / L2 : 0;
  u = clampN(u, 0, 1);
  return [seg.x0 + dx * u, seg.y0 + dy * u];
}

/**
 * Push the puck out of every static collider and the side walls, bouncing it.
 * Returns the last wall normal touched ([nx, ny]) or null, and pushes events.
 */
function statics(s, ev, bounce = true) {
  const p = s.puck;
  const g = s.geo;
  const R = SIM.puckR;
  let normal = null;
  const hit = (nx, ny) => {
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) {
      if (bounce) {
        p.vx -= (1 + SIM.wallBounce) * vn * nx;
        p.vy -= (1 + SIM.wallBounce) * vn * ny;
      } else {
        p.vx -= vn * nx;
        p.vy -= vn * ny;
      }
      ev.push({ type: 'wall', speed: -vn, x: p.x, y: p.y });
    }
    normal = [nx, ny];
  };
  // A corner can push the puck back into a collider already done: a few passes settle it.
  for (let pass = 0, moved = true; pass < 4 && moved; pass++) {
  moved = false;
  if (p.x < g.xL + R) { p.x = g.xL + R; hit(1, 0); moved = true; }
  if (p.x > g.xR - R) { p.x = g.xR - R; hit(-1, 0); moved = true; }
  for (const seg of g.segs) {
    const [cx, cy] = closest(seg, p.x, p.y);
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    const need = R + seg.r;
    if (d >= need) continue;
    let nx;
    let ny;
    if (d > EPS) { nx = dx / d; ny = dy / d; } else {
      // exactly on the line: push toward the table's inside
      nx = 0; ny = p.y < g.mid ? 1 : -1;
    }
    // A wall line is one-sided: the table side of the tide line and the bottom wall.
    if (seg.r === 0 && seg.y0 === seg.y1) {
      const inside = seg.y0 === g.T ? 1 : -1;
      if (ny * inside < 0 || Math.abs(ny) < EPS) { nx = 0; ny = inside; }
    }
    p.x = cx + nx * need;
    p.y = cy + ny * need;
    hit(nx, ny);
    moved = true;
  }
  }
  return normal;
}

/** A mallet against the puck. Returns the contact normal if they touched. */
function mallet(s, m, who, ev) {
  const p = s.puck;
  const need = SIM.puckR + SIM.malletR;
  let dx = p.x - m.x;
  let dy = p.y - m.y;
  let d = Math.hypot(dx, dy);
  if (d >= need) return null;
  if (d < EPS) { dx = 0; dy = who === 'ring' ? -1 : 1; d = 1; }
  const nx = dx / d;
  const ny = dy / d;
  p.x = m.x + nx * need;
  p.y = m.y + ny * need;
  const rel = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  if (rel < 0) {
    // The puck's speed along the normal, relative to the mallet, comes back at hitBounce: the mallet's
    // own speed along the normal is added to the puck.
    p.vx -= (1 + SIM.hitBounce) * rel * nx;
    p.vy -= (1 + SIM.hitBounce) * rel * ny;
    if (-rel >= SIM.hitMin) ev.push({ type: 'hit', by: who, speed: -rel, x: p.x, y: p.y });
  }
  return [nx, ny];
}

/**
 * Which way a pinned puck goes out along the wall (normal wall): of the two
 * directions along it, one not blocked by another wall (a corner), away from
 * the mallet if both are open, toward the middle of the table if that is a tie.
 */
function escape(s, wall, m) {
  const g = s.geo;
  const p = s.puck;
  const R = SIM.puckR + 0.75;
  const blocked = ([tx, ty]) => (tx < -0.5 && p.x <= g.xL + R) || (tx > 0.5 && p.x >= g.xR - R)
    || (ty < -0.5 && p.y <= g.T + R) || (ty > 0.5 && p.y >= g.yB - R);
  const a = [-wall[1], wall[0]];
  const b = [wall[1], -wall[0]];
  const open = [a, b].filter((t) => !blocked(t));
  const pool = open.length ? open : [a, b];
  const score = (t) => ((p.x - m.x) * t[0] + (p.y - m.y) * t[1]) * 1000 + ((g.cx - p.x) * t[0] + (g.mid - p.y) * t[1]);
  return pool.reduce((best, t) => (score(t) > score(best) ? t : best));
}

function capSpeed(p, top) {
  const v = speedOf(p);
  if (v > top) { p.vx *= top / v; p.vy *= top / v; }
}

/** Keep the puck on the table (a resize): inside the walls, below the tide line. */
function keepOnTable(s) {
  const g = s.geo;
  const p = s.puck;
  p.x = clampN(p.x, g.xL + SIM.puckR, g.xR - SIM.puckR);
  p.y = clampN(p.y, g.T + SIM.puckR, g.yB - SIM.puckR);
  statics(s, [], false);
}

/* ---------- the step ---------- */

/**
 * One fixed step. want: { ring: {x, y}, crab: {x, y, max} } where each mallet
 * wants to be (the ring follows the thumb, the crab bot.js); each moves toward
 * it at most at its speed cap. ease: the dusk slowdown, 0 to 1. Returns the
 * events of the step: { type: 'hit', by, speed } | { type: 'wall', speed } |
 * { type: 'goal', by } | { type: 'serve', to }.
 */
export function step(s, want, ease = 0) {
  const ev = [];
  const g = s.geo;
  s.t += DT;
  const top = topSpeed(ease);

  // Where the mallets go this step (clamped to their halves; neither enters a goal mouth).
  const goals = { ring: want && want.ring, crab: want && want.crab };
  const move = {};
  for (const [who, cap] of [['ring', SIM.ringMaxSpeed], ['crab', (want && want.crab && want.crab.max) || 0]]) {
    const m = s[who];
    const b = g[who];
    const w = m.yield > 0 ? m : goals[who] || m; // a mallet giving way holds still
    if (m.yield > 0) m.yield = Math.max(0, m.yield - DT);
    const tx = clampN(w.x, b.x0, b.x1);
    const ty = clampN(w.y, b.y0, b.y1);
    let dx = tx - m.x;
    let dy = ty - m.y;
    const d = Math.hypot(dx, dy);
    const lim = cap * DT;
    if (d > lim) { dx *= lim / d; dy *= lim / d; }
    move[who] = [dx, dy];
    m.vx = dx / DT;
    m.vy = dy / DT;
  }

  if (s.phase === 'ready') {
    serve(s);
    ev.push({ type: 'serve', to: s.serveTo });
  }

  if (s.phase === 'goal') {
    // The puck runs on out to sea (or off the bottom); the mallets move; no collisions.
    for (const who of ['ring', 'crab']) { s[who].x += move[who][0]; s[who].y += move[who][1]; }
    s.puck.x += s.puck.vx * DT;
    s.puck.y += s.puck.vy * DT;
    s.goal.t += DT;
    if (s.goal.t >= SIM.goalS) {
      serve(s);
      ev.push({ type: 'serve', to: s.serveTo });
    }
    return ev;
  }

  // Drag, then the ceiling (the exit ramp lowers it).
  const p = s.puck;
  const v0 = speedOf(p);
  if (v0 > 0) {
    const v1 = Math.max(0, v0 - drag(g) * DT);
    p.vx *= v1 / v0;
    p.vy *= v1 / v0;
  }
  capSpeed(p, top);

  // Swept: sub-steps of at most SIM.maxSub px of motion of the puck or of either mallet.
  const span = Math.max(speedOf(p) * DT, Math.hypot(...move.ring), Math.hypot(...move.crab));
  const n = Math.max(1, Math.ceil(span / SIM.maxSub));
  let pinnedNow = false;
  for (let i = 0; i < n; i++) {
    for (const who of ['ring', 'crab']) {
      s[who].x += move[who][0] / n;
      s[who].y += move[who][1] / n;
    }
    p.x += (p.vx * DT) / n;
    p.y += (p.vy * DT) / n;
    statics(s, ev);
    for (const who of ['ring', 'crab']) {
      const m = s[who];
      const nrm = mallet(s, m, who, ev);
      if (!nrm) continue;
      capSpeed(p, top);
      const wall = statics(s, ev);
      const need = SIM.puckR + SIM.malletR;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (wall && d < need - 1e-6) {
        // Pinned against a wall or corner: the puck goes out along the wall, the mallet gives way.
        pinnedNow = true;
        const t = escape(s, wall, m);
        const tx = t[0];
        const ty = t[1];
        p.vx = tx * SIM.pinPush + wall[0] * 10;
        p.vy = ty * SIM.pinPush + wall[1] * 10;
        let ux = m.x - p.x;
        let uy = m.y - p.y;
        const du = Math.hypot(ux, uy) || 1;
        ux /= du; uy /= du;
        m.x = p.x + ux * need;
        m.y = p.y + uy * need;
        clampMallet(m, g[who]);
        if (Math.hypot(p.x - m.x, p.y - m.y) < need) {
          // The clamp put it back: step it straight away from the wall instead.
          m.x = p.x + wall[0] * need;
          m.y = p.y + wall[1] * need;
          clampMallet(m, g[who]);
        }
        m.vx = 0;
        m.vy = 0;
        m.yield = SIM.yieldS;
        move[who] = [0, 0];
      }
    }
    // A goal: the puck's centre across a goal line inside its mouth.
    if (p.y < g.G && p.x > g.mx0 && p.x < g.mx1) return scored(s, 'player', ev);
    if (p.y > g.yB && p.x > g.mx0 && p.x < g.mx1) return scored(s, 'crab', ev);
  }
  s.pinned = pinnedNow ? s.pinned + 1 : 0;

  // Stall: a slow puck for stallS gets a gentle push toward the half it is not in.
  if (speedOf(p) < SIM.stallSpeed) {
    s.stall += DT;
    if (s.stall >= SIM.stallS - EPS) {
      const down = p.y < g.mid ? 1 : -1;
      const side = (g.cx - p.x) / g.W; // a little toward the middle
      p.vx = side * SIM.stallPush;
      p.vy = down * SIM.stallPush;
      s.stall = 0;
      ev.push({ type: 'stall' });
    }
  } else {
    s.stall = 0;
  }
  return ev;
}

function scored(s, by, ev) {
  s.phase = 'goal';
  s.goal = { by, t: 0 };
  s.serveTo = by === 'player' ? 'crab' : 'player'; // the next serve goes to whoever conceded
  s.stall = 0;
  s.pinned = 0;
  ev.push({ type: 'goal', by });
  return ev;
}
