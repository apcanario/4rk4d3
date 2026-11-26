// RLX session clock and scene phase (PLAN §2b rule 2): one clock for every
// game, in memory only, never stored. It counts active play only; paused
// time never advances it. It resets when the app starts and when the page
// has been hidden for resetGapMin minutes or more.
//
// One clock across games: the hub holds it, and every game the hub opens
// (in a frame of the hub's page, see index.html) uses the hub's clock. A
// game page opened on its own holds its own clock, fresh at load.

// Clock and scene values: one block (PLAN §6a shared config).
export const SESSION = Object.freeze({
  rampMin: 10, // sunset to dusk over the first 10 minutes of active play
  slowdownMin: 2, // then the pace ceiling falls to its minimum over 2 minutes
  resetGapMin: 5, // the page hidden this long: the clock starts again
  sceneSteps: 10, // the scene is drawn in this many flat steps
  starsFromStep: 8, // white stars show from this step on
});

const RAMP_S = SESSION.rampMin * 60;
const SLOW_S = SESSION.slowdownMin * 60;
const GAP_MS = SESSION.resetGapMin * 60 * 1000;
const HOLDER = '__rlxSession'; // the property on the hub's window that holds the clock

/**
 * A fresh clock. active: seconds of active play; hiddenAt: epoch ms when the
 * page was hidden, or null while it is shown; resets: how many times the
 * clock has started again (games compare it to restart their pace).
 */
export function freshClock() {
  return { active: 0, hiddenAt: null, resets: 0 };
}

/** The page was hidden at nowMs. */
export function noteHidden(c, nowMs) {
  if (c.hiddenAt === null) c.hiddenAt = nowMs;
}

/**
 * The page is shown at nowMs. If it was hidden for resetGapMin or more (or
 * the device clock now reads earlier than when it was hidden), the clock
 * starts again. Returns true if it was reset. Safe to call more than once.
 */
export function noteShown(c, nowMs) {
  if (c.hiddenAt === null) return false;
  const gone = nowMs < c.hiddenAt || nowMs - c.hiddenAt >= GAP_MS;
  c.hiddenAt = null;
  if (gone) {
    c.active = 0;
    c.resets += 1;
  }
  return gone;
}

/** A check for one game: true once after each reset of c since the last call (or since the watch began). */
export function watchReset(c) {
  let seen = c.resets;
  return () => {
    if (c.resets === seen) return false;
    seen = c.resets;
    return true;
  };
}

/** Add dt seconds of active play. Only called while playing. */
export function addPlay(c, dt) {
  c.active += dt;
}

function connect() {
  if (typeof window === 'undefined') return freshClock(); // Node (the headless tests)
  let hub = null;
  try {
    if (window.top !== window && window.top[HOLDER]) hub = window.top[HOLDER];
  } catch (err) {
    hub = null; // a frame of another origin: never the case in RLX
  }
  const c = hub || freshClock();
  if (!hub) Object.defineProperty(window, HOLDER, { value: c, configurable: true });
  // The holder's page notes hidden and shown. A game in the hub's frame notes
  // shown too, first in its own page, so a reset is in place before the game
  // sees the page come back; it never notes hidden (a frame being removed is
  // hidden while the app is not).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) noteShown(c, Date.now());
    else if (!hub) noteHidden(c, Date.now());
  });
  return c;
}

let shared = null;

/** The one session clock, in memory. */
export function sessionClock() {
  if (!shared) shared = connect();
  return shared;
}

/** Scene phase, 0 (sunset) to 1 (dusk), over the ramp. */
export function phaseOf(activeS) {
  return Math.max(0, Math.min(1, activeS / RAMP_S));
}

/** The step drawn for a phase: 0 (sunset) to sceneSteps (dusk), flat. */
export function sceneStep(phase) {
  return Math.max(0, Math.min(SESSION.sceneSteps, Math.floor(phase * SESSION.sceneSteps + 1e-9)));
}

/** How far the dusk slowdown has gone, 0 to 1: 0 until the ramp ends, 1 from ramp + slowdown on. */
export function slowdownOf(activeS) {
  return Math.max(0, Math.min(1, (activeS - RAMP_S) / SLOW_S));
}
