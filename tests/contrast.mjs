// Colour measures for the readability checks (row B4 contrast pass), shared by
// tests/bricks-sim.mjs, tests/catch-sim.mjs, tests/putt-sim.mjs and
// tests/stack-sim.mjs (Putt: both level looks, sand and sea, row U2); tests/check.py has the same in
// Python. Not shipped.
//
// The standard (docs/CHANGELOG.md, 2026-11-25, B4):
// (a) lettering, the ball, the paddle, the boat hull, keel and mast and every
//     control: WCAG 2 contrast ratio >= 3 against every scene colour behind
//     it, at sunset and all 10 steps; small lettering (size 1) >= 4.5. A shape
//     or control passes a background when its fill or its 1 px edge all round
//     clears it; small lettering is measured on its glyph colour alone, or,
//     when outlined (the hub's tile labels, gone since row H2), against its
//     outline. The hub's card frames and the pieces in its cards are measured
//     in tests/check.py with the same rules. The hull's rows
//     below the horizon are drawn in the keel colour and measured against
//     the sea.
// (b) bricks, Stack's floors and overhang bits (fill or their 1 px edge in
//     edge()), things to catch, nasty ones, fish, sail and jib, and the
//     effects named in the B4 review (the sky-event glint, the spray under a
//     leaping fish, the ink cloud against the sea it darkens): CIE76 delta E
//     >= 20 against every scene colour behind them, fill or 1 px outline.
//     Brick fills alone (bricks have no outline). The sail's fill alone too.
// (c) the nine brick colours pairwise delta E >= 8.

export const MIN_CR = 3;
export const MIN_CR_SMALL = 4.5;
export const MIN_DE = 20;
export const MIN_DE_BRICKS = 8;

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/** WCAG 2 relative luminance. */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** CIELAB (D65). */
export function lab(hex) {
  const [r, g, b] = rgb(hex).map(lin);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

/** CIE76 colour difference. */
export function deltaE(a, b) {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * Collects measured pairs. add(what, rule, fill, edge, on, bg, where):
 * rule is 'cr' (needs MIN_CR), 'cr-small' (MIN_CR_SMALL, glyph only) or 'de'
 * (MIN_DE); edge may be null. A pair's value is the better of fill and edge.
 */
export function pairs() {
  const rows = [];
  return {
    rows,
    add(what, rule, fill, edge, on, bg, where) {
      const m = rule === 'de' ? deltaE : contrast;
      const f = m(fill, bg);
      const e = edge ? m(edge, bg) : 0;
      const need = rule === 'de' ? MIN_DE : rule === 'cr-small' ? MIN_CR_SMALL : MIN_CR;
      rows.push({ what, rule, fill, edge, on, bg, ...where, f, e, v: Math.max(f, e), need, ok: Math.max(f, e) >= need });
    },
  };
}

export const worst = (rows) => rows.reduce((a, b) => (b.v / b.need < a.v / a.need ? b : a));
export const fmt = (r) => `${r.what} ${r.fill}${r.edge ? `/${r.edge}` : ''} on ${r.on} ${r.bg}, step ${r.k}, ${r.tag}: `
  + `${r.rule === 'de' ? 'dE' : 'CR'} ${r.v.toFixed(2)} (need ${r.need})`;
