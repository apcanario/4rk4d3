// Stack simulation (PLAN §6d). A fixed 120 Hz step: the sliding block, the
// drop and its cut, the tower, the camera, the missed block plopping into the
// sea, and the pace. Pure data in, events out: this module never touches the
// DOM and imports nothing, so tests/stack-sim.mjs runs it in Node.
//
// Coordinates are logical px (PLAN §3), y down; the renderer rounds them.
// Floors are counted from the first floor (index 0, standing on the horizon)
// upward. Floor i has its bottom edge at horizon - i * blockH + cam, where cam
// is how far the camera has slid the tower down (animated toward
// shifts * blockH). Floors far below the sea are dropped from memory; base is
// the index of the lowest floor still kept.
//
// The session clock is not read here: callers pass slow, how far the dusk
// slowdown has gone (0 to 1, shared/session.js slowdownOf), so tests drive it.
// The play values come in as cfg from the CONFIG block at the top of stack.js.
//
// Pace (PLAN §2b, §6d): s.pace is the slide speed in px/s. A block takes its
// speed when it starts to slide (a new block, or the same block coming back
// after a miss); gains and losses apply from the next block. The ceiling is
// cfg.speedMax, falling to cfg.speedMin as slow goes 0 to 1, and a sliding
// block's speed (and the pace) follow it down at once, step by step.

export const STEP_HZ = 120;
export const DT = 1 / STEP_HZ;

// Step results, as bit flags.
export const EV_PLOP = 1; // the missed block reached the sea
export const EV_RETURN = 2; // the missed block is back, sliding again

/** The speed ceiling at a point of the dusk slowdown. */
export function ceilingOf(cfg, slow) {
  const t = slow > 0 ? (slow < 1 ? slow : 1) : 0;
  return cfg.speedMax - (cfg.speedMax - cfg.speedMin) * t;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** A fresh tower: the first floor, startW wide, centred on the horizon; a block sliding above it. */
export function create(geo, cfg) {
  const w = cfg.startW;
  const s = {
    W: geo.W,
    H: geo.H,
    horizon: geo.horizon,
    floors: [{ x: (geo.W - w) / 2, w }],
    base: 0,
    shifts: 0,
    cam: 0,
    pace: cfg.speedStart,
    block: null,
  };
  spawn(s, cfg, w, false, 0);
  return s;
}

/** Index of the top floor. */
export const topIndex = (s) => s.base + s.floors.length - 1;
export const topFloor = (s) => s.floors[s.floors.length - 1];

/** Top edge (y) of floor i with the camera at cam (default: where it is now). */
export function floorTop(s, cfg, i, cam = s.cam) {
  return s.horizon - (i + 1) * cfg.blockH + cam;
}

/** The block's top edge (y): at the height of the next floor, plus how far a missed block has fallen. */
export function blockTop(s, cfg) {
  const b = s.block;
  return floorTop(s, cfg, b.i) + (b.mode === 'slide' ? 0 : b.fallY);
}

/** The colour slot of floor i: the brick-row tokens cycle, one per floor. */
export const colourOf = (i, n) => ((i % n) + n) % n;

/** A clock reset: the pace starts again at speedStart. A block already sliding keeps its speed. */
export function resetPace(s, cfg) {
  s.pace = cfg.speedStart;
}

function startSlide(s, cfg, slow) {
  const b = s.block;
  const ceil = ceilingOf(cfg, slow);
  s.pace = clamp(s.pace, cfg.speedMin, ceil);
  b.speed = s.pace;
  b.mode = 'slide';
  b.fallY = 0;
  b.vy = 0;
  b.wait = 0;
  // Blocks start at a wall, alternating left and right floor by floor; the
  // same block coming back after a miss starts from the same wall.
  b.dir = b.i % 2 === 0 ? 1 : -1;
  b.x = b.dir > 0 ? 0 : s.W - b.w;
}

function spawn(s, cfg, w, fresh, slow) {
  s.block = { i: topIndex(s) + 1, w, fresh, x: 0, dir: 1, speed: 0, mode: 'slide', fallY: 0, vy: 0, wait: 0 };
  startSlide(s, cfg, slow);
}

/**
 * Tap: drop the sliding block. Returns null if no block is sliding, else
 * { kind, ratio, cut, floor }: kind is 'snap' (near-perfect), 'land',
 * 'fresh' (the 60 px block after a floor narrower than minFloorW, which lands
 * whole) or 'miss'; ratio is the overlap as a fraction of the block's width;
 * cut lists the overhang pieces that break off, each { x, w, i }.
 */
export function drop(s, cfg, slow) {
  const b = s.block;
  if (!b || b.mode !== 'slide') return null;
  const f = topFloor(s);
  const ceil = ceilingOf(cfg, slow);
  let kind;
  let ratio;
  let floor;
  const cut = [];
  if (b.fresh) {
    kind = 'fresh';
    ratio = 1;
    floor = { x: b.x, w: b.w };
  } else {
    const bc = b.x + b.w / 2;
    const fc = f.x + f.w / 2;
    const lo = Math.max(b.x, f.x);
    const hi = Math.min(b.x + b.w, f.x + f.w);
    if (Math.abs(bc - fc) <= cfg.snapPx) {
      kind = 'snap';
      ratio = 1;
      floor = { x: clamp(fc - b.w / 2, 0, s.W - b.w), w: b.w };
    } else if (hi - lo <= 0) {
      kind = 'miss';
      ratio = 0;
    } else {
      kind = 'land';
      ratio = (hi - lo) / b.w;
      floor = { x: lo, w: hi - lo };
      if (lo > b.x) cut.push({ x: b.x, w: lo - b.x, i: b.i });
      if (b.x + b.w > hi) cut.push({ x: hi, w: b.x + b.w - hi, i: b.i });
    }
  }
  // Pace: +gain at gainOverlap or more, -loss under lossOverlap or on a miss.
  // The fresh platform lands whole and leaves the pace as it is.
  if (kind !== 'fresh') {
    const d = ratio >= cfg.gainOverlap ? cfg.gain : ratio < cfg.lossOverlap ? -cfg.loss : 0;
    s.pace = clamp(s.pace + d, cfg.speedMin, ceil);
  }
  if (kind === 'miss') {
    // The block plops into the sea; the same block comes back (step()).
    b.mode = 'fall';
    b.fallY = 0;
    b.vy = 0;
    return { kind, ratio, cut, floor: null };
  }
  s.floors.push(floor);
  // The next block: the floor's width, 2 px wider after a near-perfect drop
  // (up to maxW), or a fresh maxW-wide platform after a floor narrower than minFloorW.
  let w = kind === 'snap' ? Math.min(cfg.maxW, b.w + cfg.regainPx) : floor.w;
  let fresh = false;
  if (floor.w < cfg.minFloorW) {
    w = cfg.resetW;
    fresh = true;
  }
  // Camera: once the top of the tower passes the middle of the screen, slide it down one floor.
  if (floorTop(s, cfg, topIndex(s), s.shifts * cfg.blockH) < s.H / 2) s.shifts++;
  trim(s, cfg);
  spawn(s, cfg, w, fresh, slow);
  return { kind, ratio, cut, floor: { ...floor } };
}

/** Forget floors that sit wholly a few floors under the bottom of the screen. */
function trim(s, cfg) {
  const target = s.shifts * cfg.blockH;
  while (s.floors.length > 1 && floorTop(s, cfg, s.base, Math.min(s.cam, target)) > s.H + cfg.blockH * 2) {
    s.floors.shift();
    s.base++;
  }
}

/** One fixed step. instantCam: the camera jumps (reduced motion). Returns EV_ flags. */
export function step(s, cfg, slow, instantCam = false) {
  let ev = 0;
  const target = s.shifts * cfg.blockH;
  if (instantCam) s.cam = target;
  else if (s.cam !== target) {
    const d = target - s.cam;
    const m = cfg.camSpeed * DT;
    s.cam = Math.abs(d) <= m ? target : s.cam + Math.sign(d) * m;
  }
  const b = s.block;
  if (b.mode === 'slide') {
    // The dusk ceiling: the speed follows it down while the block slides.
    const ceil = ceilingOf(cfg, slow);
    if (b.speed > ceil) b.speed = ceil;
    if (s.pace > ceil) s.pace = ceil;
    const max = s.W - b.w;
    b.x += b.dir * b.speed * DT;
    // From wall to wall and back.
    for (let k = 0; k < 4 && (b.x < 0 || b.x > max); k++) {
      if (b.x < 0) { b.x = -b.x; b.dir = 1; }
      if (b.x > max) { b.x = 2 * max - b.x; b.dir = -1; }
    }
    b.x = clamp(b.x, 0, Math.max(0, max));
  } else if (b.mode === 'fall') {
    b.vy += cfg.missGravity * DT;
    b.fallY += b.vy * DT;
    if (blockTop(s, cfg) >= s.horizon) {
      b.mode = 'gone';
      b.wait = cfg.returnS;
      ev |= EV_PLOP;
    }
  } else if (b.mode === 'gone') {
    b.wait -= DT;
    if (b.wait <= 0) {
      startSlide(s, cfg, slow);
      ev |= EV_RETURN;
    }
  }
  return ev;
}

/**
 * The screen changed size: keep the tower, keep its top at or below the
 * middle, snap the camera. Floors already forgotten cannot come back, so on a
 * taller screen the camera also slides down far enough that the lowest kept
 * floor still reaches the horizon: the tower never floats above the sea.
 */
export function resize(s, cfg, geo) {
  s.W = geo.W;
  s.H = geo.H;
  s.horizon = geo.horizon;
  const top = topIndex(s);
  let shifts = 0;
  while (floorTop(s, cfg, top, shifts * cfg.blockH) < s.H / 2) shifts++;
  while (floorTop(s, cfg, s.base, shifts * cfg.blockH) + cfg.blockH < s.horizon) shifts++;
  s.shifts = shifts;
  s.cam = shifts * cfg.blockH;
  const b = s.block;
  b.x = clamp(b.x, 0, Math.max(0, s.W - b.w));
  for (const f of s.floors) f.x = clamp(f.x, 0, Math.max(0, s.W - f.w));
  trim(s, cfg);
}
