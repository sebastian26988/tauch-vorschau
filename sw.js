// Service Worker: App-Shell offline verfügbar machen.
// Wetterdaten cached die App selbst (localStorage), Kartenkacheln werden nicht gespeichert.
const CACHE = 'tbv-v5';
const DIRECTORY_URL = 'https://tauchlogbuch.pages.dev/osm/tauchplaetze.json';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/api.js',
  './js/charts.js',
  './js/map.js',
  './js/rating.js',
  './js/spots.js',
  './js/units.js',
  './js/icons.js',
  './js/theme-init.js',
  './fonts/manrope.woff2',
  './js/config.js',
  './js/logbook.js',
  './js/sitesearch.js',
  './js/owndives.js',
  './js/sync.js',
  './icons/logo.png',
  './icons/favicon-64.png',
  './icons/icon-192.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Eigene Dateien: Netz zuerst (Updates sofort sichtbar), offline aus dem Cache.
// Versionierte CDN-Bibliotheken: Cache zuerst. Tauchplatzverzeichnis aus dem Logbuch: Netz zuerst,
// offline die zuletzt geladene Fassung. APIs und Kartenkacheln: unverändert ans Netz.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })),
    );
    return;
  }

  const isDirectory = url.href === DIRECTORY_URL;
  if (url.origin !== location.origin && !isDirectory) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? caches.match('./index.html'))),
  );
});
