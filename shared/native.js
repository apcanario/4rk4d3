// RLX in the Android app (PLAN §6f). The app is the same files in a Capacitor
// shell; its native bridge puts window.Capacitor on the page. A game runs in a
// frame over the hub (same origin), so the hub's bridge is used first and the
// page's own second. On the web there is none and every caller does what it
// did before.

function bridgeOf(w) {
  try {
    const cap = w && w.Capacitor;
    return cap && typeof cap === 'object' ? cap : null;
  } catch (err) {
    return null; // a frame we may not read
  }
}

function bridges() {
  if (typeof window === 'undefined') return [];
  const out = [];
  let top = null;
  try {
    top = window.top;
  } catch (err) {
    top = null;
  }
  for (const w of [top, window]) {
    const cap = bridgeOf(w);
    if (cap && !out.includes(cap)) out.push(cap);
  }
  return out;
}

/** True inside the Android app. */
export function inApp() {
  return bridges().some((cap) => {
    try {
      return typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap.getPlatform?.() === 'android';
    } catch (err) {
      return false;
    }
  });
}

/** The app's native haptics plugin (RlxHaptics), or null on the web. */
export function nativeHaptics() {
  for (const cap of bridges()) {
    const p = cap.Plugins && cap.Plugins.RlxHaptics;
    if (p && typeof p.vibrate === 'function') return p;
  }
  return null;
}
