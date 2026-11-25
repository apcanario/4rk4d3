// RLX settings (PLAN §2, §5): one setting, haptics on or off, stored.

import { load, save } from './store.js';

const NAME = 'settings';
const VERSION = 1;
const DEFAULTS = Object.freeze({ haptics: true });

function read() {
  const s = load(NAME, null, VERSION);
  if (!s || typeof s !== 'object') return { ...DEFAULTS };
  return { haptics: typeof s.haptics === 'boolean' ? s.haptics : DEFAULTS.haptics };
}

export function hapticsOn() {
  return read().haptics;
}

export function setHaptics(on) {
  const s = read();
  s.haptics = !!on;
  save(NAME, s, VERSION);
  return s.haptics;
}
