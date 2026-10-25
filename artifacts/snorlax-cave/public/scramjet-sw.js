importScripts("/controller/controller.sw.js");

function isDevelopmentHost() {
  const hostname = self.location.hostname;
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname.endsWith(".replit.dev")
    || hostname.endsWith(".repl.co")
    || hostname.endsWith(".github.dev")
    || hostname.endsWith(".githubpreview.dev");
}

function safeTarget(requestUrl) {
  try {
    let path = new URL(requestUrl).pathname;
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        path = decodeURIComponent(path);
      } catch {
        break;
      }
    }
    const target = path.match(/(https?):\/\/([^/]+)(\/[^?#]*)?/i);
    if (!target) return { host: "unknown", targetPath: "/scramjet-proxy/" };
    const parsed = new URL(`${target[1]}://${target[2]}${target[3] || "/"}`);
    return { host: parsed.hostname.slice(0, 120), targetPath: parsed.pathname.slice(0, 160) };
  } catch {
    return { host: "unknown", targetPath: "/scramjet-proxy/" };
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (self.$scramjetController.shouldRoute(event)) {
    event.respondWith((async () => {
      const startedAt = Date.now();
      try {
        const response = await self.$scramjetController.route(event);
        if (isDevelopmentHost()) {
          const target = safeTarget(event.request.url);
          if (response.status >= 400) {
            console.info("[Scramjet dev]", {
              method: event.request.method,
              host: target.host,
              path: target.targetPath,
              status: response.status,
              contentType: response.headers.get("content-type"),
              durationMs: Date.now() - startedAt,
            });
          }
        }
        return response;
      } catch (error) {
        if (isDevelopmentHost()) {
          const target = safeTarget(event.request.url);
          console.error("[Scramjet dev] request failed", {
            method: event.request.method,
            host: target.host,
            path: target.targetPath,
            errorName: error instanceof Error ? error.name : "UnknownError",
            durationMs: Date.now() - startedAt,
          });
        }
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
