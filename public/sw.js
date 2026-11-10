const CACHE_NAME = 'yanyu-cishu-v2-20261110-1';
const INDEX_URL = new URL('./index.html', self.location.href).href;
const SHELL_URL = new URL('./', self.location.href).href;
// 相对路径：在根域名和 GitHub Pages 的 /yanyu-cishu/ 前缀下都能用。
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/db.js',
  './js/icons.js',
  './js/importer.js',
  './js/mode.js',
  './js/practice.js',
  './js/util.js',
  './js/views.js',
  './shared/reducer.mjs',
  './shared/schedule.mjs',
  './shared/selectors.mjs',
  './shared/seed.mjs',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/\/api\//.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(INDEX_URL).then((cached) => cached || caches.match(SHELL_URL))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      }).catch(() => cached);
    }),
  );
});
