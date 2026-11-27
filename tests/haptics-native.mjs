// Row P3 (PLAN §6f) in Node: shared/haptics.js sends to the Android app's
// native plugin (window.Capacitor.Plugins.RlxHaptics) when it exists, the
// hub's first (a game runs in the hub's frame) and the page's own second, and
// to navigator.vibrate exactly as before otherwise. The shared rules hold on
// both paths: always on, at most one call per 40 ms, the tick length passed
// through unchanged. shared/native.js: inApp(). No dependencies:
// node tests/haptics-native.mjs

import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function check(ok, what) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
}

// A clock the test drives, for the 40 ms limit.
let now = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });

const navCalls = [];
Object.defineProperty(globalThis, 'navigator', {
  value: { vibrate: (ms) => { navCalls.push(ms); return true; } }, configurable: true, writable: true,
});

function fakePlugin(log, result = Promise.resolve()) {
  return { vibrate: (opts) => { log.push(opts); return result; } };
}
function capWith(plugin) {
  return { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: plugin ? { RlxHaptics: plugin } : {} };
}
function setWindow(w) {
  if (w === undefined) delete globalThis.window;
  else globalThis.window = w;
}

const H = await import('../shared/haptics.js');
const N = await import('../shared/native.js');

// 1. The web: no window.Capacitor, navigator.vibrate as before.
setWindow(undefined);
check(N.inApp() === false && N.nativeHaptics() === null, 'Node, no window: not in the app, no native plugin');
let r = H.tick(8);
check(r === true && navCalls.length === 1 && navCalls[0] === 8, 'no app: tick(8) calls navigator.vibrate(8)');
const web = { Capacitor: undefined };
web.top = web;
setWindow(web);
now += 50;
H.tick(16);
check(navCalls.length === 2 && navCalls[1] === 16 && N.inApp() === false, 'a web page with no Capacitor: navigator.vibrate(16), not in the app');

// 2. The app's own page (the hub): the plugin, never navigator.vibrate.
const hubLog = [];
const hub = { Capacitor: capWith(fakePlugin(hubLog)) };
hub.top = hub;
setWindow(hub);
now += 50;
r = H.tick(8);
check(r === true && hubLog.length === 1 && hubLog[0].ms === 8 && navCalls.length === 2,
  `in the app: tick(8) goes to RlxHaptics.vibrate({ ms: 8 }) and not to navigator.vibrate (${JSON.stringify(hubLog)})`);
check(N.inApp() === true, 'in the app: inApp() is true');

// 3. The 40 ms limit on the native path.
now += 10;
r = H.tick(16);
check(r === false && hubLog.length === 1, 'native path: a tick 10 ms after the last is dropped (at most one call per 40 ms)');
now += 30;
r = H.tick(16);
check(r === true && hubLog.length === 2 && hubLog[1].ms === 16, 'native path: a tick 40 ms after the last goes out with its own length (16)');

// 4. A game in the hub's frame: the hub's plugin, even when the frame has a bridge of its own.
const frameLog = [];
const game = { Capacitor: capWith(fakePlugin(frameLog)), top: hub };
setWindow(game);
now += 50;
H.tick(8);
check(hubLog.length === 3 && frameLog.length === 0, 'a game in the hub frame: the hub\'s plugin is used first');
const bare = { top: hub };
setWindow(bare);
now += 50;
H.tick(8);
check(hubLog.length === 4 && N.inApp() === true, 'a game frame with no bridge of its own: the hub\'s plugin, and inApp() is true');

// 5. A top window that cannot be read: the page's own plugin.
const locked = { Capacitor: capWith(fakePlugin(frameLog)) };
Object.defineProperty(locked, 'top', { get() { throw new Error('cross-origin'); } });
setWindow(locked);
now += 50;
H.tick(8);
check(frameLog.length === 1 && frameLog[0].ms === 8, 'top window unreadable: the page\'s own plugin');

// 6. A plugin call that rejects or throws: no unhandled rejection, false on a throw, no fallback double tick.
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });
const rejectLog = [];
const rej = { Capacitor: capWith(fakePlugin(rejectLog, Promise.reject(new Error('no vibrator')))) };
rej.top = rej;
setWindow(rej);
now += 50;
r = H.tick(8);
await new Promise((res) => setTimeout(res, 20));
check(r === true && rejectLog.length === 1 && unhandled === 0 && navCalls.length === 2, 'a rejected plugin call is caught; navigator.vibrate is not called as well');
const thrower = { Capacitor: capWith({ vibrate: () => { throw new Error('bridge gone'); } }) };
thrower.top = thrower;
setWindow(thrower);
now += 50;
check(H.tick(8) === false && navCalls.length === 2, 'a plugin that throws: tick() returns false, nothing else is called');

// 7. A bridge without the plugin (an older app build): navigator.vibrate as on the web.
const noPlug = { Capacitor: capWith(null) };
noPlug.top = noPlug;
setWindow(noPlug);
now += 50;
H.tick(16);
check(navCalls.length === 3 && navCalls[2] === 16, 'a bridge without RlxHaptics: navigator.vibrate as on the web');

// 8. Nothing at all: no call, false.
delete globalThis.navigator.vibrate;
now += 50;
check(H.tick(8) === false && H.canVibrate() === false && navCalls.length === 3, 'no plugin and no navigator.vibrate: canVibrate() false, nothing called');
setWindow(hub);
check(H.canVibrate() === true, 'no navigator.vibrate but the app\'s plugin: canVibrate() true');

// 9. A batch of game-like ticks on the native path: only the passed lengths, never under 40 ms apart.
const times = [];
const batchLog = [];
const batch = { Capacitor: capWith({ vibrate: (o) => { batchLog.push(o.ms); times.push(now); return Promise.resolve(); } }) };
batch.top = batch;
setWindow(batch);
for (let i = 0; i < 400; i++) {
  now += 7 + (i % 5) * 6;
  H.tick(i % 3 ? 8 : 16);
}
const gaps = times.slice(1).map((t, i) => t - times[i]);
check(batchLog.length > 50 && batchLog.every((m) => m === 8 || m === 16) && Math.min(...gaps) >= 40,
  `native path, 400 ticks: ${batchLog.length} sent, lengths 8 and 16 only, smallest gap ${Math.min(...gaps)} ms`);

// 10. Static: haptics reads no setting; the games vibrate only through shared/haptics.js; the
// service worker is not registered in the app.
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check(!/settings|hapticsOn|localStorage/.test(src('shared/haptics.js')) && !/localStorage|sessionStorage|fetch\(/.test(src('shared/native.js')),
  'haptics.js and native.js read no setting, store nothing and fetch nothing');
check(['games/bricks/bricks.js', 'games/pool/pool.js', 'index.html', 'hub/cards.js']
  .every((f) => !/navigator\.vibrate/.test(src(f))), 'no game or hub file calls navigator.vibrate itself: every tick goes through shared/haptics.js');
check(/'serviceWorker' in navigator && isSecureContext && !inApp\(\)/.test(src('shared/pixel.js')), 'pixel.js does not register the service worker inside the app');

console.log(`${passed + failed} checks, ${failed} failure(s)`);
process.exit(failed ? 1 : 0);
