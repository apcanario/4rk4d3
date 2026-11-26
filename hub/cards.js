// RLX hub cards (row H2, PLAN §5a; row A1, §6i): five big framed cards in a grid of
// 2 columns by 3 rows (the sixth cell open), each a small window onto its game, drawn in the game's own scene colours at the
// current step of the exit ramp. No text of any kind. No DOM: the layout and
// the parts list also serve the headless checks (tests/check.py), which
// measure every piece against the window colours behind it.

import { LOGICAL_WIDTH, COLORS, BRICK_ROWS, mix, shade, highlight, edge, line, scenePalette, puttGround } from '../shared/tokens.js';
import { pixelBody, steppedRect, ditherRow, sunRuns, SUN_RADIUS } from '../shared/pixel.js';
import { SESSION } from '../shared/session.js';
import { LOOK, spriteGrid, turnUp } from '../games/catch/sim.js';
import { CRAB_MASK, RING_MASK, PUCK_MASK, tableColours, pieceColours } from '../games/glide/sim.js';
import * as TOK from '../shared/tokens.js';

/** The cards, in grid order: left to right, top to bottom (the sixth cell, bottom right, is open). Each opens its
 * game's index.html by name: the Android app's local server answers a folder URL with the
 * hub itself (PLAN §6f). */
export const CARDS = Object.freeze([
  Object.freeze({ id: 'bricks', name: 'Bricks', href: 'games/bricks/index.html' }),
  Object.freeze({ id: 'catch', name: 'Catch', href: 'games/catch/index.html' }),
  Object.freeze({ id: 'putt', name: 'Putt', href: 'games/putt/index.html' }),
  Object.freeze({ id: 'stack', name: 'Stack', href: 'games/stack/index.html' }),
  Object.freeze({ id: 'glide', name: 'Glide', href: 'games/glide/index.html' }),
]);

// Layout values (PLAN §5a; row A1: 2 columns by 3 rows).
export const GRID = Object.freeze({
  cols: 2,
  rows: 3, // five cards; the sixth cell is left open (no blank card)
  gap: 5, // between the cards, across and down
  side: 4, // least margin at the screen's sides
  bottomMin: 8, // least margin above the bottom safe inset ...
  bottomFrac: 0.05, // ... or this fraction of the screen height, whichever is larger
  seaClear: 8, // the horizon is this far above the grid: the cards sit on the sea, clear of the sun
  skyFloor: 0, // row A1: where three rows of full-size cards do not fit, the sky gives way first, down to this; only then do the cards shrink
  maxRatio: 1.3, // a card is never taller than this many times its width (the approved mockup is about 1.25)
  sunMax: 40, // the hub's sun radius grows with its sky up to this
  sunEdge: 4, // the whole sun stays at least this far from the right edge
  sunTop: 8, // the whole sun stays at least this far below the top inset; a sky too short for a sun this far down shrinks it...
  sunMin: 6, // ...and one that would leave a sun under this radius has none
  minCard: 40, // every card is at least this big in each direction (the tap target)
  frame: 4, // frame thickness at the top and sides; the bottom is one more (the drop shade)
});

/**
 * The hub's composition for a logical screen W x H with safe insets (logical
 * px) and the side band (logical px) where a touch is ignored. The grid, 2
 * columns by 3 rows, sits low, in the thumb's reach, a margin above the
 * bottom; the cards are as wide as the margins allow and maxRatio x their
 * width tall. Where three rows of that size do not fit below the top inset,
 * the sky gives way first (down to skyFloor); only then do the cards shrink,
 * never under minCard. The horizon is seaClear above the grid, so the cards
 * sit on the sea and the sky above them, with the sun on the horizon, is the
 * picture. Returns { cards: {id: rect}, open: rect (the sixth cell), x0, y0,
 * cw, ch, gap, rows, top, bottom, side, horizon, seaHeight }.
 */
export function gridLayout(W, H, safe, edgeBand = 0) {
  const side = Math.max(GRID.side, edgeBand, safe.left + 2, safe.right + 2);
  const cw = Math.floor((W - side * 2 - GRID.gap * (GRID.cols - 1)) / GRID.cols);
  const x0 = Math.floor((W - (cw * GRID.cols + GRID.gap * (GRID.cols - 1))) / 2);
  const bottom = H - safe.bottom - Math.max(GRID.bottomMin, Math.round(H * GRID.bottomFrac));
  const top = safe.top + GRID.skyFloor + GRID.seaClear; // the highest the grid may start, once the sky has given way
  const fit = Math.floor((bottom - top - GRID.gap * (GRID.rows - 1)) / GRID.rows);
  const ch = Math.max(GRID.minCard, Math.min(fit, Math.floor(cw * GRID.maxRatio)));
  const y0 = bottom - (ch * GRID.rows + GRID.gap * (GRID.rows - 1));
  const horizon = y0 - GRID.seaClear;
  const cell = (i) => ({ x: x0 + (i % GRID.cols) * (cw + GRID.gap), y: y0 + Math.floor(i / GRID.cols) * (ch + GRID.gap), w: cw, h: ch });
  const cards = {};
  CARDS.forEach((c, i) => { cards[c.id] = cell(i); });
  return { cards, open: cell(CARDS.length), x0, y0, cw, ch, gap: GRID.gap, rows: GRID.rows, top, bottom, side, horizon, seaHeight: H - horizon };
}

/** The hub's sun radius for a sky of this height (below the top inset): 0 if there is no room for one. */
export function sunRadiusFor(sky) {
  const r = Math.min(Math.max(SUN_RADIUS, Math.min(GRID.sunMax, Math.round(sky * 0.3))), sky - GRID.sunTop);
  return r >= GRID.sunMin ? r : 0;
}

// A cloud's size (shared/pixel.js CLOUDS, by its index), for keeping the hub's clouds inside its sky.
const CLOUD_BOX = [[20, 6], [16, 5], [14, 5]];

/**
 * The hub's scene options for drawScene (shared/pixel.js): the raised horizon,
 * the clouds and the stars in the sky above it, clear of the sun. Row A1: the
 * sky may be short (it gives way to three rows of cards); a cloud or a star
 * that would not fit in it whole is left out, and a sky too short for a sun has none.
 */
export function hubScene(grid, safe) {
  const sky = grid.horizon - safe.top;
  const at = (f) => safe.top + Math.round(sky * f);
  const H = grid.horizon + grid.seaHeight;
  // The sun grows with the sky: 0.3 of it, from the games' radius up to GRID.sunMax, never closer than sunTop to the top inset.
  const sunRadius = sunRadiusFor(sky);
  // x 96 as in the games, moved left when a big sun would reach within GRID.sunEdge of the right edge.
  const sunX = Math.min(96, LOGICAL_WIDTH - sunRadius - GRID.sunEdge);
  const want = [[92, at(0.1)], [8, at(0.42)], [44, at(0.72)]];
  if (H > 300) want.push([58, at(0.24)]); // a tall sky gets a fourth cloud, clear of the sun
  // Keep a cloud only where it fits whole in the sky and clear of the sun; drawScene shapes clouds by their place in the list.
  const clouds = [];
  for (const c of want) {
    const [cw, chh] = CLOUD_BOX[clouds.length % CLOUD_BOX.length];
    const inSky = c[1] >= safe.top + 1 && c[1] + chh <= grid.horizon - 2;
    // clear of the sun's disc: the nearest point of the cloud more than a pixel outside it
    const nx = Math.max(c[0], Math.min(sunX, c[0] + cw));
    const ny = Math.max(c[1], Math.min(grid.horizon, c[1] + chh));
    const clearSun = !sunRadius || Math.hypot(nx - sunX, ny - grid.horizon) > sunRadius + 1;
    if (inSky && clearSun) clouds.push(c);
  }
  const stars = [safe.top + 2, grid.horizon - sunRadius - 4];
  return {
    seaHeight: grid.seaHeight,
    sunRadius,
    sunX,
    glintDepth: GRID.seaClear, // the scene's own glints only in the open strip between the horizon and the cards
    glints: seaGlints(grid),
    clouds,
    stars,
    starCount: stars[1] - stars[0] >= 2 ? undefined : 0, // no room for a star: none (a 3 x 3 cross needs 2 rows of sky round it)
  };
}

/**
 * A few glint dashes on the sea round the cards, so the sea behind them is not
 * flat: one in each side margin and two or three below the grid. [x, y, length]
 * in logical px, every one at least 2 px clear of a card (the frame's 1 px ring
 * stays bare sea).
 */
export function seaGlints(grid) {
  const out = [];
  const { x0, y0, cw, ch, gap, bottom } = grid;
  const H = grid.horizon + grid.seaHeight;
  const right = x0 + cw * 2 + gap; // first column right of the grid
  const m = Math.min(x0, LOGICAL_WIDTH - right); // the narrower side margin
  if (m >= 7) {
    const len = Math.min(3, m - 4);
    out.push([x0 - 2 - len, y0 + Math.round(ch * 0.35), len]);
    out.push([right + 2, y0 + ch + gap + Math.round(ch * 0.6), len]);
  }
  const below = H - bottom; // rows of sea under the grid
  if (below >= 6) {
    out.push([x0 + 6, bottom + 3, 4]);
    out.push([x0 + cw + 10, bottom + 3, 6]);
  }
  if (below >= 10) out.push([x0 + cw * 2 - 8, bottom + 7, 3]);
  // Row A1: the open sixth cell is sea too, with two dashes of its own.
  const o = grid.open;
  if (o) {
    out.push([o.x + 6, o.y + Math.round(o.h * 0.3), 5]);
    out.push([o.x + o.w - 16, o.y + Math.round(o.h * 0.62), 6]);
  }
  return out;
}

/** The inner window of a card rect (the game's scene shows through it). */
export function windowOf(r) {
  const f = GRID.frame;
  return { x: r.x + f, y: r.y + f, w: r.w - f * 2, h: r.h - f * 2 - 1 };
}

// The frame's colours, from the active token set (row D1: read when drawn, so a theme switch redraws them).
// FRAME_EDGE goes round the window. The card's outer 1 px edge: the cards sit on the sea, so, like the
// hull's rows below the horizon in Catch (B4 review), the edge is the keel colour, which clears every sea step.
const frameOf = () => ({ FRAME: COLORS.coral, FRAME_EDGE: edge(COLORS.coral), FRAME_RIM: COLORS.keel });

/* ---------- the parts of each window ---------- */

// A part is a background region ({ bg: true }) or a piece. Pieces carry the
// B4 rule they are measured by ('cr' or 'de'), their fill and 1 px edge (or
// null), their box, every colour they may draw, and how to draw themselves.
// A piece with exempt names the PLAN line that leaves it outside the standard.

function bandsOf(x, y, w, h, colours, name) {
  const out = [];
  const n = colours.length;
  for (let i = 0; i < n; i++) {
    const y0 = y + Math.round((i * h) / n);
    const y1 = y + Math.round(((i + 1) * h) / n);
    if (y1 > y0) out.push({ bg: true, what: `${name} band ${i + 1}`, colour: colours[i], prev: i > 0 ? colours[i - 1] : null, x, y: y0, w, h: y1 - y0, i });
  }
  return out;
}

function seaBands(x, y, w, h, pal) {
  // The game's sea split (13, 14, the rest of 42), scaled to the window's sea.
  const a = Math.round((h * 13) / 42);
  const b = Math.round((h * 27) / 42);
  const hs = [a, b - a, h - b];
  const out = [];
  let cy = y;
  hs.forEach((hh, i) => {
    if (hh > 0) out.push({ bg: true, what: `sea band ${i + 1}`, colour: pal.sea[i], prev: i > 0 ? pal.sea[i - 1] : null, x, y: cy, w, h: hh, i });
    cy += hh;
  });
  return out;
}

// Glints on a window's sea: [x fraction, row fraction of the sea, length].
const SEA_GLINTS = [[0.1, 0.25, 5], [0.55, 0.15, 9], [0.62, 0.45, 6], [0.2, 0.62, 4], [0.78, 0.75, 5], [0.4, 0.88, 4]];

function glints(x, y, w, h, colour) {
  const out = [];
  for (const [fx, fy, len] of SEA_GLINTS) {
    const gy = y + Math.round(fy * h);
    if (gy >= y + h - 1 || gy <= y) continue;
    const gx = x + Math.round(fx * w);
    out.push({ x: gx, y: gy, w: Math.min(len, x + w - gx), h: 1 });
  }
  return { bg: true, measure: false, what: 'sea glint', colour, x, y, w, h, dashes: out };
}

function sprite(grid, body) {
  const keys = { '#': body, h: highlight(body), s: shade(body), o: edge(body), c: COLORS.sun };
  const used = new Set();
  grid.forEach((row) => { for (const k of row) if (k !== '.') used.add(keys[k]); });
  return { w: grid[0].length, h: grid.length, colours: [...used], draw(ctx, x, y) {
    grid.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === '.') continue;
        ctx.fillStyle = keys[row[c]];
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    });
  } };
}

const bodyColours = (c, rim) => [c, shade(c), highlight(c), ...(rim ? [rim] : [])];

function body(what, rule, x, y, w, h, colour, steps, rim, fillOnly = false) {
  return {
    what, rule, fill: colour, edge: fillOnly ? null : (rim || null), x, y, w, h,
    colours: bodyColours(colour, rim),
    draw: (ctx) => pixelBody(ctx, x, y, w, h, colour, steps, rim),
  };
}

const itemColour = (name) => (name.startsWith('row') ? BRICK_ROWS[Number(name.slice(3))] : COLORS[name]);

function bricksParts(win, pal) {
  const { x, y, w, h } = win;
  const parts = bandsOf(x, y, w, h, pal.sky, 'sky');
  const gap = 2;
  const bw = Math.min(15, Math.floor((w - 4 - gap * 2) / 3));
  const bx = x + Math.floor((w - (bw * 3 + gap * 2)) / 2);
  // Five rows of bricks, or fewer on a short window, so the ball and its trail clear the paddle.
  const rows = [0, 2, 4, 6, 7];
  while (rows.length > 3 && h - 8 - (4 + rows.length * 8) < 19) rows.splice(rows.length - 2, 1);
  const missing = ['3,1', '4,1'];
  rows.forEach((row, r) => {
    for (let c = 0; c < 3; c++) {
      if (missing.includes(`${r},${c}`)) continue;
      parts.push(body(`brick row ${row + 1}`, 'de', bx + c * (bw + gap), y + 4 + r * 8, bw, 7, BRICK_ROWS[row], 1, null, true));
    }
  });
  const fieldBottom = y + 4 + rows.length * 8;
  const pw = Math.min(30, w - 20);
  const py = y + h - 8;
  parts.push(body('paddle', 'cr', x + Math.floor((w - pw) / 2) - 3, py, pw, 6, COLORS.coral, 2, edge(COLORS.coral)));
  // The ball, rising up and right from the paddle, its trail behind it (solid, checker, single pixel, as in the game).
  const ballX = x + Math.floor(w / 2) - 2;
  // The trail ends at least 2 px above the paddle on every window height.
  const ballY = Math.max(fieldBottom + 2, Math.min(py - 17, fieldBottom + Math.max(4, Math.round((py - fieldBottom) * 0.3))));
  const trail = highlight(COLORS.blue);
  const tr = [1, 2, 3].map((k) => ({ x: ballX + 2 - 3 * k - 1, y: ballY + 2 + 4 * k - 1 }));
  parts.push({
    what: 'ball trail', rule: 'de', fill: trail, edge: null, exempt: 'PLAN §3: the ball trail is outside the B4 standard (X16)',
    x: tr[2].x, y: tr[0].y, w: 9, h: 11, colours: [trail],
    draw(ctx) {
      ctx.fillStyle = trail;
      ctx.fillRect(tr[0].x, tr[0].y, 3, 3);
      for (let k = 0; k < 9; k += 2) ctx.fillRect(tr[1].x + (k % 3), tr[1].y + Math.floor(k / 3), 1, 1);
      ctx.fillRect(tr[2].x + 1, tr[2].y + 1, 1, 1);
    },
  });
  parts.push(body('ball', 'cr', ballX, ballY, 5, 5, COLORS.blue, 1, null, true));
  return parts;
}

function sunPart(cx, horizon, r, t, top) {
  const sink = Math.round(t * r);
  const rows = sunRuns(cx, horizon, r, sink, top); // the sun, or the crescent moon in dark (shared/pixel.js)
  if (!rows.length) return null;
  const ys = rows.map((q) => q[1]);
  const y0 = Math.min(...ys);
  return {
    bg: true, what: 'sun', colour: COLORS.sun, x: cx - r, y: y0, w: r * 2, h: horizon - y0,
    draw(ctx) { ctx.fillStyle = COLORS.sun; for (const [a, b, c] of rows) ctx.fillRect(a, b, c, 1); },
  };
}

function catchParts(win, pal, t) {
  const { x, y, w, h } = win;
  const seaH = Math.max(14, Math.round(h * 0.2));
  const hz = y + h - seaH;
  const parts = bandsOf(x, y, w, hz - y, pal.sky, 'sky');
  const sun = sunPart(x + Math.round(w * 0.72), hz, 12, t, y);
  if (sun) parts.push(sun);
  parts.push(...seaBands(x, hz, w, seaH, pal));
  parts.push(glints(x, hz, w, seaH, mix(COLORS.sun, pal.sea[0], 0.15)));
  // Things falling: a shell, a starfish and a pearl, spread over the sky.
  const items = { shell: null, starfish: null, pearl: null };
  for (const it of LOOK.items) if (it.name in items) items[it.name] = it;
  const sky = hz - 18 - y; // the open sky above the mast
  const place = [['shell', 5, 0.12], ['starfish', w - 13, 0.4], ['pearl', 14, 0.75]];
  for (const [name, dx, fy] of place) {
    const it = items[name];
    const c = itemColour(it.colour);
    const s = sprite(spriteGrid(it.mask, true), c);
    const ix = x + dx;
    const iy = y + Math.round(fy * (sky - s.h));
    parts.push({ what: `item ${name}`, rule: 'de', fill: c, edge: edge(c), x: ix, y: iy, w: s.w, h: s.h, colours: s.colours, draw: (ctx) => s.draw(ctx, ix, iy) });
  }
  // A fish leaping beside the boat, head up.
  const fc = itemColour(LOOK.fish.colours[1]);
  const fs = sprite(turnUp(spriteGrid(LOOK.fish.mask, true)), fc);
  const fx = x + w - 8;
  const fy = hz - 4;
  parts.push({ what: 'fish', rule: 'de', fill: fc, edge: edge(fc), x: fx, y: fy, w: fs.w, h: fs.h, colours: fs.colours, draw: (ctx) => fs.draw(ctx, fx, fy) });
  // The boat, as catch.js draws it: hull with its edge, keel below the horizon, mast, sail and jib.
  const bx = x + 5;
  const deck = hz - 5;
  const mx = bx + 11;
  const hull = COLORS.coral;
  const sail = COLORS.sail;
  const jib = BRICK_ROWS[5];
  parts.push({
    what: 'boat sail', rule: 'de', fill: sail, edge: edge(sail), x: mx + 1, y: deck - 10, w: 10, h: 9, colours: [sail, edge(sail)],
    draw(ctx) {
      for (let r = 0; r < 9; r++) {
        ctx.fillStyle = sail;
        ctx.fillRect(mx + 1, deck - 10 + r, r + 1, 1);
        ctx.fillStyle = edge(sail);
        ctx.fillRect(mx + r + 1, deck - 10 + r, 1, 1);
      }
      ctx.fillRect(mx + 1, deck - 2, 9, 1);
    },
  });
  parts.push({
    what: 'boat jib', rule: 'de', fill: jib, edge: edge(jib), x: mx - 3, y: deck - 8, w: 3, h: 6, colours: [jib, edge(jib)],
    draw(ctx) {
      for (let r = 0; r < 6; r++) {
        const jw = Math.floor(r / 2) + 1;
        ctx.fillStyle = jib;
        ctx.fillRect(mx - jw, deck - 8 + r, jw, 1);
        ctx.fillStyle = edge(jib);
        ctx.fillRect(mx - jw, deck - 8 + r, 1, 1);
      }
    },
  });
  parts.push({
    what: 'boat mast', rule: 'cr', fill: line(hull), edge: null, x: mx, y: deck - 11, w: 1, h: 11, colours: [line(hull)],
    draw(ctx) { ctx.fillStyle = line(hull); ctx.fillRect(mx, deck - 11, 1, 11); },
  });
  // The hull is measured against the sky it sits in (its rows above the horizon), the keel against the sea.
  parts.push({
    what: 'boat hull', rule: 'cr', fill: hull, edge: edge(hull), x: bx, y: deck, w: 24, h: hz - deck, colours: bodyColours(hull, edge(hull)),
    draw: (ctx) => pixelBody(ctx, bx, deck, 24, 7, hull, 2, edge(hull)),
  });
  parts.push({
    what: 'boat keel', rule: 'cr', fill: COLORS.keel, edge: null, x: bx, y: hz, w: 24, h: deck + 7 - hz, colours: [COLORS.keel],
    draw(ctx) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, hz, 24, 7);
      ctx.clip();
      steppedRect(ctx, bx, deck, 24, 7, COLORS.keel, 2);
      ctx.restore();
    },
  });
  return parts;
}

// Row U2c: the Putt card is the open course of row U2 (PLAN §6h): no frame, the window's edges are the walls, a
// stub and a corner cut grow from them, on a sand level's colours (games/putt/putt.js palette and paintCourse).
function puttParts(win, pal, t) {
  const { x, y, w, h } = win;
  const look = puttGround('sand', t);
  const sand = look.ground;
  const parts = [{ bg: true, what: 'sand', colour: sand, x, y, w, h }];
  // The hole and its flag (putt.js drawHole), near the top.
  const hx = x + w - 13;
  const hy = y + Math.max(13, Math.round(h * 0.17));
  const r = 3.5;
  const rim = mix(COLORS.keel, COLORS.white, 0.35);
  const cells = [];
  for (let yy = Math.floor(hy - r); yy < hy + r; yy++) {
    for (let xx = Math.floor(hx - r); xx < hx + r; xx++) {
      const d = Math.hypot(xx + 0.5 - hx, yy + 0.5 - hy);
      if (d <= r) cells.push([xx, yy, d > r - 1 ? rim : COLORS.keel]);
    }
  }
  parts.push({
    what: 'hole', rule: 'cr', fill: COLORS.keel, edge: null, x: hx - 4, y: hy - 4, w: 8, h: 8, colours: [COLORS.keel, rim],
    draw(ctx) { for (const [a, b, c] of cells) { ctx.fillStyle = c; ctx.fillRect(a, b, 1, 1); } },
  });
  const px = Math.floor(hx + r);
  const top = Math.floor(hy) - 9;
  parts.push({
    what: 'flag pole', rule: 'cr', fill: line(COLORS.coral), edge: null, x: px, y: top, w: 1, h: 9, colours: [line(COLORS.coral)],
    draw(ctx) { ctx.fillStyle = line(COLORS.coral); ctx.fillRect(px, top, 1, 9); },
  });
  parts.push({
    what: 'flag', rule: 'de', fill: COLORS.coral, edge: null, x: px + 1, y: top, w: 4, h: 3, colours: [COLORS.coral],
    draw(ctx) { ctx.fillStyle = COLORS.coral; [4, 3, 1].forEach((fw, k) => ctx.fillRect(px + 1, top + k, fw, 1)); },
  });
  // A peg, left of the hole (pink, as putt.js).
  parts.push(body('peg', 'de', x + 6, hy - 1, 5, 5, BRICK_ROWS[5], 1, null, true));
  // A stub from the right edge, below the hole: coral, its highlight row on top and shade row at the bottom, nothing
  // drawn along the window's edge (the screen's edge is the wall); it casts the 0.2 drop shade on the sand below.
  const stubY = hy + 10;
  const stubH = 4;
  const stubX = x + Math.round(w * 0.42);
  const stubW = x + w - stubX;
  const drop = mix(sand, COLORS.shadeTarget, 0.2);
  parts.push({
    what: 'stub', rule: 'de', fill: COLORS.coral, edge: null, x: stubX, y: stubY, w: stubW, h: stubH,
    colours: [COLORS.coral, highlight(COLORS.coral), shade(COLORS.coral)],
    draw(ctx) {
      ctx.fillStyle = COLORS.coral;
      ctx.fillRect(stubX, stubY, stubW, stubH);
      ctx.fillStyle = highlight(COLORS.coral);
      ctx.fillRect(stubX, stubY, stubW, 1);
      ctx.fillStyle = shade(COLORS.coral);
      ctx.fillRect(stubX, stubY + stubH - 1, stubW, 1);
    },
  });
  parts.push({ bg: true, what: 'drop shade', colour: drop, x: stubX, y: stubY + stubH, w: stubW, h: 1 });
  // A pool (left) and a sand trap (right), below the stub.
  const midY = stubY + stubH + Math.max(5, Math.round((h - (stubY - y) - stubH - 24) * 0.25));
  const pool = look.pool;
  const wg = mix(COLORS.sun, pool, 0.15);
  const ww = Math.min(18, Math.floor(w * 0.38));
  parts.push({
    what: 'pool', rule: 'de', fill: pool, edge: null, x: x + 3, y: midY, w: ww, h: 12, colours: [pool, wg],
    draw(ctx) {
      steppedRect(ctx, x + 3, midY, ww, 12, pool, 2);
      ctx.fillStyle = wg;
      ctx.fillRect(x + 7, midY + 3, Math.min(7, ww - 8), 1);
      ctx.fillRect(x + 3 + ww - 9, midY + 8, 5, 1);
    },
  });
  const trap = look.trap; // as putt.js on a sand level
  const dot = mix(trap, COLORS.shadeTarget, 0.15);
  const tw = 16;
  const tx = x + w - tw - 3;
  const ty = midY - 2;
  parts.push({
    what: 'sand trap', rule: 'de', fill: trap, edge: null, x: tx, y: ty, w: tw, h: 9, colours: [trap, dot],
    draw(ctx) {
      steppedRect(ctx, tx, ty, tw, 9, trap, 2);
      ctx.fillStyle = dot;
      for (const [dx, dy] of [[4, 2], [tw - 6, 3], [tw >> 1, 4], [3, 6], [tw - 4, 6]]) ctx.fillRect(tx + dx, ty + dy, 1, 1);
    },
  });
  // A corner cut across the bottom-left corner: a stair-stepped triangle, coral, its slant lit.
  const cc = 9;
  const cy0 = y + h - cc;
  parts.push({
    what: 'corner cut', rule: 'de', fill: COLORS.coral, edge: null, x, y: cy0, w: cc, h: cc,
    colours: [COLORS.coral, highlight(COLORS.coral)],
    draw(ctx) {
      for (let k = 0; k < cc; k++) {
        ctx.fillStyle = COLORS.coral;
        ctx.fillRect(x, cy0 + k, k + 1, 1);
        ctx.fillStyle = highlight(COLORS.coral);
        ctx.fillRect(x + k, cy0 + k, 1, 1);
      }
    },
  });
  // A salmon block in the open course between the pool and the ball, where the window is tall enough.
  const ballTop = y + h - 9 - 15; // the top of the aim guide
  const room = ballTop - (midY + 12);
  if (room >= 16) {
    const by = midY + 12 + Math.round((room - 6) * 0.5);
    parts.push(body('block (salmon)', 'de', x + 12, by, 12, 6, BRICK_ROWS[2], 1, null, true));
  }
  // The ball near the bottom, its dotted aim guide up and to the left (the last dot past the bend, as in the game).
  const ballX = x + w - 12;
  const ballY = y + h - 9;
  const after = mix(COLORS.blue, sand, 0.45);
  const dots = [1, 2, 3, 4].map((k) => [ballX + 2 - 4 * k, ballY + 2 - 3 * k]);
  parts.push({
    what: 'aim guide', rule: 'cr', fill: COLORS.blue, edge: null, x: dots[2][0], y: dots[2][1], w: 9, h: 7, colours: [COLORS.blue],
    draw(ctx) { ctx.fillStyle = COLORS.blue; for (const [a, b] of dots.slice(0, 3)) ctx.fillRect(a, b, 1, 1); },
  });
  parts.push({
    what: 'aim guide (rebound)', rule: 'de', fill: after, edge: null, x: dots[3][0], y: dots[3][1], w: 1, h: 1, colours: [after],
    draw(ctx) { ctx.fillStyle = after; ctx.fillRect(dots[3][0], dots[3][1], 1, 1); },
  });
  parts.push(body('ball', 'cr', ballX, ballY, 5, 5, COLORS.blue, 1, null, true));
  return parts;
}

function stackParts(win, pal) {
  const { x, y, w, h } = win;
  const seaH = Math.max(8, Math.round(h * 0.1));
  const hz = y + h - seaH;
  const parts = bandsOf(x, y, w, hz - y, pal.sky, 'sky');
  parts.push(...seaBands(x, hz, w, seaH, pal));
  parts.push(glints(x, hz, w, seaH, mix(COLORS.sun, pal.sea[0], 0.15)));
  const n = Math.max(4, Math.min(8, Math.floor((h * 0.55) / 8)));
  const widths = [32, 30, 30, 28, 26, 26, 24, 22].map((v) => Math.min(v, w - 10));
  const shifts = [0, 1, 0, 1, 1, 2, 1, 2];
  for (let i = 0; i < n; i++) {
    const bw = widths[i];
    const c = BRICK_ROWS[i % BRICK_ROWS.length];
    parts.push(body(`floor ${i + 1}`, 'de', x + Math.floor((w - bw) / 2) + shifts[i], hz - 8 * (i + 1), bw, 8, c, 2, edge(c))); // floor 0's bottom on the horizon, as games/stack/sim.js floorTop
  }
  // The next block, sliding in above the tower, off to the right.
  const nw = widths[n - 1];
  const nc = BRICK_ROWS[n % BRICK_ROWS.length];
  const ny = y + Math.max(6, Math.round((hz - 8 * n - y) * 0.3));
  parts.push(body('next block', 'de', x + w - nw - 3, ny, nw, 8, nc, 2, edge(nc)));
  return parts;
}

// Row A1: the Glide card, a window onto the table (games/glide/glide.js): the sea strip with its inlet and buoys,
// the sand, the side and bottom bands, the dashed centre line, the crab, the shell and the life ring, and the two
// sandcastles at the player's goal. The pieces are the game's own masks (games/glide/sim.js) in its colours.
function maskPiece(what, mask, keys, x, y, fill, edgeC) {
  const used = new Set();
  for (const row of mask) for (const k of row) if (k !== '.') used.add(keys[k]);
  return {
    what, rule: 'cr', fill, edge: edgeC, x, y, w: mask[0].length, h: mask.length, colours: [...used],
    draw(ctx) {
      mask.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '.') continue;
          ctx.fillStyle = keys[row[c]];
          ctx.fillRect(x + c, y + r, 1, 1);
        }
      });
    },
  };
}

function glideParts(win, pal, t) {
  const { x, y, w, h } = win;
  const col = tableColours(TOK, t); // the game's own table colours (games/glide/sim.js)
  const ground = col.ground;
  const sh = Math.max(4, Math.round(h * 0.08)); // the sea strip
  const parts = [{ bg: true, what: 'sand', colour: ground, x, y: y + sh, w, h: h - sh }];
  parts.push(...seaBands(x, y, w, sh, pal));
  parts.push(glints(x, y, w, sh, col.glint));
  const iw = 22; // the inlet, centred, 3 px into the sand
  const ix = x + Math.round((w - iw) / 2);
  parts.push({ bg: true, what: 'inlet', colour: pal.sea[2], x: ix, y: y + sh, w: iw, h: 3 });
  parts.push({ bg: true, what: 'tide foam', colour: col.foam, x, y: y + sh, w: ix - x, h: 1 });
  parts.push({ bg: true, what: 'tide foam', colour: col.foam, x: ix + iw, y: y + sh, w: x + w - ix - iw, h: 1 });
  parts.push({ bg: true, what: 'side band', colour: col.wall, x, y: y + sh, w: 1, h: h - sh });
  parts.push({ bg: true, what: 'side band', colour: col.wall, x: x + w - 1, y: y + sh, w: 1, h: h - sh });
  parts.push({ bg: true, what: 'bottom band', colour: col.wall, x, y: y + h - 1, w, h: 1 });
  const midY = y + sh + Math.round((h - sh) * 0.52);
  const dashes = [];
  for (let dx = 2; dx < w - 2; dx += 6) dashes.push({ x: x + dx, y: midY, w: Math.min(3, w - 2 - dx), h: 1 });
  parts.push({ bg: true, what: 'centre line', colour: col.line, x, y: midY, w, h: 1, dashes });
  // The buoys at the inlet's corners: coral with a white band, the edge all round.
  const buoyEdge = col.buoyEdge;
  for (const bx of [ix - 2, ix + iw - 2]) {
    const by = y + sh + 1;
    parts.push({
      what: 'buoy', rule: 'de', fill: col.buoy, edge: buoyEdge, x: bx, y: by, w: 4, h: 4, colours: [col.buoy, col.buoyBand, buoyEdge],
      draw(ctx) {
        ctx.fillStyle = buoyEdge;
        ctx.fillRect(bx + 1, by, 2, 1); ctx.fillRect(bx + 1, by + 3, 2, 1); ctx.fillRect(bx, by + 1, 1, 2); ctx.fillRect(bx + 3, by + 1, 1, 2);
        ctx.fillStyle = col.buoy; ctx.fillRect(bx + 1, by + 1, 2, 1);
        ctx.fillStyle = col.buoyBand; ctx.fillRect(bx + 1, by + 2, 2, 1);
      },
    });
  }
  const keys = pieceColours(TOK);
  // The crab in front of its goal, the shell coming down the right, the ring low on the left.
  const room = h - sh - 3; // below the inlet
  const crabY = y + sh + 6;
  parts.push(maskPiece('crab', CRAB_MASK, keys.crab, x + Math.round((w - CRAB_MASK[0].length) / 2), crabY, keys.crab['#'], keys.crab.o));
  const ringY = Math.min(y + h - 10 - RING_MASK.length, crabY + CRAB_MASK.length + Math.round(room * 0.28));
  parts.push(maskPiece('ring', RING_MASK, keys.ring, x + 3, ringY, keys.ring['#'], keys.ring.o));
  const puckY = crabY + CRAB_MASK.length + Math.max(2, Math.round((ringY - crabY - CRAB_MASK.length - PUCK_MASK.length) * 0.5));
  parts.push(maskPiece('shell', PUCK_MASK, keys.puck, x + w - PUCK_MASK[0].length - 5, puckY, keys.puck.p, keys.puck.o));
  // The sandcastles either side of the player's goal, on the bottom band, each with a pink flag.
  const gw = 22;
  const gx = x + Math.round((w - gw) / 2);
  const castleHi = col.castleHi;
  const pole = col.pole;
  const flag = col.flag;
  for (const cx of [gx - 2, gx + gw - 3]) {
    const cy = y + h - 6;
    parts.push({
      what: 'sandcastle', rule: 'de', fill: col.castle, edge: null, x: cx, y: cy, w: 5, h: 5, colours: [col.castle, castleHi],
      draw(ctx) {
        ctx.fillStyle = col.castle;
        ctx.fillRect(cx, cy + 1, 5, 4);
        ctx.fillRect(cx, cy, 1, 1); ctx.fillRect(cx + 2, cy, 1, 1); ctx.fillRect(cx + 4, cy, 1, 1);
        ctx.fillStyle = castleHi;
        ctx.fillRect(cx + 1, cy + 2, 3, 1);
      },
    });
    parts.push({
      what: 'sandcastle flag', rule: 'de', fill: flag, edge: null, x: cx + 2, y: cy - 4, w: 3, h: 4, colours: [pole, flag],
      draw(ctx) {
        ctx.fillStyle = pole; ctx.fillRect(cx + 2, cy - 4, 1, 4);
        ctx.fillStyle = flag; ctx.fillRect(cx + 3, cy - 4, 2, 1); ctx.fillRect(cx + 3, cy - 3, 1, 1);
      },
    });
  }
  parts.push({ bg: true, what: 'goal gap', colour: col.gap, x: gx + 3, y: y + h - 1, w: gw - 5, h: 1 });
  return parts;
}

const BUILD = { bricks: bricksParts, catch: catchParts, putt: puttParts, stack: stackParts, glide: glideParts };

/**
 * Every part of a card's window at a scene step (0 sunset .. sceneSteps
 * dusk), in drawing order. Backgrounds have bg: true and a colour; pieces
 * have a rule, fill, edge, box and colours.
 */
export function cardParts(id, win, step) {
  const t = step / SESSION.sceneSteps;
  return BUILD[id](win, scenePalette(t), t);
}

/** The colours a card's frame draws in the active theme: coral body, its highlight and shade, the edge all round and round the window. */
export function frameColours() {
  const { FRAME, FRAME_EDGE, FRAME_RIM } = frameOf();
  return [FRAME, highlight(FRAME), shade(FRAME), FRAME_EDGE, FRAME_RIM];
}

/** Draw one card: the coral frame with its 1 px keel edge all round, stepped corners, and the window in its coral edge. */
export function drawCard(ctx, id, r, step, pressed = false) {
  const { FRAME, FRAME_EDGE, FRAME_RIM } = frameOf();
  const card = { ...r, y: r.y + (pressed ? 1 : 0) };
  pixelBody(ctx, card.x, card.y, card.w, card.h, FRAME, 3, FRAME_RIM);
  const win = windowOf(card);
  steppedRect(ctx, win.x - 1, win.y - 1, win.w + 2, win.h + 2, FRAME_EDGE, 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(win.x, win.y, win.w, win.h);
  ctx.clip();
  for (const p of cardParts(id, win, step)) {
    if (p.draw) p.draw(ctx);
    else if (p.dashes) {
      ctx.fillStyle = p.colour;
      for (const d of p.dashes) ctx.fillRect(d.x, d.y, d.w, d.h);
    } else if (p.bg) {
      ctx.fillStyle = p.colour;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      // a dither seam with the band above, as in the scene
      if (p.prev) ditherRow(ctx, p.x, p.y, p.w, p.colour, p.prev, p.i);
    }
  }
  ctx.restore();
  // The window's own corners are cut 1 px, in the edge colour.
  ctx.fillStyle = FRAME_EDGE;
  for (const [cx, cy] of [[win.x, win.y], [win.x + win.w - 1, win.y], [win.x, win.y + win.h - 1], [win.x + win.w - 1, win.y + win.h - 1]]) ctx.fillRect(cx, cy, 1, 1);
  return win;
}
