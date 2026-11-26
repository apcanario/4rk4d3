// RLX haptics (PLAN §2, §6): the only feedback besides pixels. No sound.
// Haptics are always on (there are no settings): tick() vibrates whenever the
// device can, at most once per 40 ms. In the Android app (PLAN §6f) a tick
// goes to the app's native plugin (RlxHaptics.vibrate, no tap-before-vibrate
// gate); on the web it is navigator.vibrate exactly as before.

import { nativeHaptics } from './native.js';

export const MIN_GAP_MS = 40;

let last = -Infinity;

/** True when a tick can be sent: the app's native plugin, or navigator.vibrate. */
export function canVibrate() {
  if (nativeHaptics()) return true;
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Send one vibration of ms now, with no rate limit (the callers keep the 40 ms gap). */
export function send(ms) {
  const plugin = nativeHaptics();
  if (plugin) {
    try {
      const p = plugin.vibrate({ ms });
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return true;
    } catch (err) {
      return false;
    }
  }
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    return navigator.vibrate(ms);
  } catch (err) {
    return false;
  }
}

export function tick(ms) {
  if (!canVibrate()) return false;
  const now = performance.now();
  if (now - last < MIN_GAP_MS) return false;
  last = now;
  return send(ms);
}
