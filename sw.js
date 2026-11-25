// RLX service worker (PLAN §5): cache-first, versioned cache, offline.
//
// Deploying a change: bump VERSION (tools/bump-sw-version.sh does it). The
// browser sees a changed sw.js, installs this worker, which caches every
// file under the new name, takes over at once and deletes the old caches.
// The next launch runs the new files. Add any new shipped file to FILES.

const VERSION = 'rlx-v1';

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './shared/tokens.js',
  './shared/theme.css',
  './shared/font.js',
  './shared/pixel.js',
  './shared/haptics.js',
  './shared/store.js',
  './shared/settings.js',
  './games/bricks/',
  './games/bricks/index.html',
  './games/bricks/bricks.js',
  './games/bricks/physics.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rlx-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // RLX never asks another host

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      // a folder URL without its slash, or index.html spelled out
      const alt = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname + '/';
      const altHit = await cache.match(alt, { ignoreSearch: true });
      if (altHit) return altHit;
    }
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const home = await cache.match('./');
        if (home) return home;
      }
      throw err;
    }
  })());
});
