// RLX design tokens (PLAN §3). Mirrored in shared/theme.css; keep both in step.

export const LOGICAL_WIDTH = 135;

export const COLORS = Object.freeze({
  skyTop: '#FFF7EC',
  skyBottom: '#FFCDC0',
  coral: '#F05A68', // paddle, wordmark
  blue: '#4A6FA5', // ball, score
  sun: '#FFF4D6',
  cloud: '#FFFFFF',
  shadeTarget: '#783C5A',
});

// Brick rows, top to bottom.
export const BRICK_ROWS = Object.freeze([
  '#F05A68', '#F77476', '#FF8C7A', '#FFA38C', '#FF96B2',
  '#F57DA8', '#FFB2C4', '#78B4D8', '#A0D0E8',
]);

// Sea bands, horizon down.
export const SEA_BANDS = Object.freeze(['#96D0E6', '#84C4DE', '#74B8D6']);

export const SKY_BANDS = 10;
export const SHADE_AMOUNT = 0.38; // 35 to 40 percent toward #783C5A
export const HIGHLIGHT_AMOUNT = 0.48; // 45 to 50 percent toward white

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

export const shade = (c) => mix(c, COLORS.shadeTarget, SHADE_AMOUNT);
export const highlight = (c) => mix(c, '#FFFFFF', HIGHLIGHT_AMOUNT);
