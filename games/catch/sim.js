// Catch simulation (PLAN §6b). A fixed 120 Hz step: falling things, the boat,
// the nasty ones and the fish, the pace, the spawn timers and the variety.
// Pure data in, events out: this module never touches the DOM and imports
// nothing, so tests/catch-sim.mjs runs it in Node.
//
// Coordinates are logical px (PLAN §3), y down; the renderer rounds them. The
// state is a plain JSON-able object, held in memory only: nothing is saved
// (PLAN §2). Its caught and eaten counts drive the variety only; they start
// at 0 on every opening and are never shown or stored. The session clock is not
// read here: callers pass ease, how far the dusk slowdown has gone (0 to 1,
// shared/session.js slowdownOf), so tests drive it.
//
// Pace (PLAN §2b, §6b): s.pace, 0 to 1, sets the fall speed and the spawn gap
// of things spawned from then on; a thing in the air keeps the speed it was
// spawned with. The ceiling is 1, falling to 0 as ease goes 0 to 1.
//
// The input rules (tap, pause grace, resume) are here too, as a small state
// machine fed with times and logical positions, so they are tested headless.

export const STEP_HZ = 120;
export const DT = 1 / STEP_HZ;

export const ITEM = 7; // things to catch, and the treat
export const NASTY = 7;
export const BOAT_W = 24;
export const BOAT_H = 7;
export const DECK_ABOVE = 5; // the deck (hull top edge) sits this far above the horizon
export const FISH_W = 9; // horizontal; a leaping fish is FISH_H wide and FISH_W tall
export const FISH_H = 5;
export const FISH_DEPTH = 3; // a fish starts with its top this far below the horizon
export const KINDS = 8; // shell, starfish, pearl, bottle, coral sprig, sand dollar, seahorse, tiny sun
export const NASTY_KINDS = 3; // urchin, jellyfish, ink blob
export const SKY_EVENTS = Object.freeze(['gull', 'dolphin', 'glint']);
export const SKY_S = Object.freeze({ gull: 4, dolphin: 1.6, glint: 1 });
export const DIP_S = 0.1; // boat dips 1 px on a catch
export const ROCK_S = 1; // boat rocks after a nasty lands on it
export const INK_S = 4; // the sea stays dark this long...
export const INK_FADE_S = 0.6; // ...then fades in dither stages
export const SWAY_PERIOD_S = 2.4;
export const GRAVITY = 420; // fish arcs and hops, px/s^2
export const ARC_VX = 45;
export const ARC_VY = 60;
export const HOP_VY = 70;
export const MAX_FISH = 4;
const EPS = 1e-9;
const TAU = Math.PI * 2;

/* ---------- random: a seeded generator kept in the state ---------- */

function rand(s) {
  let t = (s.seed = (s.seed + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (s, a, b) => a + (b - a) * rand(s);
const pick = (s, n) => Math.min(n - 1, Math.floor(rand(s) * n));

function shuffled(s, n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = pick(s, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- geometry ---------- */

/** Play geometry: W wide, top of the open sky, horizon line. */
export function geometry(W, top, horizon) {
  return { W, top, horizon, deckY: horizon - DECK_ABOVE, fishY: horizon + FISH_DEPTH };
}

/* ---------- pace ---------- */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** The pace ceiling: 1, falling linearly to 0 as ease goes 0 to 1. */
export function ceilingOf(ease = 0) {
  return 1 - clamp01(ease || 0);
}

/** Fall speed for a pace, logical px per second. */
export function fallSpeed(cfg, pace) {
  return cfg.fallMin + (cfg.fallMax - cfg.fallMin) * clamp01(pace);
}

/** Spawn gap for a pace, seconds. */
export function spawnGap(cfg, pace) {
  return cfg.gapMax - (cfg.gapMax - cfg.gapMin) * clamp01(pace);
}

function setPace(s, v, ease) {
  s.pace = Math.max(0, Math.min(ceilingOf(ease), v));
}

/** The session clock was reset: the pace starts again. Things in the air keep their speed. */
export function resetPace(s, cfg) {
  s.pace = cfg.paceStart;
}

/** Fish kinds in the mix: kindsStart, one more every fishKindEvery nasties eaten, up to fishKindsMax. */
export function fishKinds(s, cfg) {
  return Math.min(cfg.fishKindsMax, cfg.fishKindsStart + Math.floor(s.eaten / cfg.fishKindEvery));
}

/* ---------- state ---------- */

export function create(geo, cfg, seed = 1) {
  const s = {
    geo: { ...geo },
    seed: (seed >>> 0) || 1,
    boatX: (geo.W - BOAT_W) / 2,
    items: [], // { x (sway centre line, left edge), y, vy, ph, k, low }
    nasty: null, // { x, y, vy, k, low, hunted }
    treat: null, // { x, y, vy, ph, k, low }
    fish: [], // { m: 'leap' | 'arc' | 'hop', cx, y, vx, vy, k }
    caught: 0, // things caught since this opening (drives the kinds; never shown)
    eaten: 0, // nasties eaten since this opening (drives the fish kinds; never shown)
    pace: cfg.paceStart,
    spawnIn: 0,
    nastyIn: 0,
    treatIn: 0,
    lastX: (geo.W - ITEM) / 2, // x of the previous normal item (nasty and treat spawns leave it)
    order: [],
    unlocked: cfg.kindsStart,
    kindCatches: 0, // catches since the last kind joined (or the last reshuffle)
    spawnIdx: 0,
    dip: 0,
    rock: 0,
    ink: 0,
    sky: null, // { k, t }
    time: 0,
  };
  s.order = shuffled(s, KINDS);
  s.spawnIn = spawnGap(cfg, s.pace);
  s.nastyIn = between(s, cfg.nastyMinS, cfg.nastyMaxS);
  s.treatIn = between(s, cfg.treatMinS, cfg.treatMaxS);
  return s;
}

/** Spawn x range for a sprite of width w that sways sway px either side. */
export function spawnRange(geo, cfg, w = ITEM) {
  return [cfg.swayPx, geo.W - w - cfg.swayPx];
}

// A random x no more than spawnSpreadPx from the previous normal item, inside
// the field. Only normal items move lastX, so consecutive items stay within
// spawnSpreadPx of each other whatever nasty or treat fell between them.
function nextX(s, cfg, item) {
  const [minX, maxX] = spawnRange(s.geo, cfg);
  const lo = Math.max(minX, s.lastX - cfg.spawnSpreadPx);
  const hi = Math.min(maxX, s.lastX + cfg.spawnSpreadPx);
  const x = lo + (hi - lo) * rand(s);
  if (item) s.lastX = x;
  return x;
}

function spawnItem(s, cfg) {
  const k = s.order[s.spawnIdx % s.unlocked];
  s.spawnIdx += 1;
  s.items.push({ x: nextX(s, cfg, true), y: s.geo.top, vy: fallSpeed(cfg, s.pace), ph: rand(s) * TAU, k, low: false });
}

function spawnNasty(s, cfg) {
  s.nasty = { x: nextX(s, cfg), y: s.geo.top, vy: cfg.nastySpeed, k: pick(s, NASTY_KINDS), low: false, hunted: false };
}

function spawnTreat(s, cfg) {
  s.treat = {
    x: nextX(s, cfg), y: s.geo.top, vy: cfg.treatSpeed, ph: rand(s) * TAU, k: s.order[pick(s, s.unlocked)], low: false,
  };
}

/** Drawn left edge of a swaying thing. */
export function swayX(o, cfg) {
  return o.x + (o.ph === undefined ? 0 : cfg.swayPx * Math.sin(o.ph));
}

const overBoat = (s, cx) => cx >= s.boatX - EPS && cx <= s.boatX + BOAT_W + EPS;

// Move a falling thing one step. Returns 'deck' (landed on the deck), 'water'
// (reached the sea) or null. A thing whose bottom passes the deck line away
// from the boat is low: it can then only reach the water.
function fall(s, o, w, h, cfg) {
  o.y += o.vy * DT;
  if (o.ph !== undefined) o.ph = (o.ph + (TAU / SWAY_PERIOD_S) * DT) % TAU;
  const bot = o.y + h;
  if (!o.low && bot >= s.geo.deckY) {
    if (overBoat(s, swayX(o, cfg) + w / 2)) return 'deck';
    o.low = true;
  }
  if (o.low && bot >= s.geo.horizon) return 'water';
  return null;
}

function caughtOne(s, cfg, ease, events, x, k, treat) {
  s.caught += 1;
  s.dip = DIP_S;
  setPace(s, s.pace + cfg.gainPerCatch, ease);
  events.push({ type: 'catch', x, k, treat: !!treat });
  s.kindCatches += 1;
  if (s.kindCatches >= cfg.kindEvery) {
    s.kindCatches = 0;
    if (s.unlocked < KINDS) s.unlocked += 1;
    else s.order = shuffled(s, KINDS);
    events.push({ type: 'kinds', unlocked: s.unlocked });
  }
}

/* ---------- fish ---------- */

function biteIfMet(s, f, events) {
  const n = s.nasty;
  if (!n || f.m !== 'leap') return false;
  f.cx = n.x + NASTY / 2;
  if (f.y > n.y + NASTY + EPS) return false;
  events.push({ type: 'bite', x: f.cx, y: n.y + NASTY });
  s.eaten += 1;
  s.nasty = null;
  // Arc over and dive back, toward the middle of the screen.
  f.m = 'arc';
  f.y = Math.min(f.y, n.y + NASTY);
  f.vx = f.cx < s.geo.W / 2 ? ARC_VX : -ARC_VX;
  f.vy = -ARC_VY;
  return true;
}

function moveFish(s, cfg, events) {
  for (const f of s.fish) {
    if (f.m === 'leap') {
      f.y -= cfg.fishSpeed * DT;
      if (!s.nasty) { f.m = 'arc'; f.vx = ARC_VX; f.vy = -ARC_VY; } // guard: a hunted nasty only leaves by a bite
      else biteIfMet(s, f, events);
    } else {
      f.vy += GRAVITY * DT;
      f.cx += f.vx * DT;
      f.y += f.vy * DT;
      if (f.vy > 0 && f.y >= s.geo.fishY) {
        f.done = true;
        if (f.m === 'arc') events.push({ type: 'dive', x: f.cx });
      }
    }
  }
  if (s.fish.some((f) => f.done)) s.fish = s.fish.filter((f) => !f.done);
}

/**
 * A tap (PLAN §6b The fish). With a nasty in the air that no fish is after,
 * a fish leaps from the sea directly below it; otherwise a small hop beside
 * the boat. Returns events: { type: 'leap' } | { type: 'hop' } | [].
 */
export function tap(s, cfg) {
  const n = s.nasty;
  const k = pick(s, fishKinds(s, cfg));
  if (n && !n.hunted) {
    n.hunted = true;
    s.fish.push({ m: 'leap', cx: n.x + NASTY / 2, y: s.geo.fishY, vx: 0, vy: -cfg.fishSpeed, k });
    return [{ type: 'leap', x: n.x + NASTY / 2 }];
  }
  // Hops stop one short of MAX_FISH, so a leap always has a slot.
  if (s.fish.length >= MAX_FISH - 1) return [];
  const right = s.boatX + BOAT_W + 6;
  const cx = right + FISH_W / 2 <= s.geo.W ? right : s.boatX - 6;
  s.fish.push({ m: 'hop', cx, y: s.geo.fishY, vx: 0, vy: -HOP_VY, k });
  return [{ type: 'hop', x: cx }];
}

/* ---------- step ---------- */

/**
 * Advance the game by one fixed step (DT). cfg: the tuning block of catch.js.
 * ease: how far the dusk slowdown has gone, 0 to 1. Returns events:
 * catch { x, k, treat } | miss { x } | bite { x, y } | dive { x } | nastyBoat |
 * nastyWater { x } | sky { k } | kinds { unlocked }.
 */
export function step(s, cfg, ease = 0) {
  const events = [];
  setPace(s, s.pace, ease); // the pace follows the falling ceiling down

  // Timers count active play only (this runs only while playing).
  s.spawnIn -= DT;
  s.nastyIn -= DT;
  s.treatIn -= DT;
  if (s.nastyIn <= EPS && !s.nasty) {
    // A nasty takes the place of a normal spawn: the spawn gap starts again.
    spawnNasty(s, cfg);
    s.nastyIn = between(s, cfg.nastyMinS, cfg.nastyMaxS);
    s.spawnIn = spawnGap(cfg, s.pace);
  } else if (s.spawnIn <= EPS) {
    if (s.items.length < cfg.maxItems) {
      spawnItem(s, cfg);
      s.spawnIn = spawnGap(cfg, s.pace);
    } else {
      s.spawnIn = 0; // waits for a free slot
    }
  }
  if (s.nastyIn < 0) s.nastyIn = 0; // due while one is in the air: next free moment
  if (s.treatIn <= EPS) {
    if (!s.treat) {
      spawnTreat(s, cfg);
      s.treatIn = between(s, cfg.treatMinS, cfg.treatMaxS);
    } else {
      s.treatIn = 0;
    }
  }

  // Fish first, so a fish that reaches the nasty this step bites it.
  moveFish(s, cfg, events);

  const n = s.nasty;
  if (n) {
    if (n.hunted) {
      // A fish is on its way: the nasty keeps falling but never lands; the
      // fish (220 px/s from just under the surface) is at most a few
      // frames from it when it nears the deck or the water.
      n.y += n.vy * DT;
      let bot = n.y + NASTY;
      if (!n.low && bot >= s.geo.deckY) {
        if (overBoat(s, n.x + NASTY / 2)) bot = Math.min(bot, s.geo.deckY - 0.01);
        else n.low = true;
      }
      if (n.low) bot = Math.min(bot, s.geo.horizon - 0.01);
      n.y = bot - NASTY;
      for (const f of s.fish) if (f.m === 'leap' && biteIfMet(s, f, events)) break;
    } else {
      const where = fall(s, n, NASTY, NASTY, cfg);
      if (where === 'deck') {
        s.nasty = null;
        s.rock = ROCK_S;
        events.push({ type: 'nastyBoat' });
      } else if (where === 'water') {
        s.nasty = null;
        s.ink = INK_S + INK_FADE_S;
        events.push({ type: 'nastyWater', x: n.x + NASTY / 2 });
      }
    }
  }

  const kept = [];
  for (const it of s.items) {
    const where = fall(s, it, ITEM, ITEM, cfg);
    if (where === 'deck') caughtOne(s, cfg, ease, events, swayX(it, cfg) + ITEM / 2, it.k, false);
    else if (where === 'water') {
      setPace(s, s.pace - cfg.lossPerMiss, ease);
      events.push({ type: 'miss', x: swayX(it, cfg) + ITEM / 2 });
    } else kept.push(it);
  }
  s.items = kept;

  if (s.treat) {
    const t = s.treat;
    const where = fall(s, t, ITEM, ITEM, cfg);
    if (where === 'deck') {
      s.treat = null;
      caughtOne(s, cfg, ease, events, swayX(t, cfg) + ITEM / 2, t.k, true);
      s.sky = { k: SKY_EVENTS[pick(s, SKY_EVENTS.length)], t: 0 };
      events.push({ type: 'sky', k: s.sky.k });
    } else if (where === 'water') {
      s.treat = null; // missing it does nothing
    }
  }

  s.dip = Math.max(0, s.dip - DT);
  s.rock = Math.max(0, s.rock - DT);
  s.ink = Math.max(0, s.ink - DT);
  if (s.sky && (s.sky.t += DT) >= SKY_S[s.sky.k]) s.sky = null;
  s.time += DT;
  return events;
}

/** Move the boat by dx logical px, clamped to the field. */
export function moveBoat(s, dx) {
  s.boatX = Math.max(0, Math.min(s.geo.W - BOAT_W, s.boatX + dx));
}

/* ---------- geometry change ---------- */

/** Re-fit to a new screen geometry (same width): the sky is stretched, the sea moves with the horizon. */
export function setGeometry(s, geo) {
  const o = s.geo;
  if (o.top === geo.top && o.horizon === geo.horizon && o.W === geo.W) return;
  const map = (y, h) => {
    const f = (y - o.top) / Math.max(1, o.horizon - h - o.top);
    return geo.top + Math.max(0, Math.min(1, f)) * Math.max(0, geo.horizon - h - geo.top);
  };
  for (const it of s.items) it.y = map(it.y, ITEM);
  if (s.nasty) s.nasty.y = map(s.nasty.y, NASTY);
  if (s.treat) s.treat.y = map(s.treat.y, ITEM);
  for (const f of s.fish) f.y += geo.horizon - o.horizon;
  s.geo = { ...geo };
  // Re-derive low against the new deck line.
  for (const t of [...s.items, s.nasty, s.treat]) if (t) t.low = t.low && t.y + ITEM >= s.geo.deckY;
}

/* ---------- input: tap, pause grace and resume (PLAN §6b The fish, Pause) ---------- */

/**
 * The input state machine. Times in ms (any monotonic clock), positions in
 * logical px. mode: 'paused' | 'resuming' | 'running'. While running with no
 * finger down, graceEnd is when play pauses.
 */
export function createControl() {
  return { mode: 'paused', resumeAt: 0, graceEnd: null, pointers: new Map(), driver: null };
}

/** Finger down. A touch that starts while paused or resuming is never a tap. */
export function ctlDown(c, id, t, x, y, cfg) {
  c.pointers.set(id, { t0: t, x0: x, y0: y, lastX: x, moved: 0, tap: c.mode === 'running' });
  if (c.driver === null) c.driver = id;
  c.graceEnd = null;
  if (c.mode === 'paused') {
    c.mode = 'resuming';
    c.resumeAt = t + cfg.resumeDelayMs;
  }
}

/** Finger moved. Returns the boat movement (the first finger down drives it). */
export function ctlMove(c, id, x, y, cfg) {
  const p = c.pointers.get(id);
  if (!p) return 0;
  p.moved = Math.max(p.moved, Math.hypot(x - p.x0, y - p.y0));
  const dx = x - p.lastX;
  p.lastX = x;
  return id === c.driver ? dx * cfg.sensitivity : 0;
}

/**
 * Finger up (cancelled: pointercancel). Returns true if it was a tap: down
 * and up within tapMs, moved less than tapMovePx, and down while running.
 * The last finger up starts the pause grace; lifted while resuming, the game
 * stays paused.
 */
export function ctlUp(c, id, t, cfg, cancelled = false) {
  const p = c.pointers.get(id);
  if (!p) return false;
  c.pointers.delete(id);
  if (id === c.driver) c.driver = c.pointers.size ? c.pointers.keys().next().value : null;
  const isTap = !cancelled && p.tap && c.mode === 'running' && t - p.t0 <= cfg.tapMs && p.moved < cfg.tapMovePx;
  if (c.pointers.size === 0) {
    if (c.mode === 'running') c.graceEnd = t + cfg.graceMs;
    else c.mode = 'paused';
  }
  return isTap;
}

/** Advance the control to time t. Returns 'start' (play begins), 'pause' (grace over) or null. */
export function ctlTick(c, t) {
  if (c.mode === 'resuming' && t >= c.resumeAt) {
    c.mode = 'running';
    return 'start';
  }
  if (c.mode === 'running' && c.pointers.size === 0 && c.graceEnd !== null && t >= c.graceEnd) {
    c.mode = 'paused';
    c.graceEnd = null;
    return 'pause';
  }
  return null;
}

/** Page hidden or closed: everything lifts, paused at once. */
export function ctlSleep(c) {
  c.pointers.clear();
  c.driver = null;
  c.graceEnd = null;
  c.mode = 'paused';
}

/* ---------- the look: sprite masks and colour names (data only) ---------- */

// Colour names resolve to tokens in catch.js and tests/catch-sim.mjs:
// 'row<N>' is BRICK_ROWS[N], 'coral', 'blue' and 'sun' are COLORS. In a mask
// '#' is the body, 'h' its highlight, 's' its shade, 'c' cream (the sun
// token), '.' empty. Things to catch and fish get a 1 px outline all round
// (spriteGrid), drawn in the body's edge colour (tokens.js edge(), B4), so
// their edge reads on every scene step; the nasty ones are drawn bare, spiky or ragged, in the blue token
// with its shade inside (PLAN §6b: shape carries the difference).
export const LOOK = Object.freeze({
  items: Object.freeze([
    { name: 'shell', colour: 'row4', mask: ['.###.', '#h#h#', '#####', '.###.', '..#..'] },
    { name: 'starfish', colour: 'row2', mask: ['..#..', '.###.', '##h##', '.###.', '.#.#.'] },
    { name: 'pearl', colour: 'row6', mask: ['.###.', '#cc##', '#c###', '#####', '.###.'] },
    { name: 'bottle', colour: 'row3', mask: ['..#..', '..#..', '.###.', '.#c#.', '.###.'] },
    { name: 'coral sprig', colour: 'coral', mask: ['#.#.#', '#.#.#', '.###.', '..#..', '.###.'] },
    { name: 'sand dollar', colour: 'row1', mask: ['.###.', '##h##', '#h#h#', '##h##', '.###.'] },
    { name: 'seahorse', colour: 'row5', mask: ['.##..', '#h##.', '..##.', '.##..', '.#...'] },
    { name: 'tiny sun', colour: 'sun', mask: ['..#..', '.###.', '#####', '.###.', '..#..'] },
  ]),
  nasties: Object.freeze([
    { name: 'sea urchin', colour: 'blue', mask: ['#..#..#', '.#####.', '.#sss#.', '###s###', '.#sss#.', '.#####.', '#..#..#'] },
    { name: 'jellyfish', colour: 'blue', mask: ['.#####.', '#######', '#s#s#s#', '#######', '#.#.#.#', '.#.#.#.', '#.#.#..'] },
    { name: 'ink blob', colour: 'blue', mask: ['.#.#.#.', '#######', '.##s##.', '###s###', '.#####.', '#.###.#', '.#.#.#.'] },
  ]),
  // Facing right; drawn flipped when swimming left and turned head-up when leaping.
  fish: Object.freeze({ mask: ['#.####.', '#####s#', '#.####.'], colours: ['coral', 'row1', 'row2', 'row4', 'row5', 'row3'] }),
  treatCanopy: 'coral',
});

/** A mask as a grid of keys; with outline, grown by 1 px all round, 'o' on every empty cell touching the body. */
export function spriteGrid(mask, outline) {
  if (!outline) return mask.slice();
  const h = mask.length + 2;
  const w = mask[0].length + 2;
  const at = (r, c) => (r >= 1 && r <= mask.length && c >= 1 && c <= mask[0].length ? mask[r - 1][c - 1] : '.');
  const rows = [];
  for (let r = 0; r < h; r++) {
    let row = '';
    for (let c = 0; c < w; c++) {
      const k = at(r, c);
      if (k !== '.') row += k;
      else row += [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].some((n) => n !== '.') ? 'o' : '.';
    }
    rows.push(row);
  }
  return rows;
}

/** A grid turned so its right edge points up. */
export function turnUp(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const out = [];
  for (let r = 0; r < w; r++) {
    let row = '';
    for (let c = 0; c < h; c++) row += grid[c][w - 1 - r];
    out.push(row);
  }
  return out;
}

/** Keys of the cells on a grid's edge: drawn cells next to an empty cell or the border. */
export function edgeKeys(grid) {
  const keys = new Set();
  const empty = (r, c) => r < 0 || r >= grid.length || c < 0 || c >= grid[0].length || grid[r][c] === '.';
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      if (grid[r][c] === '.') continue;
      if (empty(r - 1, c) || empty(r + 1, c) || empty(r, c - 1) || empty(r, c + 1)) keys.add(grid[r][c]);
    }
  }
  return keys;
}
