// RLX session clock and scene phase (PLAN §2b rule 3): one clock for every
// game. It counts active play only; paused time never advances it. It resets
// when there has been no active play for resetGapMin minutes or more,
// measured from the saved time of the last active play.

// Clock and scene values: one block (PLAN §6a).
export const SESSION = Object.freeze({
  rampMin: 10, // sunset to dusk over the first 10 minutes of active play
  slowdownMin: 2, // then the pace ceiling falls to its minimum over 2 minutes
  resetGapMin: 5, // no active play for this long: the clock starts again
  sceneSteps: 10, // the scene is drawn in this many flat steps
  starsFromStep: 8, // white stars show from this step on
});

import { load, save } from './store.js';

const NAME = 'session'; // rlx.v1.session
const VERSION = 1;
const RAMP_S = SESSION.rampMin * 60;
const SLOW_S = SESSION.slowdownMin * 60;
const GAP_MS = SESSION.resetGapMin * 60 * 1000;

/** A fresh clock: no active play yet. last is epoch ms of the last active play, or null. */
export function freshClock() {
  return { active: 0, last: null };
}

function valid(c) {
  return !!c && typeof c === 'object' && typeof c.active === 'number' && Number.isFinite(c.active) && c.active >= 0
    && (c.last === null || (typeof c.last === 'number' && Number.isFinite(c.last)));
}

/**
 * True when the gap since the last active play is resetGapMin or more, or the
 * device clock now reads earlier than the last active play (set backwards).
 */
export function isStale(c, nowMs) {
  return c.last !== null && (nowMs < c.last || nowMs - c.last >= GAP_MS);
}

/**
 * The stored clock as of nowMs: a fresh one if none is stored, the stored one
 * is unreadable, or the reset gap has passed. reset tells which.
 */
export function readClock(nowMs) {
  const c = load(NAME, null, VERSION);
  if (!valid(c)) return { clock: freshClock(), reset: c !== null };
  if (isStale(c, nowMs)) return { clock: freshClock(), reset: true };
  return { clock: { active: c.active, last: c.last }, reset: false };
}

export function saveClock(c) {
  return save(NAME, { active: c.active, last: c.last }, VERSION);
}

/**
 * Active play is about to start at nowMs: reset the clock in place if the gap
 * has passed. Returns true if it was reset.
 */
export function beginPlay(c, nowMs) {
  if (!isStale(c, nowMs)) return false;
  c.active = 0;
  c.last = null;
  return true;
}

/** Add dt seconds of active play that ended at nowMs. Only called while playing. */
export function addPlay(c, dt, nowMs) {
  c.active += dt;
  c.last = nowMs;
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
