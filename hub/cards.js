// RLX hub cards (row H2, PLAN §5a): four big framed cards in a 2x2 grid, each
// a small window onto its game, drawn in the game's own scene colours at the
// current step of the exit ramp. No text of any kind. No DOM: the layout and
// the parts list also serve the headless checks (tests/check.py), which
// measure every piece against the window colours behind it.

import { COLORS, BRICK_ROWS, mix, shade, highlight, edge, scenePalette } from '../shared/tokens.js';
import { pixelBody, steppedRect, ditherRow, SEA_HEIGHT, SUN_RADIUS } from '../shared/pixel.js';
import { SESSION } from '../shared/session.js';
import { LOOK, spriteGrid, turnUp } from '../games/catch/sim.js';

/** The cards, in grid order: top left, top right, bottom left, bottom right. */
export const CARDS = Object.freeze([
  Object.freeze({ id: 'bricks', name: 'Bricks', href: 'games/bricks/' }),
  Object.freeze({ id: 'catch', name: 'Catch', href: 'games/catch/' }),
  Object.freeze({ id: 'putt', name: 'Putt', href: 'games/putt/' }),
  Object.freeze({ id: 'stack', name: 'Stack', href: 'games/stack/' }),
]);

// Layout values (PLAN §5a).
export const GRID = Object.freeze({
  gap: 5, // between the cards, across and down
  side: 4, // least margin at the screen's sides
  top: 4, // least margin below the top safe inset
  sunClear: SUN_RADIUS + 4, // the grid ends this far above the horizon, so the whole sun shows
  maxRatio: 2, // a card is never taller than this many times its width
  minCard: 40, // every card is at least this big in each direction (the tap target)
  frame: 4, // frame thickness at the top and sides; the bottom is one more (the drop shade)
});

/**
 * The grid for a logical screen W x H with safe insets (logical px) and the
 * side band (logical px) where a touch is ignored. Cards are as big as fit:
 * the width from the margins, the height from the open sky between the top
 * inset and the sun, capped at maxRatio x the width. The grid sits right
 * above the sun, in the thumb's half. Returns { cards: {id: rect}, x0, y0,
 * cw, ch, gap, top, bottom }.
 */
export function gridLayout(W, H, safe, edgeBand = 0) {
  const side = Math.max(GRID.side, edgeBand, safe.left + 2, safe.right + 2);
  const cw = Math.floor((W - side * 2 - GRID.gap) / 2);
  const x0 = Math.floor((W - (cw * 2 + GRID.gap)) / 2);
  const horizon = H - SEA_HEIGHT;
  const top = safe.top + GRID.top;
  const bottom = horizon - GRID.sunClear;
  const fit = Math.floor((bottom - top - GRID.gap) / 2);
  const ch = Math.max(GRID.minCard, Math.min(fit, cw * GRID.maxRatio));
  const y0 = Math.max(top, bottom - (ch * 2 + GRID.gap));
  const cards = {};
  CARDS.forEach((c, i) => {
    cards[c.id] = { x: x0 + (i % 2) * (cw + GRID.gap), y: y0 + Math.floor(i / 2) * (ch + GRID.gap), w: cw, h: ch };
  });
  return { cards, x0, y0, cw, ch, gap: GRID.gap, top, bottom: y0 + ch * 2 + GRID.gap, side };
}

/** The inner window of a card rect (the game's scene shows through it). */
export function windowOf(r) {
  const f = GRID.frame;
  return { x: r.x + f, y: r.y + f, w: r.w - f * 2, h: r.h - f * 2 - 1 };
}

const FRAME = COLORS.coral;
const FRAME_EDGE = edge(COLORS.coral);

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
  const rows = [];
  for (let dy = 1 + sink; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - (dy - 0.5) * (dy - 0.5)));
    const yy = horizon - (dy - sink);
    if (half > 0 && yy >= top) rows.push([cx - half, yy, half * 2]);
  }
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
    what: 'boat mast', rule: 'cr', fill: edge(hull), edge: null, x: mx, y: deck - 11, w: 1, h: 11, colours: [edge(hull)],
    draw(ctx) { ctx.fillStyle = edge(hull); ctx.fillRect(mx, deck - 11, 1, 11); },
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

function puttParts(win, pal) {
  const { x, y, w, h } = win;
  const sand = pal.sky[0]; // the course floor: the sky-top token at this step, as in putt.js
  const parts = [{ bg: true, what: 'sand', colour: sand, x, y, w, h }];
  // The hole and its flag (putt.js drawHole), near the top.
  const hx = x + w - 13;
  const hy = y + Math.max(13, Math.round(h * 0.17));
  const r = 3.5;
  const rim = mix(COLORS.keel, COLORS.cloud, 0.35);
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
    what: 'flag pole', rule: 'cr', fill: edge(COLORS.coral), edge: null, x: px, y: top, w: 1, h: 9, colours: [edge(COLORS.coral)],
    draw(ctx) { ctx.fillStyle = edge(COLORS.coral); ctx.fillRect(px, top, 1, 9); },
  });
  parts.push({
    what: 'flag', rule: 'de', fill: COLORS.coral, edge: null, x: px + 1, y: top, w: 4, h: 3, colours: [COLORS.coral],
    draw(ctx) { ctx.fillStyle = COLORS.coral; [4, 3, 1].forEach((fw, k) => ctx.fillRect(px + 1, top + k, fw, 1)); },
  });
  // A peg, left of the hole.
  parts.push(body('peg', 'de', x + 6, hy - 1, 5, 5, BRICK_ROWS[5], 1, null, true));
  // The bar: a coral wall from the right edge most of the way across, highlight on top.
  const barY = hy + 11;
  const barX = x + 14;
  parts.push({
    what: 'wall', rule: 'de', fill: COLORS.coral, edge: null, x: barX, y: barY, w: x + w - barX, h: 3, colours: [COLORS.coral, highlight(COLORS.coral)],
    draw(ctx) {
      ctx.fillStyle = COLORS.coral;
      ctx.fillRect(barX, barY, x + w - barX, 3);
      ctx.fillStyle = highlight(COLORS.coral);
      ctx.fillRect(barX, barY, x + w - barX, 1);
    },
  });
  // Water (left) and a sand trap (right), below the bar.
  const midY = barY + 3 + Math.max(5, Math.round((h - (barY - y) - 3 - 24) * 0.25));
  const water = pal.sea[1];
  const wg = mix(COLORS.sun, water, 0.15);
  const ww = Math.min(20, Math.floor(w * 0.42));
  parts.push({
    what: 'water', rule: 'de', fill: water, edge: null, x: x + 3, y: midY, w: ww, h: 12, colours: [water, wg],
    draw(ctx) {
      steppedRect(ctx, x + 3, midY, ww, 12, water, 2);
      ctx.fillStyle = wg;
      ctx.fillRect(x + 7, midY + 3, Math.min(7, ww - 8), 1);
      ctx.fillRect(x + 3 + ww - 9, midY + 8, 5, 1);
    },
  });
  const trap = mix(sand, BRICK_ROWS[3], 0.55);
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
  // A salmon block in the open course between the water and the ball, where the window is tall enough.
  const ballTop = y + h - 9 - 15; // the top of the aim guide
  const room = ballTop - (midY + 12);
  if (room >= 16) {
    const by = midY + 12 + Math.round((room - 6) * 0.5);
    parts.push(body('block (salmon)', 'de', x + 5, by, 12, 6, BRICK_ROWS[2], 1, null, true));
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
    parts.push(body(`floor ${i + 1}`, 'de', x + Math.floor((w - bw) / 2) + shifts[i], hz - 8 * (i + 1) + 2, bw, 8, c, 2, edge(c)));
  }
  // The next block, sliding in above the tower, off to the right.
  const nw = widths[n - 1];
  const nc = BRICK_ROWS[n % BRICK_ROWS.length];
  const ny = y + Math.max(6, Math.round((hz - 8 * n - y) * 0.3));
  parts.push(body('next block', 'de', x + w - nw - 3, ny, nw, 8, nc, 2, edge(nc)));
  return parts;
}

const BUILD = { bricks: bricksParts, catch: catchParts, putt: puttParts, stack: stackParts };

/**
 * Every part of a card's window at a scene step (0 sunset .. sceneSteps
 * dusk), in drawing order. Backgrounds have bg: true and a colour; pieces
 * have a rule, fill, edge, box and colours.
 */
export function cardParts(id, win, step) {
  const t = step / SESSION.sceneSteps;
  return BUILD[id](win, scenePalette(t), t);
}

/** The colours a card's frame draws: coral body, its highlight and shade, the edge all round and round the window. */
export const FRAME_COLOURS = Object.freeze([FRAME, highlight(FRAME), shade(FRAME), FRAME_EDGE]);
export { FRAME, FRAME_EDGE };

/** Draw one card: the coral frame with its 1 px edge all round, stepped corners, and the window. */
export function drawCard(ctx, id, r, step, pressed = false) {
  const card = { ...r, y: r.y + (pressed ? 1 : 0) };
  pixelBody(ctx, card.x, card.y, card.w, card.h, FRAME, 3, FRAME_EDGE);
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
