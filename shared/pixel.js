// RLX pixel layer (PLAN §3, §4): canvas setup, integer scaling, stepped-corner
// shapes, dither, the sunset scene, and page hygiene shared by every page.

import { LOGICAL_WIDTH, COLORS, SEA_BANDS, SKY_BANDS, mix, shade, highlight } from './tokens.js';

export const SEA_HEIGHT = 42;
export const SUN_RADIUS = 24;

const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = () => !!(motionQuery && motionQuery.matches);

/* ---------- screen: logical canvas, integer scale, centred ---------- */

/**
 * Bind a full-screen display canvas. draw(ctx, screen) paints the logical
 * 135 x H buffer; the buffer is then blitted at the largest integer scale that
 * fits the screen width in device pixels, centred, nearest-neighbour.
 */
export function createScreen(canvas, draw) {
  const view = canvas.getContext('2d', { alpha: false });
  const buffer = document.createElement('canvas');
  const ctx = buffer.getContext('2d', { alpha: false });
  const probe = document.createElement('div');
  probe.className = 'safe-probe';
  document.body.appendChild(probe);

  const screen = {
    W: LOGICAL_WIDTH,
    H: 0,
    scale: 1,
    ox: 0,
    oy: 0,
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    ctx,
    render,
    toLogical,
  };

  let devW = 0;
  let devH = 0;

  function measureSafe() {
    const cs = getComputedStyle(probe);
    const ratio = devW / Math.max(1, canvas.clientWidth); // device px per CSS px
    const conv = (v) => Math.ceil((parseFloat(v) || 0) * ratio / screen.scale);
    screen.safe = {
      top: conv(cs.paddingTop),
      right: conv(cs.paddingRight),
      bottom: conv(cs.paddingBottom),
      left: conv(cs.paddingLeft),
    };
  }

  function layout(w, h) {
    if (!w || !h) return;
    devW = w;
    devH = h;
    canvas.width = devW;
    canvas.height = devH;
    screen.scale = Math.max(1, Math.floor(devW / LOGICAL_WIDTH));
    screen.H = Math.max(1, Math.floor(devH / screen.scale));
    screen.ox = Math.floor((devW - LOGICAL_WIDTH * screen.scale) / 2);
    screen.oy = Math.floor((devH - screen.H * screen.scale) / 2);
    buffer.width = LOGICAL_WIDTH;
    buffer.height = screen.H;
    measureSafe();
    render();
  }

  function render() {
    if (!devW) return;
    ctx.imageSmoothingEnabled = false;
    draw(ctx, screen);
    present();
  }

  function present() {
    view.imageSmoothingEnabled = false;
    const { scale, ox, oy, H } = screen;
    // The few device pixels left over around the centred image take the
    // colour of the nearest logical pixel, so there are no seams.
    view.drawImage(buffer, 0, 0, LOGICAL_WIDTH, H, 0, 0, devW, devH);
    view.drawImage(buffer, 0, 0, LOGICAL_WIDTH, H, ox, oy, LOGICAL_WIDTH * scale, H * scale);
  }

  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const dx = (clientX - rect.left) * (devW / rect.width);
    const dy = (clientY - rect.top) * (devH / rect.height);
    return { x: (dx - screen.ox) / screen.scale, y: (dy - screen.oy) / screen.scale };
  }

  function fallbackSize() {
    const dpr = window.devicePixelRatio || 1;
    layout(Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr));
  }

  let observed = false;
  if (typeof ResizeObserver === 'function') {
    try {
      const ro = new ResizeObserver((entries) => {
        const e = entries[entries.length - 1];
        const box = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
        const dpr = window.devicePixelRatio || 1;
        const cw = e.contentRect.width * dpr;
        const ch = e.contentRect.height * dpr;
        // Trust the exact device-pixel box when it agrees with the DPR (it
        // does on phones); emulators can report it in CSS px instead.
        if (box && Math.abs(box.inlineSize - cw) <= 1 && Math.abs(box.blockSize - ch) <= 1) {
          layout(box.inlineSize, box.blockSize);
        } else {
          layout(Math.round(cw), Math.round(ch));
        }
      });
      ro.observe(canvas, { box: 'device-pixel-content-box' });
      observed = true;
    } catch (err) {
      observed = false;
    }
  }
  if (!observed) {
    addEventListener('resize', fallbackSize);
    fallbackSize();
  }
  addEventListener('pageshow', () => render());
  return screen;
}

/* ---------- shapes ---------- */

/** Rectangle with stepped corners; steps = how many pixels each corner is cut. */
export function steppedRect(ctx, x, y, w, h, color, steps = 1) {
  x = Math.round(x);
  y = Math.round(y);
  ctx.fillStyle = color;
  const n = Math.min(steps, Math.floor(h / 2), Math.floor(w / 2));
  for (let i = 0; i < n; i++) {
    const inset = n - i;
    ctx.fillRect(x + inset, y + i, w - inset * 2, 1);
    ctx.fillRect(x + inset, y + h - 1 - i, w - inset * 2, 1);
  }
  ctx.fillRect(x, y + n, w, h - n * 2);
}

/**
 * A rounded 8-bit body (PLAN §3): stepped-corner fill, a 1 px highlight line
 * just inside the top edge and a 1 px shade along the bottom.
 */
export function pixelBody(ctx, x, y, w, h, color, steps = 1) {
  x = Math.round(x);
  y = Math.round(y);
  steppedRect(ctx, x, y, w, h, color, steps);
  const s = Math.min(steps, Math.floor(h / 2));
  ctx.fillStyle = shade(color);
  ctx.fillRect(x + s, y + h - 1, w - s * 2, 1);
  if (s > 1) {
    // follow the stepped corner up one row on each side
    ctx.fillRect(x + s - 1, y + h - 2, 1, 1);
    ctx.fillRect(x + w - s, y + h - 2, 1, 1);
  }
  ctx.fillStyle = highlight(color);
  const hi = s + 1;
  if (w - hi * 2 > 0) ctx.fillRect(x + hi, y + 1, w - hi * 2, 1);
}

/** One row of 1 px checker dither: colour b on every other pixel over a. */
export function ditherRow(ctx, x, y, w, a, b, phase = 0) {
  ctx.fillStyle = a;
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = b;
  for (let i = (phase & 1); i < w; i += 2) ctx.fillRect(x + i, y, 1, 1);
}

/** Bands from top to bottom of a region, with a dither seam between bands. */
function bands(ctx, x, y, w, heights, colors) {
  let cy = y;
  for (let i = 0; i < heights.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(x, cy, w, heights[i]);
    if (i > 0) ditherRow(ctx, x, cy, w, colors[i], colors[i - 1], i);
    cy += heights[i];
  }
}

/* ---------- scene ---------- */

const CLOUDS = [
  [
    '........####........',
    '......########......',
    '..##############....',
    '.##################.',
    '####################',
    '.##################.',
  ],
  [
    '.....####.......',
    '...#########....',
    '.##############.',
    '################',
    '.##############.',
  ],
  [
    '......###.....',
    '....#######...',
    '.############.',
    '##############',
    '.############.',
  ],
];

function drawCloud(ctx, x, y, kind) {
  const rows = CLOUDS[kind % CLOUDS.length];
  ctx.fillStyle = COLORS.cloud;
  rows.forEach((row, r) => {
    const a = row.indexOf('#');
    const b = row.lastIndexOf('#');
    if (a >= 0) ctx.fillRect(Math.round(x) + a, Math.round(y) + r, b - a + 1, 1);
  });
}

// Glints: [x, row within sea, length]. Longer ones sit under the sun.
const GLINTS = [
  [12, 6, 7], [86, 4, 22], [90, 9, 15], [84, 14, 10], [100, 14, 6],
  [30, 18, 5], [95, 20, 9], [118, 23, 6], [93, 27, 5], [8, 30, 6],
  [60, 34, 4], [110, 37, 5],
];

/**
 * Paint the static sunset scene (PLAN §3 Scene) over the whole buffer.
 * clouds: array of [x, y] in logical px. Returns { horizon }.
 */
export function drawScene(ctx, W, H, { clouds = defaultClouds(H), sunX = 96 } = {}) {
  const horizon = H - SEA_HEIGHT;

  // Sky: 10 flat bands sky-top to sky-bottom, dither seam between bands.
  const skyH = [];
  const skyC = [];
  for (let i = 0; i < SKY_BANDS; i++) {
    const y0 = Math.round((i * horizon) / SKY_BANDS);
    const y1 = Math.round(((i + 1) * horizon) / SKY_BANDS);
    skyH.push(y1 - y0);
    skyC.push(mix(COLORS.skyTop, COLORS.skyBottom, i / (SKY_BANDS - 1)));
  }
  bands(ctx, 0, 0, W, skyH, skyC);

  for (let i = 0; i < clouds.length; i++) drawCloud(ctx, clouds[i][0], clouds[i][1], i);

  // Sun: pale half-disc of radius 24 on the horizon, right of centre.
  ctx.fillStyle = COLORS.sun;
  for (let dy = 1; dy <= SUN_RADIUS; dy++) {
    const half = Math.round(Math.sqrt(SUN_RADIUS * SUN_RADIUS - (dy - 0.5) * (dy - 0.5)));
    if (half > 0) ctx.fillRect(sunX - half, horizon - dy, half * 2, 1);
  }

  // Sea: three bands with dither seams and pale glint dashes.
  const seaH = [13, 14, SEA_HEIGHT - 27];
  bands(ctx, 0, horizon, W, seaH, SEA_BANDS);
  ctx.fillStyle = mix(COLORS.sun, SEA_BANDS[0], 0.15);
  for (const [gx, gy, len] of GLINTS) {
    if (gy < SEA_HEIGHT - 1) ctx.fillRect(gx, horizon + gy, Math.min(len, W - gx), 1);
  }
  return { horizon };
}

export function defaultClouds(H) {
  const horizon = H - SEA_HEIGHT;
  return [
    [92, Math.round(horizon * 0.36)],
    [10, Math.round(horizon * 0.5)],
    [40, Math.round(horizon * 0.7)],
  ];
}

/* ---------- shared controls ---------- */

export const BACK_SIZE = { w: 15, h: 13 };

/** The small back control used top-left in every game. */
export function drawBackControl(ctx, x, y, pressed = false) {
  const dy = pressed ? 1 : 0;
  const card = '#A0D0E8';
  pixelBody(ctx, x, y + dy, BACK_SIZE.w, BACK_SIZE.h, card, 2);
  // chevron, 4 x 7, drawn as pixels in the score blue
  ctx.fillStyle = COLORS.blue;
  const cx = Math.round(x) + 5;
  const cy = Math.round(y) + 3 + dy;
  const rows = [3, 2, 1, 0, 1, 2, 3];
  rows.forEach((c, r) => ctx.fillRect(cx + c, cy + r, 2, 1));
}

/** Logical point inside a rect, with optional padding for the thumb. */
export function hitTest(p, r, pad = 0) {
  return p.x >= r.x - pad && p.x < r.x + r.w + pad && p.y >= r.y - pad && p.y < r.y + r.h + pad;
}

/** Publish hit rects in CSS px on the canvas, so automated tests can find them. */
export function publishHits(canvas, screen, rects) {
  const rect = canvas.getBoundingClientRect();
  const k = rect.width / canvas.width; // CSS px per device px
  const out = {};
  for (const [id, r] of Object.entries(rects)) {
    out[id] = {
      x: rect.left + (screen.ox + (r.x + r.w / 2) * screen.scale) * k,
      y: rect.top + (screen.oy + (r.y + r.h / 2) * screen.scale) * k,
    };
  }
  canvas.dataset.hits = JSON.stringify(out);
}

/* ---------- navigation ---------- */

const HUB_URL = new URL('../', import.meta.url);

function sameHub(href) {
  try {
    const u = new URL(href);
    u.hash = '';
    u.search = '';
    const p = u.pathname.replace(/index\.html$/, '');
    return u.origin === HUB_URL.origin && p === HUB_URL.pathname;
  } catch (err) {
    return false;
  }
}

/**
 * Return to the hub. If this page was opened from the hub, step back in
 * history, so the back control and the Android back gesture do the same thing
 * and history never grows. Otherwise replace this page with the hub.
 */
export function goToHub() {
  if (history.length > 1 && sameHub(document.referrer)) history.back();
  else location.replace(HUB_URL.href);
}

/** Open a page given relative to the site root, e.g. 'games/bricks/'. */
export function openPage(path) {
  location.assign(new URL(path, HUB_URL).href);
}

/* ---------- page hygiene and install ---------- */

/** No long-press menu, no zoom, no selection; register the service worker. */
export function initPage() {
  const stop = (e) => e.preventDefault();
  addEventListener('contextmenu', stop);
  addEventListener('selectstart', stop);
  addEventListener('dblclick', stop);
  addEventListener('touchmove', (e) => { if (e.touches.length > 1 || e.scale > 1) e.preventDefault(); }, { passive: false });
  addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  if ('serviceWorker' in navigator && isSecureContext) {
    const swUrl = new URL('../sw.js', import.meta.url);
    const scope = new URL('../', import.meta.url);
    navigator.serviceWorker
      .register(swUrl.href, { scope: scope.pathname, updateViaCache: 'none' })
      .catch(() => {});
  }
}
