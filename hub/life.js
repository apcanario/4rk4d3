// The hub's small living things (a gull, a sailboat, a crab, bobbing cards, drifting clouds, sparkling
// sea). Only drawing and motion; tm is seconds on the hub's own clock and tm = 0 is the still picture
// (reduced motion, and every static check). Colours come from the tokens, so a theme switch redraws them.
// No text, no DOM, nothing stored.

import { COLORS, shade } from '../shared/tokens.js';

export const LIFE = Object.freeze({
  fps: 20, // the hub redraws this often while it is shown; the games' own loops are untouched
  bobPx: 0.8, // a card's rise and fall on the sea, px (rounds to 0 or 1)
  bobS: 5, // seconds for one bob
  cloudSpeed: [1.4, 1.9, 1.1, 1.6], // px per second, by cloud
  gullSpeed: [8, 5.5], // px per second
  boatSpeed: 2.5, // px per second along the horizon
  flapHz: 7, // wing frames per second
});

/** A value bouncing between lo and hi as u grows (a triangle wave). */
export function tri(u, lo, hi) {
  const r = hi - lo;
  if (r <= 0) return lo;
  const m = (((u - lo) % (2 * r)) + 2 * r) % (2 * r);
  return lo + (m < r ? m : 2 * r - m);
}

/** u wrapped into [lo, hi). */
export function wrap(u, lo, hi) {
  const r = hi - lo;
  return lo + ((((u - lo) % r) + r) % r);
}

/** How far card number i is lifted by the swell, in whole px (-1, 0 or 1), and 0 when still. */
export function bobOf(i, tm) {
  if (!tm) return 0;
  return Math.round(Math.sin((tm / LIFE.bobS) * Math.PI * 2 + i * 2.1) * LIFE.bobPx);
}

/** The clouds' places at tm: they drift left to right and come round again at the left. */
export function driftClouds(clouds, W, tm) {
  return clouds.map(([x, y], i) => [tm ? Math.round(wrap(x + tm * LIFE.cloudSpeed[i % LIFE.cloudSpeed.length], -24, W + 4)) : x, y]);
}

/** The sea's glints at tm: each one slips a pixel and fades in and out in its own time. */
export function shimmer(glints, tm) {
  if (!tm) return glints;
  return glints.filter((_, i) => Math.sin(tm * 1.3 + i * 1.9) > -0.35)
    .map(([x, y, len], i) => [x + Math.round(Math.sin(tm * 0.7 + i)), y, len]);
}

function sprite(ctx, rows, x, y, colour) {
  ctx.fillStyle = colour;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x + c, y + r, 1, 1);
  });
}

// A gull over the sea: wings up, level, down, level.
const GULL = [
  ['#.....#', '.#...#.', '..###..'],
  ['.......', '.#####.', '...#...'],
  ['...#...', '.#####.', '#.....#'],
  ['.......', '.#####.', '...#...'],
];
// A smaller bird for the Bricks card's top rim: two frames.
const BIRD = [['#...#', '.#.#.'], ['.#.#.', '#...#']];
// A sailboat on the horizon: sail above, hull on the line.
const BOAT = [
  '...#.....', '...##....', '...###...', '...####..', '...#.....', '.#######.', '..#####..',
];
// A crab on the sand; two steps.
const CRAB = [
  ['#.....#', '.#####.', '..###..', '.#.#.#.'],
  ['.#...#.', '.#####.', '..###..', '#.#.#.#'],
];

/**
 * The living things of the open scene: gulls over the sky, a sailboat on the
 * horizon. Drawn after the sky, sea and clouds, before the cards.
 */
export function drawSceneLife(ctx, W, horizon, top, tm) {
  if (!tm) return;
  const frame = Math.floor(tm * LIFE.flapHz) % GULL.length;
  const sky = horizon - top;
  if (sky >= 22) {
    LIFE.gullSpeed.forEach((v, i) => {
      const x = Math.round(wrap(tm * v + i * 70, -10, W + 6));
      const y = top + Math.round(sky * (i ? 0.42 : 0.2) + Math.sin(tm * 0.8 + i * 2) * 2);
      sprite(ctx, GULL[(frame + i * 2) % GULL.length], x, y, COLORS.ink);
    });
  }
  // The boat rides the horizon: hull rows on it, the sail above it, one px of swell.
  const bx = Math.round(wrap(tm * LIFE.boatSpeed + 20, -12, W + 12));
  const by = horizon - BOAT.length + 1 + Math.round(Math.sin(tm * 1.1) * 0.6 + 0.3);
  if (sky >= 12) {
    BOAT.forEach((row, r) => {
      const hull = r >= BOAT.length - 2;
      sprite(ctx, [row], bx, by + r, hull ? COLORS.keel : COLORS.coral);
    });
  }
}

/**
 * The living things inside a card's window (the clip is already set), at tm > 0.
 * Bricks: a bird along the top rim. Pool: a crab on the sand between the
 * pockets and the rack, where there is room for it.
 */
export function drawWindowLife(ctx, id, win, tm) {
  if (!tm) return;
  const { x, y, w, h } = win;
  if (id === 'bricks') {
    const bx = Math.round(wrap(tm * 6, x - 6, x + w + 2));
    sprite(ctx, BIRD[Math.floor(tm * 3) % 2], bx, y + 1, COLORS.ink);
  } else if (id === 'pool' && h >= 67) {
    const step = Math.floor(tm * 4) % 2;
    const cx = Math.round(tri(tm * 5 + w / 2, x + 5, x + w - 12));
    sprite(ctx, CRAB[step], cx, y + 17, COLORS.coral);
    sprite(ctx, [''.padEnd(2) + '#.#'], cx, y + 18, shade(COLORS.coral)); // eyes
  }
}
