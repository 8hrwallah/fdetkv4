importScripts("/controller/controller.sw.js");

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (self.$scramjetController.shouldRoute(event)) {
    event.respondWith((async () => {
      try {
        return await self.$scramjetController.route(event);
      } catch (error) {
        console.error("Scramjet request failed", error);
        return new Response("The proxied request could not be completed.", {
          status: 502,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }
    })());
  }
});
