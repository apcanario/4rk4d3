// RLX hub cards (docs/V2.md §5): two framed cards side by side in one row (Bricks, Pool), each a
// small window onto its game, drawn in the game's own colours (Bricks' scene at the current step
// of the exit ramp; Pool's table does not change). No text of any kind. No DOM: the layout and
// the parts list also serve the headless checks (tests/check.py), which
// measure every piece against the window colours behind it.

import { LOGICAL_WIDTH, COLORS, BRICK_ROWS, mix, shade, highlight, edge, line, scenePalette, tokens } from '../shared/tokens.js';
import { pixelBody, steppedRect, ditherRow, SUN_RADIUS } from '../shared/pixel.js';
import { SESSION } from '../shared/session.js';

/** The cards, left to right. Each opens its
 * game's index.html by name: the Android app's local server answers a folder URL with the
 * hub itself (PLAN §6f). */
export const CARDS = Object.freeze([
  Object.freeze({ id: 'bricks', name: 'Bricks', href: 'games/bricks/index.html' }),
  Object.freeze({ id: 'pool', name: 'Pool', href: 'games/pool/index.html' }),
]);

// Layout values (docs/V2.md §5: 2 columns by 1 row).
export const GRID = Object.freeze({
  cols: 2,
  rows: 1,
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
 * picture. Returns { cards: {id: rect}, x0, y0,
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
  return { cards, x0, y0, cw, ch, gap: GRID.gap, rows: GRID.rows, top, bottom, side, horizon, seaHeight: H - horizon };
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
    out.push([right + 2, y0 + Math.round(ch * 0.65), len]);
  }
  const below = H - bottom; // rows of sea under the grid
  if (below >= 6) {
    out.push([x0 + 6, bottom + 3, 4]);
    out.push([x0 + cw + 10, bottom + 3, 6]);
  }
  if (below >= 10) out.push([x0 + cw * 2 - 8, bottom + 7, 3]);
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

const bodyColours = (c, rim) => [c, shade(c), highlight(c), ...(rim ? [rim] : [])];

function body(what, rule, x, y, w, h, colour, steps, rim, fillOnly = false) {
  return {
    what, rule, fill: colour, edge: fillOnly ? null : (rim || null), x, y, w, h,
    colours: bodyColours(colour, rim),
    draw: (ctx) => pixelBody(ctx, x, y, w, h, colour, steps, rim),
  };
}

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

/* ---------- the Pool card: a small window onto the table ---------- */

const POOL_RACK = [[0], [2, 'blue'], [4, 5, 7]]; // brick rows (or 'blue') of the card's small rack, apex row first

function disc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt((r + 0.5) * (r + 0.5) - dy * dy));
    ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
  }
}

// A ball as pool.js draws it: drop shade, 1 px edge all round, fill, a 2 px highlight.
function ballPiece(what, cx, cy, fill, rim) {
  return {
    what, rule: 'cr', fill, edge: rim, x: cx - 4, y: cy - 4, w: 9, h: 9, colours: [fill, rim, highlight(fill)],
    draw(ctx) {
      disc(ctx, cx + 1, cy + 1, 4, mix(COLORS.sand, COLORS.shadeTarget, 0.2));
      disc(ctx, cx, cy, 4, rim);
      disc(ctx, cx, cy, 3, fill);
      ctx.fillStyle = highlight(fill);
      ctx.fillRect(cx - 2, cy - 2, 2, 1);
    },
  };
}

function poolPocket(what, cx, cy, r) {
  const set = tokens();
  const mid = set.name === 'dark' ? COLORS.deep : set.SEA_BANDS[2];
  return {
    what, rule: 'cr', fill: COLORS.poolRing, edge: null, x: cx - r, y: cy - r, w: r * 2 + 1, h: r * 2 + 1,
    colours: [COLORS.poolRing, set.SEA_BANDS[1], mid],
    draw(ctx) {
      disc(ctx, cx, cy, r, COLORS.poolRing);
      disc(ctx, cx, cy, r - 1, set.SEA_BANDS[1]);
      disc(ctx, cx, cy, r - 3, mid);
    },
  };
}

function poolParts(win) {
  const { x, y, w, h } = win;
  const band = 3;
  const parts = [
    { bg: true, what: 'cushion', colour: COLORS.sandWall, x, y, w, h },
    { bg: true, what: 'sand', colour: COLORS.sand, x: x + band, y: y + band, w: w - band * 2, h: h - band * 2 },
  ];
  parts.push(poolPocket('pocket left', x + 1, y + 1, 6), poolPocket('pocket right', x + w - 2, y + 1, 6));
  const cx = x + Math.floor(w / 2);
  const apexY = y + Math.round(h * 0.52);
  const colourOf = (k) => (k === 'blue' ? COLORS.blue : BRICK_ROWS[k]);
  POOL_RACK.forEach((row, r) => {
    row.forEach((k, i) => {
      const fill = colourOf(k);
      parts.push(ballPiece('ball', Math.round(cx + (i - (row.length - 1) / 2) * 9), Math.round(apexY - r * 7.8), fill, line(fill)));
    });
  });
  parts.push(ballPiece('cue ball', cx, y + h - 17, COLORS.foam, line(COLORS.coral)));
  return parts;
}

const BUILD = { bricks: bricksParts, pool: poolParts };

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
