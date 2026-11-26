// RLX haptics (PLAN §2, §6): the only feedback besides pixels. No sound.
// Haptics are always on (there are no settings): tick() vibrates whenever
// navigator.vibrate exists, at most once per 40 ms.

export const MIN_GAP_MS = 40;

let last = -Infinity;

function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function tick(ms) {
  if (!canVibrate()) return false;
  const now = performance.now();
  if (now - last < MIN_GAP_MS) return false;
  last = now;
  try {
    return navigator.vibrate(ms);
  } catch (err) {
    return false;
  }
}
