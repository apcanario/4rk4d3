// RLX storage (PLAN §4): localStorage behind try/catch, versioned keys.
// A key is rlx.v<N>.<name>. Bump a name's version when its shape changes;
// an old version is then ignored and the caller gets its fallback.

const PREFIX = 'rlx';

function key(name, version) {
  return `${PREFIX}.v${version}.${name}`;
}

export function load(name, fallback, version = 1) {
  try {
    const raw = localStorage.getItem(key(name, version));
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

export function save(name, value, version = 1) {
  try {
    localStorage.setItem(key(name, version), JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

export function remove(name, version = 1) {
  try {
    localStorage.removeItem(key(name, version));
  } catch (err) {
    /* storage unavailable: nothing to remove */
  }
}
