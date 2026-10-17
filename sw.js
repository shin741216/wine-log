// オフライン対応 Service Worker（ネットワーク優先・失敗時キャッシュ）
// バージョンは version.js に一本化。更新の配布時はあちらだけを上げること。
importScripts("./version.js");
const CACHE_NAME = `wine-log-${APP_VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./version.js",
  "./app.js",
  "./manifest.json",
  "./icon-180.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).searchParams.has("_")) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request, { cache: "reload" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
