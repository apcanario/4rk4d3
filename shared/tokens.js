// RLX design tokens (PLAN §3, with the B4 contrast pass: see docs/CHANGELOG.md,
// 2026-11-25, for the values changed from PLAN §3; and the dark theme of row
// D1, PLAN §3 "Dark theme" and §6g). Mirrored in shared/theme.css; keep both
// in step. No page or game has colour literals.
//
// Two sets, LIGHT and DARK. The phone's prefers-color-scheme picks one (row
// D1: no toggle, nothing stored); tokens() returns it. COLORS, DUSK,
// BRICK_ROWS and SEA_BANDS read the active set at the moment they are read,
// and shade(), highlight(), edge() and scenePalette() mix inside it, so a page
// that draws from them follows a switch on its next frame. A page that keeps
// colours of its own (a sprite, a cached background) rebuilds them on
// onThemeChange().

export const LOGICAL_WIDTH = 135;

const LIGHT_COLORS = Object.freeze({
  skyTop: '#FFF7EC',
  skyBottom: '#FFCDC0',
  coral: '#F05A68', // paddle, hull, hub card frames (each with its edge all round)
  blue: '#436495', // ball, nasty ones (B4: was #4A6FA5)
  ink: '#30486B', // small lettering, control edges on the sea (B4: new, the blue deepened)
  card: '#A0D0E8', // the value of brick row 9; drew the back control and SOON tag, both gone since X1 (kept, unused)
  sail: '#A0D0E8', // the sail (B4: was the sun token, the same colour as the sun)
  keel: '#241E38', // the hull's rows below the horizon, the hub cards' outer edge, Putt's hole (B4 review: a deep plum that clears every sea band)
  glint: '#FFA2CE', // the sky-event glint and the spray under a leaping fish (B4 review: was white; brick row 7's pink)
  inkCloud: '#483080', // the ink cloud, mixed INK_CLOUD_AMOUNT into the sea (B4 review: was the blue's shade at 0.35)
  sun: '#FFF4D6', // the sun; in dark, the moon
  cloud: '#FFFFFF',
  white: '#FFFFFF', // D1: splash and spray tops, Catch's bite bits, Putt's pull ring and the hole rim's mix (they drew the cloud token, white in light)
  shadeTarget: '#783C5A', // shade() mixes toward it; also Putt's trap dots and drop shade
  edgeTarget: '#783C5A', // D1: edge() mixes toward it (in light the same as shadeTarget, as before)
  star: '#FFFFFF',
  sand: '#FFE6D2', // D1: new, for rows U2 and A1; U2: Putt's sand ground and its sandbanks
  wetSand: '#FFCFBA', // D1: new, for rows U2 and A1; U2: the sandbanks' bottom row
  foam: '#FFFAF3', // D1: new, foam and lines for rows U2 and A1; U2: the sandbanks' pale edge, the ball on a sea level
  shallow: '#84C4DE', // U2: Putt's sea-level ground (the shallow sea), at sunset
  deep: '#3A5A8C', // U2: deep water on a sea level
  trapTint: '#FFA38C', // U2: a sand-level trap is the ground mixed SAND_TRAP_AMOUNT toward it (brick row 4's peach)
  sandWall: '#F4A98C', // A1: Glide's darker sand band along the walls, and its sandcastles
  courtLine: '#F4A98C', // A1: Glide's dashed centre line and circle
});

// The same beach at night (PLAN §3 Dark theme). Values moved from the §3
// starting values by the contrast check are listed in PLAN §6g.
const DARK_COLORS = Object.freeze({
  skyTop: '#141026',
  skyBottom: '#3A2152',
  coral: '#FF7385',
  blue: '#6C8AB1', // §3 #8FB8E8, moved 0.26 toward #0A0714: the ball clears the moon, a cloud and Putt's sand and trap
  ink: '#CDD6FF',
  card: '#A0D0E8', // derived: brick row 9, as in light (unused)
  sail: '#A0D0E8', // derived: unchanged, it clears the night sky
  keel: '#8B898F', // §3 #0A0714, moved 0.525 toward white: the hull's rows below the horizon clear the night sea (and Putt's hole its sand)
  glint: '#FFA2CE',
  inkCloud: '#4F2A8F', // derived: the light #483080 moved 0.12 toward #8000FF, so the inked night sea differs from it by delta E 20
  sun: '#FFE9C9', // the moon
  cloud: '#463566', // §3 #4C3A6E, moved 0.09 toward #0A0714: the ball clears a cloud as well as the moon
  white: '#FFFFFF',
  shadeTarget: '#0A0714',
  edgeTarget: '#0A0714', // PLAN §3 offered #0A0714 or white per piece: every piece's fill clears the night ground, so the edge is picked for the light grounds (the moon, the next floor)
  star: '#FFFFFF',
  sand: '#2B2142',
  wetSand: '#3B2C58',
  foam: '#CDD6FF',
  shallow: '#24406B', // U2: sea band 1's night value
  deep: '#05060D', // U2: near black, so it clears the night sea by delta E 20 at dusk
  trapTint: '#7A1E3A', // U2: a deep rust, so the trap stays dark enough for the ball and hole yet differs from the night sand
  sandWall: '#56437F', // A1: a lighter violet than the night sand (the band and the castles differ from it by delta E 20)
  courtLine: '#CDD6FF', // A1: the night lines, as foam (PLAN §3: foam and lines #CDD6FF)
});

// Dusk (PLAN §2b): the end of the exit ramp. Bricks, paddle, ball and
// lettering keep their colours; only the sky, the sea and the sun change.
const LIGHT_DUSK = Object.freeze({
  skyTop: '#CDB8E0',
  skyBottom: '#F0A9A6',
  seaBands: Object.freeze(['#6FA3C4', '#5F93B8', '#5083AB']),
  sand: '#E6CBD8', // U2: Putt's sand ground at dusk
  shallow: '#A6BCDD', // U2: Putt's sea-level ground at dusk (stays light: the pale ball's coral edge needs a light ground)
});
const DARK_DUSK = Object.freeze({
  skyTop: '#0C0918',
  skyBottom: '#241436',
  seaBands: Object.freeze(['#1A2F52', '#162849', '#132140']),
  sand: '#1E1730', // U2
  shallow: '#1A2F52', // U2: sea band 1's dark dusk value
});

// Brick rows, top to bottom (dark: unchanged, PLAN §3).
const LIGHT_BRICKS = Object.freeze([
  '#F05A68', '#F77476', '#FF8C7A', '#FFA38C', '#FF96B2',
  '#F57DA8', '#FFA2CE', '#78B4D8', '#A0D0E8',
]);
const DARK_BRICKS = LIGHT_BRICKS;

// Sea bands, horizon down.
const LIGHT_SEA = Object.freeze(['#96D0E6', '#84C4DE', '#74B8D6']);
const DARK_SEA = Object.freeze(['#24406B', '#1F3760', '#1C2F55']);

export const SKY_BANDS = 10;
export const SHADE_AMOUNT = 0.38; // 35 to 40 percent toward shadeTarget (both themes)
export const HIGHLIGHT_AMOUNT = 0.48; // light: 45 to 50 percent toward white
export const HIGHLIGHT_AMOUNT_DARK = 0.24; // dark: about half the light amount (PLAN §3)
export const EDGE_AMOUNT = 0.7; // B4: the 1 px edge drawn all round a shape, 70 percent toward edgeTarget (both themes)
export const LINE_AMOUNT_DARK = 0.25; // D1: dark only, a 1 px line drawn in a piece's edge colour (the mast, the flag pole) mixes this far toward edgeTarget
export const TRAP_AMOUNT = 0.55; // Putt's sand traps: the sand mixed this far toward brick row 4's peach (light)
export const TRAP_AMOUNT_DARK = 0.22; // D1: in dark, so the ball clears the trap and the trap still differs from the sand by delta E 20
export const SAND_TRAP_AMOUNT = 0.75; // U2: Putt's sand-level trap, the ground mixed this far toward COLORS.trapTint (light)
export const SAND_TRAP_AMOUNT_DARK = 0.65; // U2: the same in dark
export const POOL_LIFT_DARK = 0.3; // U2: in dark a sand-level pool is sea band 2 mixed this far toward foam, so it clears the night sand (light: 0)
export const REEF_AMOUNT = 0.55; // U2: a reef on a sea level is the ground mixed this far toward brick row 7 (light)
export const REEF_AMOUNT_DARK = 0.35; // U2: the same in dark
export const DECOR_AMOUNT = 0.2; // A1: Glide's starfish are the sand mixed this far toward their pink or blue (light), so every tracked piece clears them
export const DECOR_AMOUNT_DARK = 0.3; // A1: the same in dark
export const INLET_LIFT = 0.46; // A1c: Glide's inlet is sea band 3 mixed this far toward foam (light), so the shell's edge clears it (WCAG 3) at every step
export const INLET_LIFT_DARK = 0; // A1c: dark keeps sea band 3 (the shell's face clears it by 13.2)
export const INK_CLOUD_AMOUNT = 0.45; // B4 review: how far the ink cloud mixes each sea band toward COLORS.inkCloud (both themes)

export const LIGHT = Object.freeze({
  name: 'light', COLORS: LIGHT_COLORS, DUSK: LIGHT_DUSK, BRICK_ROWS: LIGHT_BRICKS, SEA_BANDS: LIGHT_SEA,
  highlightAmount: HIGHLIGHT_AMOUNT, lineAmount: EDGE_AMOUNT, trapAmount: TRAP_AMOUNT,
  sandTrapAmount: SAND_TRAP_AMOUNT, poolLift: 0, reefAmount: REEF_AMOUNT, decorAmount: DECOR_AMOUNT,
  inletLift: INLET_LIFT,
});
export const DARK = Object.freeze({
  name: 'dark', COLORS: DARK_COLORS, DUSK: DARK_DUSK, BRICK_ROWS: DARK_BRICKS, SEA_BANDS: DARK_SEA,
  highlightAmount: HIGHLIGHT_AMOUNT_DARK, lineAmount: LINE_AMOUNT_DARK, trapAmount: TRAP_AMOUNT_DARK,
  sandTrapAmount: SAND_TRAP_AMOUNT_DARK, poolLift: POOL_LIFT_DARK, reefAmount: REEF_AMOUNT_DARK, decorAmount: DECOR_AMOUNT_DARK,
  inletLift: INLET_LIFT_DARK,
});

/* ---------- the active set: the phone's colour scheme ---------- */

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
let detected = query && query.matches ? DARK : LIGHT;
let forced = null;
const listeners = new Set();

function changed() {
  for (const fn of listeners) {
    try { fn(tokens()); } catch (err) { /* one page's redraw never stops another's */ }
  }
}

if (query) {
  const onChange = () => {
    const now = query.matches ? DARK : LIGHT;
    if (now === detected) return;
    detected = now;
    if (!forced) changed();
  };
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
  else if (typeof query.addListener === 'function') query.addListener(onChange);
}

/** The active token set: DARK when the phone is in dark mode, LIGHT otherwise. */
export function tokens() {
  return forced || detected;
}

/** Call fn(set) whenever the active set changes (the phone switched mode). Returns a function that stops it. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only (the Node checks have no colour scheme): make set the active one, or null to follow the phone again. No page calls it. */
export function forceTheme(set) {
  const before = tokens();
  forced = set || null;
  if (tokens() !== before) changed();
}

// Views of the active set, read when used.
function liveObject(pick) {
  const out = {};
  for (const k of Object.keys(pick(LIGHT))) Object.defineProperty(out, k, { enumerable: true, get: () => pick(tokens())[k] });
  return Object.freeze(out);
}

function liveList(pick) {
  return new Proxy([], {
    get(_, p) {
      const a = pick(tokens());
      const v = a[p];
      return typeof v === 'function' ? v.bind(a) : v;
    },
    has: (_, p) => p in pick(tokens()),
    ownKeys: () => Reflect.ownKeys(pick(tokens())),
    getOwnPropertyDescriptor(_, p) {
      const d = Reflect.getOwnPropertyDescriptor(pick(tokens()), p);
      if (!d) return undefined;
      return p === 'length' ? { value: d.value, writable: true, enumerable: false, configurable: false }
        : { value: d.value, writable: false, enumerable: d.enumerable, configurable: true };
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}

export const COLORS = liveObject((s) => s.COLORS);
export const DUSK = liveObject((s) => s.DUSK);
export const BRICK_ROWS = liveList((s) => s.BRICK_ROWS);
export const SEA_BANDS = liveList((s) => s.SEA_BANDS);

/* ---------- mixes ---------- */

function parse(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Mix colour a toward colour b by t (0..1). */
export function mix(a, b, t) {
  const pa = parse(a);
  const pb = parse(b);
  return toHex(pa.map((v, i) => v + (pb[i] - v) * t));
}

const setOf = (s) => (s && s.COLORS ? s : tokens());

export const shade = (c, set) => mix(c, setOf(set).COLORS.shadeTarget, SHADE_AMOUNT);
export const highlight = (c, set) => mix(c, setOf(set).COLORS.white, setOf(set).highlightAmount);
/** The 1 px edge all round a shape (B4): deep enough to stand off every scene colour (pale in dark, on the night ground). */
export const edge = (c, set) => mix(c, setOf(set).COLORS.edgeTarget, EDGE_AMOUNT);
/**
 * A 1 px line drawn in a piece's edge colour on its own (the mast, Putt's flag
 * pole): in light the edge itself; in dark a lighter mix, so the line clears
 * both the night sky and the moon (row D1).
 */
export const line = (c, set) => mix(c, setOf(set).COLORS.edgeTarget, setOf(set).lineAmount);
/** Putt's sand trap colour on a sand colour (both themes; the amount is the set's). */
export const trapOn = (sand, set) => mix(sand, setOf(set).BRICK_ROWS[3], setOf(set).trapAmount);

/**
 * Row U2: Putt's level colours at mix t (0 sunset .. 1 dusk) in the active set
 * (or set), for a look, 'sand' or 'sea'. Only Putt reads them; nothing else in
 * shared/ changes. Each value is a flat mix between its sunset and dusk token,
 * as in scenePalette.
 */
export function puttGround(look, t, set) {
  const s = setOf(set);
  const pal = scenePalette(t, s);
  if (look === 'sea') {
    const ground = mix(s.COLORS.shallow, s.DUSK.shallow, t);
    return { ground, reef: mix(ground, s.BRICK_ROWS[6], s.reefAmount), reefBlob: s.BRICK_ROWS[6], deep: s.COLORS.deep };
  }
  const ground = mix(s.COLORS.sand, s.DUSK.sand, t);
  return { ground, trap: mix(ground, s.COLORS.trapTint, s.sandTrapAmount), pool: mix(pal.sea[1], s.COLORS.foam, s.poolLift) };
}

/**
 * Scene colours at mix t (0 sunset .. 1 dusk) in the active set (or set):
 * every value a flat mix between its sunset and dusk token (PLAN §2b).
 * pixel.js passes t = step / steps.
 */
export function scenePalette(t, set) {
  const s = setOf(set);
  const skyTop = mix(s.COLORS.skyTop, s.DUSK.skyTop, t);
  const skyBottom = mix(s.COLORS.skyBottom, s.DUSK.skyBottom, t);
  const sky = [];
  for (let i = 0; i < SKY_BANDS; i++) sky.push(mix(skyTop, skyBottom, i / (SKY_BANDS - 1)));
  const sea = s.SEA_BANDS.map((c, i) => mix(c, s.DUSK.seaBands[i], t));
  return { sky, sea };
}
