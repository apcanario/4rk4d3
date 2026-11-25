// RLX pixel font (PLAN §3 Lettering): one hand-drawn rounded pixel face,
// capitals and digits, drawn on canvas at integer sizes. No web fonts.
// Glyphs are 7 rows high; '#' is ink. Outer corners are cut to round them.
// tools/make-icons.py reads this table too, so keep the format: 'K': [rows].

export const GLYPH_HEIGHT = 7;
export const LETTER_SPACING = 1;

export const GLYPHS = {
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'D': ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  'E': ['.####', '#....', '#....', '####.', '#....', '#....', '.####'],
  'F': ['.####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  'J': ['..###', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '.####'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '-': ['....', '....', '....', '####', '....', '....', '....'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

function glyph(ch) {
  return GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS[' '];
}

/** Width in logical px of text drawn at integer size. */
export function measure(text, size = 1) {
  if (!text.length) return 0;
  let w = 0;
  for (const ch of text) w += glyph(ch)[0].length + LETTER_SPACING;
  return (w - LETTER_SPACING) * size;
}

export function textHeight(size = 1) {
  return GLYPH_HEIGHT * size;
}

/**
 * Largest integer size at which text fits inside boxW x boxH (PLAN §2: text
 * never wraps or overflows). Returns 0 if it cannot fit even at size 1.
 */
export function fitSize(text, boxW, boxH, maxSize = 16) {
  for (let s = maxSize; s >= 1; s--) {
    if (measure(text, s) <= boxW && textHeight(s) <= boxH) return s;
  }
  return 0;
}

/** Draw text with its top-left at (x, y). Coordinates are rounded. */
export function drawText(ctx, text, x, y, size, color) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of text) {
    const rows = glyph(ch);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      let c = 0;
      while (c < row.length) {
        if (row[c] !== '#') { c++; continue; }
        let end = c;
        while (end < row.length && row[end] === '#') end++;
        ctx.fillRect(cx + c * size, cy + r * size, (end - c) * size, size);
        c = end;
      }
    }
    cx += (rows[0].length + LETTER_SPACING) * size;
  }
}

/**
 * Fit text into a box and draw it. align: 'left' | 'center' | 'right'.
 * Vertically centred. Returns the size used (0 means it was not drawn).
 */
export function drawFitted(ctx, text, box, color, { align = 'center', maxSize = 16, shadow = null } = {}) {
  // A 1 px drop shade counts toward the height, so it never leaves the box.
  const extra = shadow ? 1 : 0;
  const size = fitSize(text, box.w, box.h - extra, maxSize);
  if (!size) return 0;
  const w = measure(text, size);
  const h = textHeight(size) + extra;
  let x = box.x;
  if (align === 'center') x = box.x + Math.floor((box.w - w) / 2);
  else if (align === 'right') x = box.x + box.w - w;
  const y = box.y + Math.floor((box.h - h) / 2);
  if (shadow) drawText(ctx, text, x, y + 1, size, shadow);
  drawText(ctx, text, x, y, size, color);
  return size;
}
