// Rodela Track — Service Worker
// IMPORTANTE: a cada atualização publicada, aumente VERSION para o iPhone baixar os arquivos novos.
const VERSION = '0.5.0';
const CACHE = `rodela-${VERSION}`;
const CDN_CACHE = 'rodela-cdn';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/chart.js',
  './js/dieta.js',
  './js/label.js',
  './js/rest.js',
  './js/boxe.js',
  './js/combos.js',
  './js/vendor/zxing.min.js',
  './js/vendor/tesseract.min.js',
  './js/vendor/worker.min.js',
  './data/taco.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' ignora o cache HTTP do navegador (o GitHub Pages guarda arquivos por ~10 min),
  // garantindo que a versão nova seja baixada de verdade
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rodela-') && k !== CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// Cache-first para os arquivos do app (funciona offline).
// O núcleo do OCR (~4 MB) e o idioma não entram no pré-cache: são guardados no 1º uso.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Recursos de CDN (se algum dia forem usados) ficam em cache separado
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.open(CDN_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }
  if (url.origin !== self.location.origin) return; // ex.: Open Food Facts → sempre rede
  if (url.pathname.endsWith('/sw.js')) return; // nunca guardar o próprio service worker

  e.respondWith(
    caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
