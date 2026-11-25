// Putt (PLAN §6c): the simulation. A fixed 120 Hz step, swept collisions, no
// DOM and no imports, so it runs in Node, in a Web Worker (the level
// generator's solver uses this same file) and on the page.
//
// Units are logical px and seconds. The ball is a disc of radius BALL_R. The
// course outline is a convex polygon; the ball is kept inside it by one
// half-plane per edge. Bars and blocks are boxes, diagonals are 45 degree
// segments with a half-thickness, pegs are discs. The play values (launch
// speed, deceleration, bounce, capture speed) come in as cfg from the CONFIG
// block at the top of putt.js.

export const STEP_HZ = 120;
export const DT = 1 / STEP_HZ;
export const BALL_R = 2.5; // the 5 x 5 ball
export const WALL_T = 3; // the outline wall, drawn outside the course polygon
export const BAR_T = 3; // a bar's thickness
export const DIAG_HALF = 1.5; // a diagonal's half-thickness
export const PEG_R = 3;
export const MAX_SUB_PX = 1; // the ball moves at most this far between two contact tests
export const CELL = 8; // broad-phase grid cell, px
const MAX_SHOT_STEPS = STEP_HZ * 60; // safety net only: a shot always rests far sooner

// Step results, as bit flags.
export const EV_BOUNCE = 1;
export const EV_SINK = 2;
export const EV_WATER = 4;
export const EV_REST = 8;

/* ---------- geometry helpers (also used by the generator) ---------- */

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** Distance from point p to segment ab. */
export function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/** Distance between segments ab and cd (0 if they cross). */
export function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(bx - ax, by - ay, cx - ax, cy - ay);
  const d2 = cross(bx - ax, by - ay, dx - ax, dy - ay);
  const d3 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
  const d4 = cross(dx - cx, dy - cy, bx - cx, by - cy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegDist(ax, ay, cx, cy, dx, dy),
    pointSegDist(bx, by, cx, cy, dx, dy),
    pointSegDist(cx, cy, ax, ay, bx, by),
    pointSegDist(dx, dy, ax, ay, bx, by),
  );
}

/**
 * A shape as segments with a radius, for distances between pieces:
 * { segs: [[ax, ay, bx, by], ...], r, box } (box set for filled rectangles).
 */
export function shapeOf(p) {
  if (p.k === 'box') {
    const { x, y, w, h } = p;
    return {
      segs: [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]],
      r: 0,
      box: p,
    };
  }
  if (p.k === 'seg') return { segs: [[p.ax, p.ay, p.bx, p.by]], r: p.r };
  return { segs: [[p.x, p.y, p.x, p.y]], r: p.r }; // disc
}

function inBox(x, y, b) {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Clear distance between two shapes (0 when they touch or overlap). */
export function shapeDist(a, b) {
  if (a.box && inBox(b.segs[0][0], b.segs[0][1], a.box)) return 0;
  if (b.box && inBox(a.segs[0][0], a.segs[0][1], b.box)) return 0;
  let d = Infinity;
  for (const s of a.segs) for (const t of b.segs) d = Math.min(d, segSegDist(s[0], s[1], s[2], s[3], t[0], t[1], t[2], t[3]));
  return Math.max(0, d - a.r - b.r);
}

/**
 * The course polygon (convex): the rectangle x0..x1, y0..y1 with its corners
 * cut at 45 degrees. cuts: [top-left, top-right, bottom-right, bottom-left],
 * each 0 (square) or the cut size in px. Clockwise on screen.
 */
export function coursePolygon(x0, y0, x1, y1, cuts) {
  const [tl, tr, br, bl] = cuts;
  const pts = [];
  const add = (x, y) => {
    const q = pts[pts.length - 1];
    if (!q || q[0] !== x || q[1] !== y) pts.push([x, y]);
  };
  add(x0 + tl, y0);
  add(x1 - tr, y0);
  add(x1, y0 + tr);
  add(x1, y1 - br);
  add(x1 - br, y1);
  add(x0 + bl, y1);
  add(x0, y1 - bl);
  add(x0, y0 + tl);
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
}

/** Inward half-planes of a clockwise convex polygon: inside when nx*x + ny*y >= c. */
export function halfPlanes(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const L = Math.hypot(bx - ax, by - ay);
    // Clockwise on screen (y down): the inside is to the right of a -> b.
    const nx = -(by - ay) / L;
    const ny = (bx - ax) / L;
    out.push({ nx, ny, c: nx * ax + ny * ay, ax, ay, bx, by });
  }
  return out;
}

/** Signed distance inside the polygon (negative outside): the smallest over its half-planes. */
export function insideDist(planes, x, y) {
  let d = Infinity;
  for (const p of planes) d = Math.min(d, p.nx * x + p.ny * y - p.c);
  return d;
}

/* ---------- the world: a level's solids and hazards, with a broad phase ---------- */

/**
 * Build the collision world of a level (see gen.js for the level's shape).
 * Solids: the outline's half-planes, bars and blocks (boxes), diagonals
 * (segments), pegs (discs). Hazards: sand traps and water (boxes). Each grid
 * cell lists the solids near it, so a step tests only a few.
 */
export function buildWorld(level) {
  const planes = halfPlanes(level.poly);
  const solids = [];
  for (const p of planes) solids.push({ t: 0, nx: p.nx, ny: p.ny, c: p.c, ax: p.ax, ay: p.ay, bx: p.bx, by: p.by });
  for (const b of level.bars) solids.push({ t: 1, x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
  for (const b of level.blocks) solids.push({ t: 1, x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
  for (const d of level.diags) solids.push({ t: 2, ax: d.ax, ay: d.ay, bx: d.bx, by: d.by, r: DIAG_HALF });
  for (const g of level.pegs) solids.push({ t: 3, x: g.x, y: g.y, r: PEG_R });

  const gx0 = level.x0 - WALL_T - CELL;
  const gy0 = level.y0 - WALL_T - CELL;
  const cols = Math.ceil((level.x1 - level.x0 + 2 * (WALL_T + CELL)) / CELL) + 1;
  const rows = Math.ceil((level.y1 - level.y0 + 2 * (WALL_T + CELL)) / CELL) + 1;
  const cells = Array.from({ length: cols * rows }, () => []);
  const m = BALL_R + MAX_SUB_PX + 2; // reach of a test from inside a cell
  solids.forEach((s, i) => {
    let bx0;
    let by0;
    let bx1;
    let by1;
    if (s.t === 0) {
      bx0 = Math.min(s.ax, s.bx); bx1 = Math.max(s.ax, s.bx); by0 = Math.min(s.ay, s.by); by1 = Math.max(s.ay, s.by);
    } else if (s.t === 1) {
      bx0 = s.x0; bx1 = s.x1; by0 = s.y0; by1 = s.y1;
    } else if (s.t === 2) {
      bx0 = Math.min(s.ax, s.bx) - s.r; bx1 = Math.max(s.ax, s.bx) + s.r; by0 = Math.min(s.ay, s.by) - s.r; by1 = Math.max(s.ay, s.by) + s.r;
    } else {
      bx0 = s.x - s.r; bx1 = s.x + s.r; by0 = s.y - s.r; by1 = s.y + s.r;
    }
    const c0 = clamp(Math.floor((bx0 - m - gx0) / CELL), 0, cols - 1);
    const c1 = clamp(Math.floor((bx1 + m - gx0) / CELL), 0, cols - 1);
    const r0 = clamp(Math.floor((by0 - m - gy0) / CELL), 0, rows - 1);
    const r1 = clamp(Math.floor((by1 + m - gy0) / CELL), 0, rows - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c].push(i);
  });
  return {
    level,
    planes,
    solids,
    cells,
    cols,
    rows,
    gx0,
    gy0,
    traps: level.traps.map((t) => [t.x, t.y, t.x + t.w, t.y + t.h]),
    water: level.water.map((t) => [t.x, t.y, t.x + t.w, t.y + t.h]),
    hole: level.hole,
  };
}

function cellOf(w, x, y) {
  const c = clamp(Math.floor((x - w.gx0) / CELL), 0, w.cols - 1);
  const r = clamp(Math.floor((y - w.gy0) / CELL), 0, w.rows - 1);
  return w.cells[r * w.cols + c];
}

// Scratch for the deepest contact: penetration and normal.
const hit = { pen: 0, nx: 0, ny: 0 };

/** Deepest contact of a ball at x, y (radius rad) with any solid; false if none. */
function deepest(w, x, y, rad) {
  hit.pen = 0;
  const list = cellOf(w, x, y);
  let found = false;
  for (let k = 0; k < list.length; k++) {
    const s = w.solids[list[k]];
    let pen;
    let nx;
    let ny;
    if (s.t === 0) {
      pen = rad - (s.nx * x + s.ny * y - s.c);
      nx = s.nx;
      ny = s.ny;
    } else if (s.t === 1) {
      const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x;
      const cy = y < s.y0 ? s.y0 : y > s.y1 ? s.y1 : y;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) {
        pen = rad - d;
        nx = dx / d;
        ny = dy / d;
      } else {
        // centre inside the box (never in play; kept safe): out by the nearest face
        const l = x - s.x0;
        const r = s.x1 - x;
        const t = y - s.y0;
        const b = s.y1 - y;
        const m = Math.min(l, r, t, b);
        pen = rad + m;
        nx = m === l ? -1 : m === r ? 1 : 0;
        ny = m === t ? -1 : m === b ? 1 : 0;
        if (nx !== 0 && ny !== 0) ny = 0;
      }
    } else if (s.t === 2) {
      const ex = s.bx - s.ax;
      const ey = s.by - s.ay;
      const L = ex * ex + ey * ey;
      let u = ((x - s.ax) * ex + (y - s.ay) * ey) / L;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = x - (s.ax + u * ex);
      const dy = y - (s.ay + u * ey);
      const d = Math.sqrt(dx * dx + dy * dy);
      pen = rad + s.r - d;
      if (d > 0) {
        nx = dx / d;
        ny = dy / d;
      } else {
        nx = -ey / Math.sqrt(L);
        ny = ex / Math.sqrt(L);
      }
    } else {
      const dx = x - s.x;
      const dy = y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      pen = rad + s.r - d;
      nx = d > 0 ? dx / d : 0;
      ny = d > 0 ? dy / d : -1;
    }
    if (pen > hit.pen) {
      hit.pen = pen;
      hit.nx = nx;
      hit.ny = ny;
      found = true;
    }
  }
  return found;
}

/** Deepest overlap of a ball at x, y with any solid (0 if clear). For tests and the generator. */
export function overlap(w, x, y, rad = BALL_R) {
  return deepest(w, x, y, rad) ? hit.pen : 0;
}

function inRect(list, x, y) {
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return true;
  }
  return false;
}

export const inTrap = (w, x, y) => inRect(w.traps, x, y);
export const inWater = (w, x, y) => inRect(w.water, x, y);

/**
 * Push the ball out of every solid it touches; reflect its velocity off each
 * one it moves into, keeping cfg.bounce of the speed (angle in equals angle
 * out). Returns the largest normal speed of a bounce, or 0.
 */
function resolve(w, b, bounce) {
  let vnMax = 0;
  for (let i = 0; i < 4; i++) {
    if (!deepest(w, b.x, b.y, BALL_R)) break;
    b.x += hit.nx * hit.pen;
    b.y += hit.ny * hit.pen;
    const vn = b.vx * hit.nx + b.vy * hit.ny;
    if (vn < 0) {
      b.vx = (b.vx - 2 * vn * hit.nx) * bounce;
      b.vy = (b.vy - 2 * vn * hit.ny) * bounce;
      if (-vn > vnMax) vnMax = -vn;
    }
  }
  return vnMax;
}

/* ---------- the ball ---------- */

/** A ball at rest at x, y. ox, oy: where the last shot was taken (water returns it there). */
export function newBall(x, y) {
  return { x, y, vx: 0, vy: 0, ox: x, oy: y, moving: false, sunk: false, vn: 0 };
}

/** Take a shot: direction (dx, dy), any length; speed in px per second. */
export function shoot(b, dx, dy, speed) {
  const L = Math.hypot(dx, dy);
  if (!(L > 0) || !(speed > 0) || b.sunk) return false;
  b.ox = b.x;
  b.oy = b.y;
  b.vx = (dx / L) * speed;
  b.vy = (dy / L) * speed;
  b.moving = true;
  return true;
}

/**
 * One fixed step. Constant deceleration (tripled in a sand trap); the ball
 * stops below cfg.stopSpeed. The move is cut into sub-steps of at most
 * MAX_SUB_PX, well under the ball's radius, with a contact test after each,
 * so the ball cannot pass through a wall. Water returns the ball to where the
 * shot was taken; the hole takes it when its centre is within the hole radius
 * at under cfg.captureSpeed. Returns EV_* flags; b.vn holds the largest
 * bounce's normal speed of the step.
 */
export function step(w, b, cfg) {
  b.vn = 0;
  if (!b.moving) return 0;
  const speed = Math.hypot(b.vx, b.vy);
  const dec = cfg.decel * (inRect(w.traps, b.x, b.y) ? cfg.sandFactor : 1);
  const ns = speed - dec * DT;
  if (ns < cfg.stopSpeed) {
    b.vx = 0;
    b.vy = 0;
    b.moving = false;
    return EV_REST;
  }
  b.vx *= ns / speed;
  b.vy *= ns / speed;
  let ev = 0;
  const n = Math.max(1, Math.ceil((ns * DT) / MAX_SUB_PX));
  const h = w.hole;
  for (let i = 0; i < n; i++) {
    b.x += (b.vx * DT) / n;
    b.y += (b.vy * DT) / n;
    const vn = resolve(w, b, cfg.bounce);
    if (vn > 0) {
      ev |= EV_BOUNCE;
      if (vn > b.vn) b.vn = vn;
    }
    if (inRect(w.water, b.x, b.y)) {
      b.x = b.ox;
      b.y = b.oy;
      b.vx = 0;
      b.vy = 0;
      b.moving = false;
      return ev | EV_WATER | EV_REST;
    }
    const dx = b.x - h.x;
    const dy = b.y - h.y;
    if (dx * dx + dy * dy <= h.r * h.r && b.vx * b.vx + b.vy * b.vy < cfg.captureSpeed * cfg.captureSpeed) {
      b.x = h.x;
      b.y = h.y;
      b.vx = 0;
      b.vy = 0;
      b.moving = false;
      b.sunk = true;
      return ev | EV_SINK;
    }
  }
  return ev;
}

/** True if the ball, played on from where it is, drops in the hole within `steps` steps. Leaves b untouched. */
export function sinksWithin(w, b, cfg, steps) {
  if (!b.moving) return false;
  const c = { ...b };
  for (let i = 0; i < steps && c.moving; i++) if (step(w, c, cfg) & EV_SINK) return true;
  return false;
}

/**
 * The haptic ticks of one step (PLAN §6c): { bounce, sink }. The sink tick
 * has priority over the shared 40 ms gap: a bounce ticks only if the ball met
 * the wall at least minSpeed fast (normal to it) and does not drop in the hole
 * in this step or within the next lookSteps steps, so a bounce just before the
 * drop never takes the gap the sink tick needs.
 */
export function stepTicks(w, b, ev, cfg, minSpeed, lookSteps) {
  const sink = (ev & EV_SINK) !== 0;
  const bounce = (ev & EV_BOUNCE) !== 0 && b.vn >= minSpeed && !sink && !sinksWithin(w, b, cfg, lookSteps);
  return { bounce, sink };
}

/**
 * Play one shot from x, y to the end: { sunk, water, x, y } where the ball
 * rests (water: back at x, y). The generator's solver uses this.
 */
export function playShot(w, x, y, dx, dy, speed, cfg, b = newBall(x, y)) {
  b.x = x;
  b.y = y;
  b.moving = false;
  b.sunk = false;
  shoot(b, dx, dy, speed);
  let ev = 0;
  for (let i = 0; i < MAX_SHOT_STEPS && b.moving; i++) ev |= step(w, b, cfg);
  if (b.moving) { b.moving = false; b.vx = 0; b.vy = 0; } // never reached
  return { sunk: b.sunk, water: (ev & EV_WATER) !== 0, x: b.x, y: b.y };
}

/**
 * The aim guide: the path of a ball sent from x, y along (dx, dy), to the
 * first solid it would hit, then `after` px of the rebound. Hazards and the
 * hole are ignored. Returns { hit: [x, y] or null, pts: [[x, y], ...] } with
 * a point every px; pts up to the hit are the first leg.
 */
export function aimPath(w, x, y, dx, dy, after = 12, maxLen = 480) {
  const L = Math.hypot(dx, dy);
  const b = { x, y, vx: dx / L, vy: dy / L };
  const pts = [];
  let hitAt = null;
  let leg = 0;
  let rest = after;
  for (let i = 0; i < maxLen; i++) {
    b.x += b.vx;
    b.y += b.vy;
    const vn = resolve(w, b, 1);
    if (vn > 0 && !hitAt) {
      hitAt = [b.x, b.y];
      leg = pts.length;
    }
    pts.push([b.x, b.y]);
    if (hitAt && --rest <= 0) break;
  }
  return { hit: hitAt, leg: hitAt ? leg : pts.length, pts };
}

/**
 * The shot of a pull (PLAN §6c Shot control): the thumb went down at x0, y0
 * and is now at x1, y1 (logical px). The shot goes the opposite way to the
 * pull; its speed is cfg.launchSpeed times the pull length over
 * cfg.pullCapPx, capped. A pull of cfg.cancelPx or less is no shot (null).
 */
export function pullShot(x0, y0, x1, y1, cfg) {
  const dx = x0 - x1;
  const dy = y0 - y1;
  const len = Math.hypot(dx, dy);
  if (!(len > cfg.cancelPx)) return null;
  const power = Math.min(len, cfg.pullCapPx) / cfg.pullCapPx;
  return { dx, dy, len, power, speed: cfg.launchSpeed * power };
}
