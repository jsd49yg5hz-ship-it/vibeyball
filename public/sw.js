/* VibeyBall Service Worker
 * - App-Shell und statische Dateien werden gecacht (cache-first mit Update im Hintergrund)
 * - API-GETs laufen network-first; die letzte erfolgreiche Antwort dient als Offline-Fallback
 * So lassen sich Trainingspläne auch in Hallen ohne Empfang noch ansehen. */

const CACHE_VERSION = "vibeyball-v1";
const STATIC_ASSETS = [
  ".",
  "index.html",
  "styles.css",
  "app.js",
  "exercises.js",
  "pdf.js",
  "sketch.js",
  "vendor/jspdf.umd.min.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // Schreibzugriffe nie abfangen
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes("/api/")) {
    // API: network-first, letzte bekannte Antwort als Offline-Fallback
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Statische Dateien: cache-first, im Hintergrund aktualisieren
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
