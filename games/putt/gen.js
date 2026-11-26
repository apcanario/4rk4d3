// Putt (PLAN §6c, row U2 §6h): the level generator, with its solver. No DOM. It runs on
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

// Generator values: one block (PLAN §6c Files, §6h). Play values (launch
// speed, deceleration, bounce, capture speed) live in CONFIG at the top of
// putt.js and are passed in.
export const GEN = Object.freeze({
  teeSpreadPx: 20, // the tee sits within this of the centre, at the bottom of the course
  teeAbovePx: 9.5, // the tee's centre, this far above the course's bottom edge (the bottom safe inset)
  holeZone: 0.2, // the hole is in the top fifth of the course
  holeTopPx: 10, // ...at least this far below the course's top edge (room for the flag)
  // Row U2: pieces that grow out of the screen edges.
  stubLen: [20, 60], // a perpendicular stub from any edge: its length...
  stubThick: [8, 12], // ...and thickness, px
  cornerLeg: [20, 45], // a corner cut: a triangle across a corner, equal legs, px
  wedgeDepth: [15, 30], // a wedge from a side edge: its tip this far in, its base on the edge twice that
  edgeKinds: Object.freeze([['stub', 2], ['corner', 1], ['wedge', 1]]), // the odds of each kind of edge piece
  sideBias: 0.75, // a stub grows from the left or right edge this often (the top and bottom ones crowd the hole and the tee)
  gateGap: [15, 18], // level 3: two stubs face each other across the course, leaving this gap between their tips (two 60 px stubs leave 15)
  singleLen: [45, 60], // a shelf: a stub this long from the hole's side, just under the hole (level 2; level 3 with three edge pieces, with one gate)
  guardSpread: 14, // level 3: pegs are centred within this of the middle column, where every gate is open
  guardDrift: 6, // level 3: a guard block sits over a gate's gap, centred within this, passageMin plus up to this clear of it (one gate: above and below)
  guardW: 16, // a guard block is at least this wide (blockW's top end the most)
  blockW: [8, 24],
  blockH: [8, 12],
  hazardSide: [16, 30], // sand traps and water, px a side
  passageMin: 14, // a gap between two solids, or a solid and an edge, is closed (0) or at least this
  clearTeeHole: 12, // nothing within this of the tee or the hole (measured from the ball's and the hole's edge)
  hazardGap: 3, // traps and water keep this clear of every other piece and the edges
  placeTries: 60, // random tries to place one piece before the candidate is given up
  rejectLimit: 30, // rejected candidates before the open level-1 fallback
  solverDirs: 96, // the solver tries this many directions...
  solverPowers: 5, // ...at this many powers (evenly up to the full launch speed)...
  solverBeam: 12, // ...keeps the best dozen resting spots after each stroke...
  fieldCell: 2, // ...ranked by the walking distance to the hole on a grid of this size
  sliceShots: 24, // the solver yields after this many shots (for slicing off a worker)
  // The table of PLAN §6c with row U2's edge pieces (§6h): [min, max] counts,
  // drawn at random inside the range. The outline's cut corners, the bars and
  // the free-standing diagonals of §6c are gone with the frame: corner cuts,
  // stubs and wedges (edges) take their place.
  table: Object.freeze({
    1: Object.freeze({ edges: [1, 2], blocks: [1, 2], pegs: [0, 0], traps: [0, 0], water: [0, 0], holeR: 5, straight: true, strokes: [1, 2] }),
    2: Object.freeze({ edges: [2, 4], blocks: [1, 3], pegs: [0, 2], traps: [0, 1], water: [0, 1], holeR: 5, straight: false, strokes: [2, 3] }),
    3: Object.freeze({ edges: [3, 5], blocks: [2, 4], pegs: [1, 3], traps: [0, 1], water: [1, 1], holeR: 4, straight: false, strokes: [3, 4] }),
  }),
});

import {
  BALL_R, PEG_R, coursePolygon, halfPlanes, insideDist, shapeOf, shapeDist,
  buildWorld, playShot, newBall, overlap, inWater,
} from './sim.js';

export const LEVEL_VERSION = 2;

/**
 * Row U2: how a level is drawn, by its place in the opening: sand, sea, sand,
 * sea... from a sand start (n counts from 1). Drawing only: sim.js never sees it.
 */
export const LOOKS = Object.freeze(['sand', 'sea']);
export function lookOf(n) {
  return LOOKS[(Math.max(1, n) - 1) % 2];
}

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

/**
 * The course box for a screen height and its insets (row U2): the whole
 * screen less the safe-area insets. Its four sides are the walls: the top
 * below a display cutout, the bottom above the bottom inset.
 */
export function courseBox(H, top = 0, bottom = 0) {
  return { x0: 0, x1: 135, y0: top, y1: H - bottom };
}

/* ---------- pieces as shapes ---------- */

export const boxShape = (b) => shapeOf({ k: 'box', x: b.x, y: b.y, w: b.w, h: b.h });
export const polyShape = (e) => shapeOf({ k: 'poly', pts: e.pts });
export const pegShape = (p) => shapeOf({ k: 'disc', x: p.x, y: p.y, r: PEG_R });
export const edgeShape = (e) => (e.k === 'stub' ? boxShape(e) : polyShape(e));

/** Every solid piece of a level as { kind, piece, shape }: edge pieces (stub, corner, wedge), blocks, pegs. */
export function solidPieces(level) {
  const out = [];
  for (const e of level.edges) out.push({ kind: e.k, piece: e, shape: edgeShape(e) });
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

/** Clear distance from a shape to each course edge (negative where it pokes out): one value per half-plane. */
export function edgeDists(planes, shape) {
  return planes.map((p) => {
    let d = Infinity;
    for (const s of shape.segs) d = Math.min(d, p.nx * s[0] + p.ny * s[1] - p.c, p.nx * s[2] + p.ny * s[3] - p.c);
    return d - shape.r;
  });
}

/** Clear distance from a shape to the nearest course edge (negative if it pokes out). */
export function wallDist(planes, shape) {
  return Math.min(...edgeDists(planes, shape));
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

/* ---------- edge pieces (row U2) ---------- */

/**
 * One random edge piece for a course box, or null if the kind has no room:
 * a stub { k: 'stub', side, x, y, w, h } (a box flush with its edge), a corner
 * cut { k: 'corner', corner, leg, pts } (0 top-left, 1 top-right, 2
 * bottom-right, 3 bottom-left) or a wedge { k: 'wedge', side, depth, pts }.
 * side is 'l', 'r', 't' or 'b'. Triangles have their points on whole px, so
 * their slanted sides are true 45 degree lines.
 */
function edgePiece(r, box, used) {
  const { x0, y0, x1, y1 } = box;
  const m = GEN.passageMin;
  let total = 0;
  for (const [, w] of GEN.edgeKinds) total += w;
  let pick = r() * total;
  let kind = GEN.edgeKinds[0][0];
  for (const [k, w] of GEN.edgeKinds) {
    if (pick < w) { kind = k; break; }
    pick -= w;
  }
  if (kind === 'corner') {
    const free = [0, 1, 2, 3].filter((c) => !used.has(c));
    if (!free.length) return null;
    const corner = free[int(r, 0, free.length - 1)];
    const L = int(r, GEN.cornerLeg[0], GEN.cornerLeg[1]);
    const cx = corner === 0 || corner === 3 ? x0 : x1;
    const cy = corner === 0 || corner === 1 ? y0 : y1;
    const sx = cx === x0 ? 1 : -1;
    const sy = cy === y0 ? 1 : -1;
    return { k: 'corner', corner, leg: L, pts: [[cx, cy], [cx + sx * L, cy], [cx, cy + sy * L]] };
  }
  if (kind === 'wedge') {
    const side = r() < 0.5 ? 'l' : 'r';
    const D = int(r, GEN.wedgeDepth[0], GEN.wedgeDepth[1]);
    const lo = Math.ceil(y0 + m + D);
    const hi = Math.floor(y1 - m - D);
    if (hi < lo) return null;
    const cy = int(r, lo, hi);
    const ex = side === 'l' ? x0 : x1;
    const tx = side === 'l' ? x0 + D : x1 - D;
    return { k: 'wedge', side, depth: D, pts: [[ex, cy - D], [tx, cy], [ex, cy + D]] };
  }
  const side = r() < GEN.sideBias ? (r() < 0.5 ? 'l' : 'r') : (r() < 0.5 ? 't' : 'b');
  const len = int(r, GEN.stubLen[0], GEN.stubLen[1]);
  const th = int(r, GEN.stubThick[0], GEN.stubThick[1]);
  if (side === 'l' || side === 'r') {
    const lo = Math.ceil(y0 + m);
    const hi = Math.floor(y1 - m - th);
    if (hi < lo) return null;
    const y = int(r, lo, hi);
    return { k: 'stub', side, x: side === 'l' ? x0 : x1 - len, y, w: len, h: th };
  }
  const lo = Math.ceil(x0 + m);
  const hi = Math.floor(x1 - m - th);
  const x = int(r, lo, hi);
  return { k: 'stub', side, x, y: side === 't' ? y0 : y1 - len, w: th, h: len };
}

/* ---------- one candidate ---------- */

export function candidate(r, diff, H, top, bottom) {
  const T = GEN.table[diff];
  const box = courseBox(H, top, bottom);
  const { x0, y0, x1, y1 } = box;
  const h = y1 - y0;
  const poly = coursePolygon(x0, y0, x1, y1);
  const planes = halfPlanes(poly);

  const holeR = T.holeR;
  const tee = { x: 67.5 - GEN.teeSpreadPx + int(r, 0, GEN.teeSpreadPx * 2), y: y1 - GEN.teeAbovePx };
  const hx = int(r, x0 + holeR + 6, x1 - holeR - 6);
  const hy = int(r, y0 + GEN.holeTopPx, y0 + Math.floor(h * GEN.holeZone));
  const hole = { x: hx, y: hy, r: holeR };
  const level = {
    v: LEVEL_VERSION, diff, H, top, bottom, x0, y0, x1, y1, poly, tee, hole,
    edges: [], blocks: [], pegs: [], traps: [], water: [],
  };
  const solids = [];
  const hazards = [];
  const teeShape = pointShape(tee.x, tee.y, BALL_R);
  const holeShape = pointShape(hole.x, hole.y, holeR);
  const clearOfEnds = (s) => shapeDist(s, teeShape) >= GEN.clearTeeHole && shapeDist(s, holeShape) >= GEN.clearTeeHole;
  const clearOfSolids = (s, gap) => solids.every((o) => shapeDist(s, o) >= gap);
  const clearOfHazards = (s, gap) => hazards.every((o) => shapeDist(s, o) >= gap);
  // The gap rule (§6h): to an edge a piece is joined (0) or at least passageMin away.
  const edgesOk = (s) => edgeDists(planes, s).every((d) => Math.abs(d) < 1e-9 || d >= GEN.passageMin);
  const freeOk = (s) => wallDist(planes, s) >= GEN.passageMin && clearOfSolids(s, GEN.passageMin)
    && clearOfHazards(s, GEN.hazardGap) && clearOfEnds(s);

  // Edge pieces: stubs, corner cuts and wedges grow out of the screen edges.
  const nEdges = int(r, T.edges[0], T.edges[1]);
  const corners = new Set();
  // Levels 2 and 3 first set barriers in the band between the hole and the
  // tee, one per stretch of it, so the hole takes the strokes of its range
  // (the stroke counts of §6c with the weaker edge pieces): a shelf (a long
  // stub from the hole's side just under the hole, GEN.singleLen) and gates (a
  // left and a right stub at one height, tip to tip, GEN.gateGap apart).
  // Level 2: a shelf. Level 3: two gates, or with three edge pieces a shelf
  // and a gate. The rest of the edge pieces are drawn at random.
  const plan = diff === 1 ? [] : diff === 2 ? ['single'] : nEdges >= 4 ? ['gate', 'gate'] : ['single', 'gate'];
  const gates = []; // { x, g, y, th }: each gate's gap
  let used = 0;
  const gTop = hole.y + holeR + GEN.clearTeeHole + 1;
  const gBot = tee.y - BALL_R - GEN.clearTeeHole - 1;
  for (let i = 0; i < plan.length; i++) {
    const band0 = gTop + ((gBot - gTop) * i) / plan.length;
    const band1 = gTop + ((gBot - gTop) * (i + 1)) / plan.length;
    let done = false;
    for (let k = 0; k < GEN.placeTries && !done; k++) {
      const th = [int(r, GEN.stubThick[0], GEN.stubThick[1]), int(r, GEN.stubThick[0], GEN.stubThick[1])];
      let y = int(r, Math.ceil(band0), Math.max(Math.ceil(band0), Math.floor(band1) - Math.max(th[0], th[1])));
      if (plan[i] === 'single') y = int(r, Math.ceil(gTop), Math.ceil(gTop) + GEN.guardDrift); // a shelf just under the hole
      let pair;
      let gap = null;
      if (plan[i] === 'gate') {
        const g = int(r, GEN.gateGap[0], GEN.gateGap[1]);
        const reach = x1 - x0 - g;
        const a = int(r, Math.max(GEN.stubLen[0], reach - GEN.stubLen[1]), Math.min(GEN.stubLen[1], reach - GEN.stubLen[0]));
        pair = [
          { k: 'stub', side: 'l', x: x0, y, w: a, h: th[0] },
          { k: 'stub', side: 'r', x: x1 - (reach - a), y, w: reach - a, h: th[1] },
        ];
        gap = { x: x0 + a, g, y, th: Math.max(th[0], th[1]) };
      } else {
        const len = int(r, GEN.singleLen[0], GEN.singleLen[1]);
        pair = [hole.x < (x0 + x1) / 2 ? { k: 'stub', side: 'l', x: x0, y, w: len, h: th[0] } : { k: 'stub', side: 'r', x: x1 - len, y, w: len, h: th[0] }];
      }
      const shapes = pair.map(edgeShape);
      if (!shapes.every((s) => edgesOk(s) && clearOfSolids(s, GEN.passageMin) && clearOfEnds(s))) continue;
      if (shapes.length === 2 && shapeDist(shapes[0], shapes[1]) < GEN.passageMin) continue;
      pair.forEach((e, j) => {
        level.edges.push(e);
        solids.push(shapes[j]);
      });
      used += pair.length;
      if (gap) gates.push(gap);
      done = true;
    }
    if (!done) return null;
  }
  const nGates = gates.length;
  for (let i = used; i < nEdges; i++) {
    let done = false;
    for (let k = 0; k < GEN.placeTries && !done; k++) {
      const e = edgePiece(r, box, corners);
      if (!e) continue;
      const s = edgeShape(e);
      if (!edgesOk(s) || !clearOfSolids(s, GEN.passageMin) || !clearOfEnds(s)) continue;
      level.edges.push(e);
      solids.push(s);
      if (e.k === 'corner') corners.add(e.corner);
      done = true;
    }
    if (!done) return null;
  }

  const putSolid = (list, n, make, shapeFn) => {
    for (let i = 0; i < n; i++) {
      let done = false;
      for (let k = 0; k < GEN.placeTries && !done; k++) {
        const p = make();
        const s = shapeFn(p);
        if (freeOk(s)) {
          list.push(p);
          solids.push(s);
          done = true;
        }
      }
      if (!done) return false;
    }
    return true;
  };

  const nBlocks = int(r, T.blocks[0], T.blocks[1]);
  const okBlocks = putSolid(level.blocks, nBlocks, () => {
    const j = level.blocks.length;
    const gt = j < (nGates === 1 ? 2 : nGates) ? gates[j % nGates] : null; // one gate: guarded above and below
    const bw = int(r, gt ? GEN.guardW : GEN.blockW[0], GEN.blockW[1]);
    const bh = int(r, GEN.blockH[0], GEN.blockH[1]);
    if (gt) { // a guard over this gate's gap: above it on the first gate, below it on the second
      const cx = Math.round(gt.x + gt.g / 2 - bw / 2) + int(r, -GEN.guardDrift, GEN.guardDrift);
      const off = GEN.passageMin + int(r, 0, GEN.guardDrift);
      const y = j % 2 === 0 ? gt.y - off - bh : gt.y + gt.th + off;
      return { x: cx, y, w: bw, h: bh, c: int(r, 0, 1) };
    }
    return { x: int(r, x0, x1 - bw), y: int(r, y0, y1 - bh), w: bw, h: bh, c: int(r, 0, 1) };
  }, boxShape);
  if (!okBlocks) return null;

  const nPegs = int(r, T.pegs[0], T.pegs[1]);
  const midX = Math.round((x0 + x1) / 2);
  const pegX = () => (nGates ? int(r, midX - GEN.guardSpread, midX + GEN.guardSpread) : int(r, x0, x1));
  if (!putSolid(level.pegs, nPegs, () => ({ x: pegX(), y: int(r, y0, y1) }), pegShape)) return null;

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
  // tee, the hole and the edges (the same seed and height give the same course).
  // Row U2: one corner cut, in a top corner on the far side from the hole.
  const r = rng((seed ^ 0x5F3759DF) >>> 0);
  const box = courseBox(H, top, bottom);
  const { x0, y0, x1, y1 } = box;
  const h = y1 - y0;
  const holeR = GEN.table[1].holeR;
  const tee = { x: 67.5, y: y1 - GEN.teeAbovePx };
  const hole = { x: int(r, x0 + 40, x1 - 40), y: y0 + Math.max(GEN.holeTopPx, Math.floor(h * GEN.holeZone * 0.6)), r: holeR };
  const bw = int(r, GEN.blockW[0], GEN.blockW[1]);
  const bh = int(r, GEN.blockH[0], GEN.blockH[1]);
  const block = {
    x: int(r, x0 + GEN.passageMin, x1 - GEN.passageMin - bw),
    y: int(r, Math.round(y0 + h * 0.4), Math.round(y0 + h * 0.6) - bh),
    w: bw, h: bh, c: int(r, 0, 1),
  };
  const L = GEN.cornerLeg[0];
  const corner = hole.x < 67.5 ? 1 : 0;
  const cx = corner === 0 ? x0 : x1;
  const sx = corner === 0 ? 1 : -1;
  const cut = { k: 'corner', corner, leg: L, pts: [[cx, y0], [cx + sx * L, y0], [cx, y0 + L]] };
  return {
    v: LEVEL_VERSION, seed, diff: 1, H, top, bottom, ...box, poly: coursePolygon(x0, y0, x1, y1), tee, hole,
    edges: [cut], blocks: [block], pegs: [], traps: [], water: [], strokes: null, rejects: GEN.rejectLimit, fallback: true,
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
