/** Bump when shell or schedule assets change so clients refresh offline caches. */
const CACHE_VERSION = "v6";
const CACHE_NAME = `festival-offline-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./schedule.json",
  "./manifest.webmanifest",
];

function isSameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isPrecacheAsset(requestUrl) {
  const path = new URL(requestUrl).pathname;
  return PRECACHE_URLS.some((u) => new URL(u, self.location.href).pathname === path);
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("festival-offline-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }
  const network = await networkPromise;
  if (network) return network;
  return cache.match("./schedule.json");
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === "navigate") {
      return cache.match("./index.html");
    }
    return cache.match(request);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !isSameOrigin(request)) return;

  const url = new URL(request.url);
  const isSchedule = url.pathname.endsWith("/schedule.json") || url.pathname.endsWith("schedule.json");

  if (request.mode === "navigate") {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isSchedule) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isPrecacheAsset(request.url)) {
    event.respondWith(cacheFirst(request));
  }
});
