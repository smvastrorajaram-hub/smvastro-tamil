const CACHE_NAME = 'smv-astro-app-v1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './assets/logo.png', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-512-maskable.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Always prefer the network for HTML/navigation so the live SMV app is not trapped on an old build.
  if (req.mode === 'navigate' || (req.destination === 'document')) {
    event.respondWith(
      fetch(req, {cache:'no-store'}).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache the app's local static assets; external APIs/scripts remain network controlled.
  const url = new URL(req.url);
  if (url.origin === self.location.origin && (req.destination === 'image' || req.destination === 'style' || req.destination === 'script' || req.destination === 'font' || url.pathname.endsWith('.webmanifest'))) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
  }
});
