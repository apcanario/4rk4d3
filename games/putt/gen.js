// Putt (PLAN §6c): the level generator, with its solver. No DOM. It runs on
// the page, in Node (tests/putt-sim.mjs) and as a module Web Worker (putt.js
// starts this same file as a worker, so the next level is built in the
// background while the current one is played).
//
// Every level comes from a seed, a difficulty (1, 2 or 3) and the screen's
// logical height (and its top and bottom safe-area insets, 0 on most phones):
// the same inputs always give the same level. A candidate is kept only if the
// solver, which plays shots with the same sim.js as the game, sinks the ball
// within the stroke range of its difficulty; after GEN.rejectLimit rejected
// candidates the generator falls back to an open level-1 course.

// Generator values: one block (PLAN §6c Files). Play values (launch speed,
// deceleration, bounce, capture speed) live in CONFIG at the top of putt.js
// and are passed in.
export const GEN = Object.freeze({
  insetX: 6, // the course's outer edge, px from the left and right of the screen
  insetTop: 6, // ...from the top
  insetBottom: 26, // ...and from the bottom (the sea below is the thumb's)
  teeSpreadPx: 20, // the tee sits within this of the centre, at the bottom of the course
  teeAbovePx: 9.5, // the tee's centre, this far above the course floor's bottom edge
  holeZone: 0.2, // the hole is in the top fifth of the course
  holeTopPx: 10, // ...at least this far below the course's top edge (room for the flag)
  cutSize: [10, 24], // a cut corner, px along each side
  barGapMin: 22, // a bar leaves at least this gap
  barLenMin: 0.45, // a bar reaches at least this fraction of the course width
  diagLen: [20, 50], // a diagonal's length, px
  blockW: [8, 24],
  blockH: [8, 12],
  hazardSide: [16, 30], // sand traps and water, px a side
  passageMin: 14, // every passage at least this wide
  clearTeeHole: 12, // nothing within this of the tee or the hole (measured from the ball's and the hole's edge)
  hazardGap: 3, // traps and water keep this clear of every other piece and the walls
  placeTries: 60, // random tries to place one piece before the candidate is given up
  rejectLimit: 30, // rejected candidates before the open level-1 fallback
  solverDirs: 96, // the solver tries this many directions...
  solverPowers: 5, // ...at this many powers (evenly up to the full launch speed)...
  solverBeam: 12, // ...keeps the best dozen resting spots after each stroke...
  fieldCell: 2, // ...ranked by the walking distance to the hole on a grid of this size
  sliceShots: 24, // the solver yields after this many shots (for slicing off a worker)
  // The table of PLAN §6c: [min, max] counts, drawn at random inside the range.
  table: Object.freeze({
    1: Object.freeze({ cuts: [0, 2], bars: [0, 1], diags: [0, 1], blocks: [1, 2], pegs: [0, 0], traps: [0, 0], water: [0, 0], holeR: 5, straight: true, strokes: [1, 2] }),
    2: Object.freeze({ cuts: [1, 3], bars: [1, 2], diags: [1, 2], blocks: [1, 3], pegs: [0, 2], traps: [0, 1], water: [0, 1], holeR: 5, straight: false, strokes: [2, 3] }),
    3: Object.freeze({ cuts: [2, 4], bars: [2, 3], diags: [2, 3], blocks: [2, 4], pegs: [1, 3], traps: [0, 1], water: [1, 1], holeR: 4, straight: false, strokes: [3, 4] }),
  }),
});

import {
  BALL_R, WALL_T, BAR_T, DIAG_HALF, PEG_R, coursePolygon, halfPlanes, insideDist, shapeOf, shapeDist,
  buildWorld, playShot, newBall, overlap, inWater,
} from './sim.js';

export const LEVEL_VERSION = 1;

/** Seeded random numbers (mulberry32): a function giving [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));

/** The difficulty of a new course: 1, 2 or 3 with equal odds; level 1 only in the dusk phase. */
export function pickDifficulty(rand, dusk) {
  return dusk ? 1 : 1 + Math.min(2, Math.floor(rand() * 3));
}

/** The course box (the sand inside the wall) for a screen height and its insets. */
export function courseBox(H, top = 0, bottom = 0) {
  return {
    x0: GEN.insetX + WALL_T,
    x1: 135 - GEN.insetX - WALL_T,
    y0: GEN.insetTop + top + WALL_T,
    y1: H - GEN.insetBottom - bottom - WALL_T,
  };
}

/* ---------- pieces as shapes ---------- */

export const boxShape = (b) => shapeOf({ k: 'box', x: b.x, y: b.y, w: b.w, h: b.h });
export const diagShape = (d) => shapeOf({ k: 'seg', ax: d.ax, ay: d.ay, bx: d.bx, by: d.by, r: DIAG_HALF });
export const pegShape = (p) => shapeOf({ k: 'disc', x: p.x, y: p.y, r: PEG_R });

/** Every solid piece of a level as { kind, shape }. Bars are clipped to the course (their part inside the wall). */
export function solidPieces(level) {
  const out = [];
  for (const b of level.bars) out.push({ kind: 'bar', piece: b, shape: boxShape(barInside(b, level)) });
  for (const d of level.diags) out.push({ kind: 'diag', piece: d, shape: diagShape(d) });
  for (const b of level.blocks) out.push({ kind: 'block', piece: b, shape: boxShape(b) });
  for (const p of level.pegs) out.push({ kind: 'peg', piece: p, shape: pegShape(p) });
  return out;
}

export function hazardPieces(level) {
  return [
    ...level.traps.map((t) => ({ kind: 'trap', piece: t, shape: boxShape(t) })),
    ...level.water.map((t) => ({ kind: 'water', piece: t, shape: boxShape(t) })),
  ];
}

/** The part of a bar inside the course (a bar is drawn from inside the wall). */
export function barInside(b, box) {
  const x = Math.max(b.x, box.x0);
  const x1 = Math.min(b.x + b.w, box.x1);
  return { x, y: b.y, w: x1 - x, h: b.h };
}

/** Points of a shape that bound it, for the inside test of a convex course: [x, y, r]. */
function extremes(shape) {
  const pts = [];
  for (const s of shape.segs) pts.push([s[0], s[1]], [s[2], s[3]]);
  return pts;
}

/** Clear distance from a shape to the course wall (negative if it pokes out). */
export function wallDist(planes, shape) {
  let d = Infinity;
  for (const [x, y] of extremes(shape)) d = Math.min(d, insideDist(planes, x, y));
  return d - shape.r;
}

const pointShape = (x, y, r) => shapeOf({ k: 'disc', x, y, r });

/** The straight shot line from tee to hole, as wide as the ball. */
export function lineShape(level) {
  return shapeOf({ k: 'seg', ax: level.tee.x, ay: level.tee.y, bx: level.hole.x, by: level.hole.y, r: BALL_R });
}

/** True when the ball could roll straight from the tee to the hole without touching a solid piece. */
export function straightLine(level) {
  const line = lineShape(level);
  return solidPieces(level).every((p) => shapeDist(line, p.shape) > 0);
}

/* ---------- one candidate ---------- */

function candidate(r, diff, H, top, bottom) {
  const T = GEN.table[diff];
  const box = courseBox(H, top, bottom);
  const { x0, y0, x1, y1 } = box;
  const h = y1 - y0;

  // Outline: 0 to 4 corners cut at 45 degrees.
  const nCuts = int(r, T.cuts[0], T.cuts[1]);
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const cuts = [0, 0, 0, 0];
  for (let i = 0; i < nCuts; i++) cuts[order[i]] = int(r, GEN.cutSize[0], GEN.cutSize[1]);
  const poly = coursePolygon(x0, y0, x1, y1, cuts);
  const planes = halfPlanes(poly);

  const holeR = T.holeR;
  const tee = { x: 67.5 - GEN.teeSpreadPx + int(r, 0, GEN.teeSpreadPx * 2), y: y1 - GEN.teeAbovePx };
  let hole = null;
  for (let i = 0; i < GEN.placeTries && !hole; i++) {
    const hx = int(r, x0 + holeR + 6, x1 - holeR - 6);
    const hy = int(r, y0 + GEN.holeTopPx, y0 + Math.floor(h * GEN.holeZone));
    if (insideDist(planes, hx, hy) >= holeR + 6 && insideDist(planes, tee.x, tee.y) >= BALL_R + 4) hole = { x: hx, y: hy, r: holeR };
  }
  if (!hole) return null;
  const level = {
    v: LEVEL_VERSION, diff, H, top, bottom, x0, y0, x1, y1, cuts, poly, tee, hole,
    bars: [], diags: [], blocks: [], pegs: [], traps: [], water: [],
  };
  const solids = [];
  const hazards = [];
  const teeShape = pointShape(tee.x, tee.y, BALL_R);
  const holeShape = pointShape(hole.x, hole.y, holeR);
  const clearOfEnds = (s) => shapeDist(s, teeShape) >= GEN.clearTeeHole && shapeDist(s, holeShape) >= GEN.clearTeeHole;
  const clearOfSolids = (s, gap) => solids.every((o) => shapeDist(s, o) >= gap);
  const clearOfHazards = (s, gap) => hazards.every((o) => shapeDist(s, o) >= gap);
  const solidOk = (s) => wallDist(planes, s) >= GEN.passageMin && clearOfSolids(s, GEN.passageMin)
    && clearOfHazards(s, GEN.hazardGap) && clearOfEnds(s);

  // Bars: straight walls from the left or right side, alternating, spread
  // down the course between the hole and the tee.
  const nBars = int(r, T.bars[0], T.bars[1]);
  const w = x1 - x0;
  const yTop = hole.y + holeR + GEN.clearTeeHole + 1;
  const yBot = tee.y - BALL_R - GEN.clearTeeHole - BAR_T - 1;
  let side = r() < 0.5 ? 0 : 1;
  for (let i = 0; i < nBars; i++) {
    const band0 = yTop + ((yBot - yTop) * i) / nBars;
    const band1 = yTop + ((yBot - yTop) * (i + 1)) / nBars;
    let placed = null;
    for (let k = 0; k < GEN.placeTries && !placed; k++) {
      const y = int(r, Math.ceil(band0), Math.max(Math.ceil(band0), Math.floor(band1) - BAR_T));
      const len = int(r, Math.ceil(w * GEN.barLenMin), w - GEN.barGapMin - 2);
      const bar = side === 0
        ? { x: x0 - WALL_T, y, w: len + WALL_T, h: BAR_T, side }
        : { x: x1 - len, y, w: len + WALL_T, h: BAR_T, side };
      // The side it grows from must be straight there (not a cut corner).
      const cTop = side === 0 ? cuts[0] : cuts[1];
      const cBot = side === 0 ? cuts[3] : cuts[2];
      if (y < y0 + cTop + 1 || y + BAR_T > y1 - cBot - 1) continue;
      const inside = boxShape(barInside(bar, box));
      // The gap at its free end, and its clearance from every other wall edge.
      let ok = true;
      for (const p of planes) {
        const attached = Math.abs(p.ax - p.bx) < 1e-9 && Math.abs(p.ax - (side === 0 ? x0 : x1)) < 1e-9;
        if (attached) continue;
        const edge = shapeOf({ k: 'seg', ax: p.ax, ay: p.ay, bx: p.bx, by: p.by, r: 0 });
        if (shapeDist(inside, edge) < GEN.barGapMin) { ok = false; break; }
      }
      if (!ok || !clearOfSolids(inside, GEN.passageMin) || !clearOfEnds(inside)) continue;
      placed = bar;
      solids.push(inside);
    }
    if (!placed) return null;
    level.bars.push(placed);
    side = 1 - side;
  }

  const putSolid = (list, n, make, shapeFn) => {
    for (let i = 0; i < n; i++) {
      let done = false;
      for (let k = 0; k < GEN.placeTries && !done; k++) {
        const p = make();
        const s = shapeFn(p);
        if (solidOk(s)) {
          list.push(p);
          solids.push(s);
          done = true;
        }
      }
      if (!done) return false;
    }
    return true;
  };

  const nDiags = int(r, T.diags[0], T.diags[1]);
  const okDiags = putSolid(level.diags, nDiags, () => {
    // L is the leg along each axis, in whole px; the length is L * sqrt 2, so
    // the leg runs from ceil(20 / sqrt 2) = 15 to floor(50 / sqrt 2) = 35
    // (21.2 to 49.5 px), always inside the table's 20 to 50.
    const L = int(r, Math.ceil(GEN.diagLen[0] / Math.SQRT2), Math.floor(GEN.diagLen[1] / Math.SQRT2));
    const s = r() < 0.5 ? 1 : -1;
    const cx = int(r, x0, x1);
    const cy = int(r, y0, y1);
    const ax = cx - Math.floor(L / 2);
    const ay = cy - s * Math.floor(L / 2);
    return { ax, ay, bx: ax + L, by: ay + s * L };
  }, diagShape);
  if (!okDiags) return null;

  const nBlocks = int(r, T.blocks[0], T.blocks[1]);
  const okBlocks = putSolid(level.blocks, nBlocks, () => {
    const bw = int(r, GEN.blockW[0], GEN.blockW[1]);
    const bh = int(r, GEN.blockH[0], GEN.blockH[1]);
    return { x: int(r, x0, x1 - bw), y: int(r, y0, y1 - bh), w: bw, h: bh, c: int(r, 0, 1) };
  }, boxShape);
  if (!okBlocks) return null;

  const nPegs = int(r, T.pegs[0], T.pegs[1]);
  if (!putSolid(level.pegs, nPegs, () => ({ x: int(r, x0, x1), y: int(r, y0, y1) }), pegShape)) return null;

  // Sand traps and water: floor areas; they keep clear of every other piece.
  const hazardOk = (s) => wallDist(planes, s) >= GEN.hazardGap && clearOfSolids(s, GEN.hazardGap)
    && clearOfHazards(s, GEN.hazardGap) && clearOfEnds(s);
  const putHazard = (list, n) => {
    for (let i = 0; i < n; i++) {
      let done = false;
      for (let k = 0; k < GEN.placeTries && !done; k++) {
        const tw = int(r, GEN.hazardSide[0], GEN.hazardSide[1]);
        const th = int(r, GEN.hazardSide[0], GEN.hazardSide[1]);
        const p = { x: int(r, x0, x1 - tw), y: int(r, y0, y1 - th), w: tw, h: th };
        const s = boxShape(p);
        if (hazardOk(s)) {
          list.push(p);
          hazards.push(s);
          done = true;
        }
      }
      if (!done) return false;
    }
    return true;
  };
  if (!putHazard(level.traps, int(r, T.traps[0], T.traps[1]))) return null;
  if (!putHazard(level.water, int(r, T.water[0], T.water[1]))) return null;
  return level;
}

/* ---------- the solver ---------- */

/**
 * Walking distance to the hole for the ball's centre, on a grid of
 * GEN.fieldCell px: free cells are where the ball fits (clear of every solid
 * and the wall, not in water). 8-neighbour Dijkstra from the hole.
 */
export function distanceField(world) {
  const L = world.level;
  const c = GEN.fieldCell;
  const cols = Math.ceil((L.x1 - L.x0) / c) + 1;
  const rows = Math.ceil((L.y1 - L.y0) / c) + 1;
  const free = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = L.x0 + i * c;
      const y = L.y0 + j * c;
      free[j * cols + i] = insideDist(world.planes, x, y) >= BALL_R && overlap(world, x, y) <= 0 && !inWater(world, x, y) ? 1 : 0;
    }
  }
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const hi = Math.round((L.hole.x - L.x0) / c);
  const hj = Math.round((L.hole.y - L.y0) / c);
  // A small binary heap of [d, index].
  const heap = [];
  const push = (d, k) => {
    heap.push([d, k]);
    let n = heap.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (heap[p][0] <= heap[n][0]) break;
      [heap[p], heap[n]] = [heap[n], heap[p]];
      n = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const end = heap.pop();
    if (heap.length) {
      heap[0] = end;
      let n = 0;
      for (;;) {
        const a = 2 * n + 1;
        const b = a + 1;
        let m = n;
        if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
        if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
        if (m === n) break;
        [heap[m], heap[n]] = [heap[n], heap[m]];
        n = m;
      }
    }
    return top;
  };
  const start = Math.max(0, Math.min(rows - 1, hj)) * cols + Math.max(0, Math.min(cols - 1, hi));
  dist[start] = 0;
  push(0, start);
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj, w] of steps) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (!free[nk]) continue;
      const nd = d + w * c;
      if (nd < dist[nk]) {
        dist[nk] = nd;
        push(nd, nk);
      }
    }
  }
  return {
    at(x, y) {
      const i0 = Math.round((x - L.x0) / c);
      const j0 = Math.round((y - L.y0) / c);
      let best = Infinity;
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        for (let i = i0 - 1; i <= i0 + 1; i++) {
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          const v = dist[j * cols + i] + Math.hypot(x - (L.x0 + i * c), y - (L.y0 + j * c));
          if (v < best) best = v;
        }
      }
      return best;
    },
  };
}

/**
 * The solver (PLAN §6c): from the tee it tries GEN.solverDirs directions at
 * GEN.solverPowers powers with sim.js, keeps the best GEN.solverBeam resting
 * spots and searches on up to maxStrokes. Returns the number of strokes that
 * first sank the ball, or null. A generator: it yields every GEN.sliceShots
 * shots so it can run in small slices.
 */
export function* solveSteps(world, play, maxStrokes) {
  const L = world.level;
  const field = distanceField(world);
  const dirs = [];
  for (let d = 0; d < GEN.solverDirs; d++) {
    const a = (2 * Math.PI * d) / GEN.solverDirs;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }
  const speeds = [];
  for (let p = 1; p <= GEN.solverPowers; p++) speeds.push((play.launchSpeed * p) / GEN.solverPowers);
  const ball = newBall(0, 0);
  const key = (x, y) => `${Math.round(x / 3)},${Math.round(y / 3)}`;
  const visited = new Set([key(L.tee.x, L.tee.y)]);
  let frontier = [{ x: L.tee.x, y: L.tee.y }];
  let shots = 0;
  for (let depth = 1; depth <= maxStrokes; depth++) {
    const found = new Map();
    for (const spot of frontier) {
      for (const [dx, dy] of dirs) {
        for (const v of speeds) {
          const r = playShot(world, spot.x, spot.y, dx, dy, v, play, ball);
          if (r.sunk) return depth;
          if (++shots % GEN.sliceShots === 0) yield shots;
          if (r.water || depth === maxStrokes) continue;
          const k = key(r.x, r.y);
          if (visited.has(k) || found.has(k)) continue;
          found.set(k, { x: r.x, y: r.y, d: field.at(r.x, r.y), k });
        }
      }
    }
    const next = [...found.values()].filter((s) => Number.isFinite(s.d));
    next.sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    frontier = next.slice(0, GEN.solverBeam);
    for (const s of frontier) visited.add(s.k);
    if (!frontier.length) return null;
  }
  return null;
}

/** Run a step generator to its end. */
export function finish(it) {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

export function solve(world, play, maxStrokes) {
  return finish(solveSteps(world, play, maxStrokes));
}

/* ---------- the fallback: an open level-1 course ---------- */

export function fallbackLevel(H, top = 0, bottom = 0, seed = 0) {
  // Open and always solvable in 1 or 2 strokes, but not the same course every
  // time: the seed places the hole along the top fifth's row and sizes and
  // places the one block in the middle band of the course, well clear of the
  // tee, the hole and the walls (the same seed and height give the same course).
  const r = rng((seed ^ 0x5F3759DF) >>> 0);
  const box = courseBox(H, top, bottom);
  const { x0, y0, x1, y1 } = box;
  const h = y1 - y0;
  const cuts = [0, 0, 0, 0];
  const holeR = GEN.table[1].holeR;
  const tee = { x: 67.5, y: y1 - GEN.teeAbovePx };
  const hole = { x: int(r, x0 + holeR + 6, x1 - holeR - 6), y: y0 + Math.max(GEN.holeTopPx, Math.floor(h * GEN.holeZone * 0.6)), r: holeR };
  const bw = int(r, GEN.blockW[0], GEN.blockW[1]);
  const bh = int(r, GEN.blockH[0], GEN.blockH[1]);
  const block = {
    x: int(r, x0 + GEN.passageMin, x1 - GEN.passageMin - bw),
    y: int(r, Math.round(y0 + h * 0.4), Math.round(y0 + h * 0.6) - bh),
    w: bw, h: bh, c: int(r, 0, 1),
  };
  return {
    v: LEVEL_VERSION, seed, diff: 1, H, top, bottom, ...box, cuts, poly: coursePolygon(x0, y0, x1, y1, cuts), tee, hole,
    bars: [], diags: [], blocks: [block], pegs: [], traps: [], water: [], strokes: null, rejects: GEN.rejectLimit, fallback: true,
  };
}

/* ---------- the generator ---------- */

/**
 * Build the level for a seed, a difficulty and a screen height. A generator
 * yielding while the solver runs; its value is the level. See generate().
 */
export function* generateSteps(seed, diff, H, play, top = 0, bottom = 0) {
  const T = GEN.table[diff];
  const r = rng(seed);
  for (let tries = 0; tries < GEN.rejectLimit; tries++) {
    const level = candidate(r, diff, H, top, bottom);
    if (!level) continue; // the pieces did not fit: rejected
    if (!T.straight && straightLine(level)) continue;
    const world = buildWorld(level);
    const strokes = yield* solveSteps(world, play, T.strokes[1]);
    if (strokes !== null && strokes >= T.strokes[0] && strokes <= T.strokes[1]) {
      level.seed = seed;
      level.strokes = strokes;
      level.rejects = tries;
      level.fallback = false;
      return level;
    }
  }
  return fallbackLevel(H, top, bottom, seed);
}

export function generate(seed, diff, H, play, top = 0, bottom = 0) {
  return finish(generateSteps(seed, diff, H, play, top, bottom));
}

/* ---------- as a module Web Worker ---------- */

// putt.js starts this file with new Worker(..., { type: 'module' }). A message
// { id, seed, diff, H, top, bottom, play } gets back { id, level }.
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    const m = e.data || {};
    const level = generate(m.seed, m.diff, m.H, m.play, m.top || 0, m.bottom || 0);
    self.postMessage({ id: m.id, level });
  };
}
