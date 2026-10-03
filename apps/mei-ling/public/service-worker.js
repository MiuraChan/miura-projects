const CACHE = "mei-ling-codec-call-v6";
const ASSETS = [
  "/",
  "/styles.css",
  "/effects.css",
  "/figma-portrait-motion.css",
  "/expression-system.css",
  "/conversation.css",
  "/panels.css",
  "/app.js",
  "/manifest.webmanifest",
  "/figma-mei-manga-approved.png",
  "/figma-miura-manga-approved.png",
  "/mei-expression-laughing-v1.png",
  "/mei-expression-serious-v1.png",
  "/mei-expression-embarrassed-v1.png",
  "/mei-expression-angry-v1.png",
  "/audio/metal-gear-codec.mp3",
  "/audio/codec-disconnect.wav"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (
    requestUrl.origin === self.location.origin &&
    requestUrl.pathname.startsWith("/api/")
  ) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl = new URL(
    event.notification.data?.url || self.registration.scope,
    self.registration.scope,
  );
  const targetUrl =
    requestedUrl.origin === self.location.origin
      ? requestedUrl.href
      : self.registration.scope;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        const target = clientList.find((client) => {
          try {
            return new URL(client.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });

        if (target) {
          await target.focus();
          if ("navigate" in target && target.url !== targetUrl) {
            await target.navigate(targetUrl);
          }
          return;
        }

        await self.clients.openWindow(targetUrl);
      }),
  );
});