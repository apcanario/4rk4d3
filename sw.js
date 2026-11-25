// RLX service worker (PLAN §5): cache-first, versioned cache, offline.
//
// Deploying a change: bump VERSION (tools/bump-sw-version.sh does it). The
// browser sees a changed sw.js, installs this worker, which caches every
// file under the new name, takes over at once and deletes the old caches.
// The next launch runs the new files. Add any new shipped file to FILES.

const VERSION = 'rlx-v4';

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
      if (url.pathname.endsWith('/')) {
        // the folder spelled with index.html is the same page
        const page = await cache.match(url.pathname + 'index.html');
        if (page) return page;
      } else if (!url.pathname.endsWith('.html')) {
        // A folder without its slash: redirect, so relative paths resolve
        // against the folder (serving the body here would blank the page).
        const folder = new URL(url.pathname + '/', url);
        folder.search = url.search;
        if (await cache.match(folder.pathname)) return Response.redirect(folder.href, 301);
      }
    }
    try {
      const res = await fetch(req);
      if (res.redirected) {
        // A navigation must not get a redirected body under the old URL.
        if (req.mode === 'navigate') return Response.redirect(res.url, 301);
        return res;
      }
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
