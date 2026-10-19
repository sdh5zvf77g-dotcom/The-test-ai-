/* AI Council offline app-shell cache. Bump CACHE_NAME when releasing updates. */
const CACHE_NAME = "ai-council-shell-v8";
const SHELL = ["./", "./index.html", "./app.js?v=5", "./manifest.webmanifest"];
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL).catch(err => {
        console.warn("SW cache addAll partial fail", err);
        // Still try individual files
        return Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
      }))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(() =>
      caches.match(request).then(cached => cached || caches.match("./index.html"))
    )
  );
});
