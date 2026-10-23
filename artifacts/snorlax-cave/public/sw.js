importScripts("./uv/uv.bundle.js");
importScripts("./uv/uv.config.js");
importScripts("./uv/uv.sw.js");

const sw = new UVServiceWorker();
const userKey = new URL(self.location.href).searchParams.get("userkey") || "";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => event.respondWith(sw.fetch(event)));
