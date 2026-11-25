// RLX haptics (PLAN §2, §6): the only feedback besides pixels. No sound.
// tick() honours the setting and allows at most one vibrate call per 40 ms.

import { hapticsOn } from './settings.js';

export const MIN_GAP_MS = 40;
export const TEST_TICK_MS = 16;

let last = -Infinity;

function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function tick(ms) {
  if (!canVibrate() || !hapticsOn()) return false;
  const now = performance.now();
  if (now - last < MIN_GAP_MS) return false;
  last = now;
  try {
    return navigator.vibrate(ms);
  } catch (err) {
    return false;
  }
}

/** The one test tick fired when the setting is switched on. */
export function testTick() {
  return tick(TEST_TICK_MS);
}
