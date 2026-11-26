// RLX pixel layer (PLAN §3, §4): canvas setup, integer scaling, stepped-corner
// shapes, dither, the sunset scene, the shared input values, and page
// hygiene shared by every page.

import { LOGICAL_WIDTH, COLORS, SKY_BANDS, mix, shade, highlight, scenePalette } from './tokens.js';
import { SESSION, sceneStep } from './session.js';

export const SEA_HEIGHT = 42;
export const SUN_RADIUS = 24;
export const MIN_HEIGHT = 240; // design for a logical height of 240 and up

// Shared input values (PLAN §2, §6a): one block for every game.
export const INPUT = Object.freeze({
  thumbTravel: 0.28, // a drag across this share of the screen width moves a paddle or boat end to end
  edgeIgnoreCssPx: 24, // a touch that begins this close to the left or right edge is ignored (the back gesture)
});

/** True if a pointer event begins within INPUT.edgeIgnoreCssPx of the left or right edge of the screen. */
export function atSideEdge(e) {
  const w = document.documentElement.clientWidth || innerWidth;
  return e.clientX < INPUT.edgeIgnoreCssPx || e.clientX > w - INPUT.edgeIgnoreCssPx;
}

/**
 * The drag sensitivity that carries a thing across `travel` logical px for a
 * thumb movement of INPUT.thumbTravel of the screen width (screenW, in the
 * same logical px the finger is measured in).
 */
export function thumbSensitivity(travel, screenW) {
  return travel / (INPUT.thumbTravel * screenW);
}

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
    // A game in the hub's frame reads the hub's insets: the frame fills the
    // screen, and the insets are only reported to the top page.
    let p = probe;
    try {
      const hub = window.top !== window && window.top.document.querySelector('.safe-probe');
      if (hub) p = hub;
    } catch (err) {
      p = probe;
    }
    const cs = p.ownerDocument.defaultView.getComputedStyle(p);
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
    // Largest integer scale that fits the width; on a short or landscape
    // window, step down until the logical height reaches MIN_HEIGHT.
    let scale = Math.max(1, Math.floor(devW / LOGICAL_WIDTH));
    while (scale > 1 && Math.floor(devH / scale) < MIN_HEIGHT) scale--;
    screen.scale = scale;
    screen.H = Math.max(1, Math.floor(devH / scale));
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
    const W = LOGICAL_WIDTH;
    const right = ox + W * scale;
    const bottom = oy + H * scale;
    // Device pixels left over around the centred image continue its edge
    // columns and rows, so the scene runs to the screen edges with no seams.
    if (ox > 0) view.drawImage(buffer, 0, 0, 1, H, 0, oy, ox, H * scale);
    if (right < devW) view.drawImage(buffer, W - 1, 0, 1, H, right, oy, devW - right, H * scale);
    if (oy > 0) view.drawImage(buffer, 0, 0, W, 1, 0, 0, devW, oy);
    if (bottom < devH) view.drawImage(buffer, 0, H - 1, W, 1, 0, bottom, devW, devH - bottom);
    view.drawImage(buffer, 0, 0, W, H, ox, oy, W * scale, H * scale);
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
 * just inside the top edge and a 1 px shade along the bottom. With rim (B4
 * contrast pass), a 1 px edge in that colour runs all round inside the same
 * w x h, and the body sits within it, so the size never changes.
 */
export function pixelBody(ctx, x, y, w, h, color, steps = 1, rim = null) {
  x = Math.round(x);
  y = Math.round(y);
  if (rim) {
    steppedRect(ctx, x, y, w, h, rim, steps);
    pixelBody(ctx, x + 1, y + 1, w - 2, h - 2, color, Math.max(1, steps - 1));
    return;
  }
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

// Stars for the last steps of the ramp: [x, fraction down the page's open
// sky]. starsFromStep shows the first pair; each later step adds a pair.
const STARS = [
  [22, 0.05], [116, 0.6], [66, 0.32], [127, 0.95], [5, 0.75], [86, 0.9],
];

function drawStar(ctx, x, y) {
  ctx.fillStyle = COLORS.star;
  ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillRect(x, y - 1, 1, 3);
}

/** Stars shown at a scene step. */
export function starsAt(step) {
  return Math.max(0, Math.min(STARS.length, (step - SESSION.starsFromStep + 1) * 2));
}

/**
 * Paint the scene (PLAN §3 Scene, §2b) over the whole buffer at a phase of
 * the exit ramp, 0 (sunset) to 1 (dusk), drawn in flat steps: the sky and
 * sea bands are a flat mix toward the dusk tokens, the sun sinks below the
 * horizon, and white stars show in the last steps.
 * clouds: array of [x, y] in logical px. stars: [y0, y1], the open sky the
 * stars are spread over. Returns { horizon, step }.
 */
export function drawScene(ctx, W, H, {
  clouds = defaultClouds(H), sunX = 96, phase = 0, stars: starSky = null,
} = {}) {
  const horizon = H - SEA_HEIGHT;
  const step = sceneStep(phase);
  const t = step / SESSION.sceneSteps;
  const pal = scenePalette(t);

  // Sky: 10 flat bands sky-top to sky-bottom, dither seam between bands.
  const skyH = [];
  for (let i = 0; i < SKY_BANDS; i++) {
    const y0 = Math.round((i * horizon) / SKY_BANDS);
    const y1 = Math.round(((i + 1) * horizon) / SKY_BANDS);
    skyH.push(y1 - y0);
  }
  bands(ctx, 0, 0, W, skyH, pal.sky);

  const [s0, s1] = starSky || [Math.round(horizon * 0.1), Math.round(horizon * 0.6)];
  const stars = starsAt(step);
  for (let i = 0; i < stars; i++) drawStar(ctx, STARS[i][0], Math.round(s0 + STARS[i][1] * (s1 - s0)));

  for (let i = 0; i < clouds.length; i++) drawCloud(ctx, clouds[i][0], clouds[i][1], i);

  // Sun: pale half-disc of radius 24 on the horizon, right of centre; it
  // sinks with the steps and is below the horizon at the last one.
  const sink = Math.round(t * SUN_RADIUS);
  ctx.fillStyle = COLORS.sun;
  for (let dy = 1 + sink; dy <= SUN_RADIUS; dy++) {
    const half = Math.round(Math.sqrt(SUN_RADIUS * SUN_RADIUS - (dy - 0.5) * (dy - 0.5)));
    if (half > 0) ctx.fillRect(sunX - half, horizon - (dy - sink), half * 2, 1);
  }

  // Sea: three bands with dither seams and pale glint dashes.
  const seaH = [13, 14, SEA_HEIGHT - 27];
  bands(ctx, 0, horizon, W, seaH, pal.sea);
  ctx.fillStyle = mix(COLORS.sun, pal.sea[0], 0.15);
  for (const [gx, gy, len] of GLINTS) {
    if (gy < SEA_HEIGHT - 1) ctx.fillRect(gx, horizon + gy, Math.min(len, W - gx), 1);
  }
  return { horizon, step };
}

export function defaultClouds(H) {
  const horizon = H - SEA_HEIGHT;
  return [
    [92, Math.round(horizon * 0.36)],
    [10, Math.round(horizon * 0.5)],
    [40, Math.round(horizon * 0.7)],
  ];
}

/* ---------- hit areas (the hub's cards) ---------- */

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
  canvas.dataset.layout = JSON.stringify({ W: screen.W, H: screen.H, scale: screen.scale, rects });
}

/* ---------- page hygiene and install ---------- */

/**
 * Nothing is stored (PLAN §2): remove every rlx.* key an earlier build left in
 * localStorage or sessionStorage. Run at every start, since a first run cannot
 * be told without storing something. Other apps on the same origin are left alone.
 */
export function clearStored() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const store = window[name];
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (k && k.startsWith('rlx.')) store.removeItem(k);
      }
    } catch (err) {
      /* storage unavailable: nothing to clear */
    }
  }
}

/** No long-press menu, no zoom, no selection; clear old keys; register the service worker. */
export function initPage() {
  clearStored();
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
