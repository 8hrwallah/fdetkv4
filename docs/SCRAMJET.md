# Scramjet

Scramjet is the default proxy engine. Ultraviolet remains available as an explicitly selected alternative. The UI loads Scramjet's runtime, controller, worker, libcurl transport, and WASM asset from the local origin. `/scramjet-sw.js` controls the controller's root scope, and the controller uses the local `/wisp/` WebSocket endpoint (`wss:` when the app itself is HTTPS).

The runtime and rewrite pipeline come from the pinned `@mercuryworkshop/scramjet` and controller packages. The controller package's bundled runtime-version check matches the installed Scramjet version. The application configures the controller and includes a narrowly scoped hook that supplies an empty body for body-less POST requests to `googlevideo.com`; this is not a general YouTube compatibility guarantee. The application does not reimplement Scramjet's HTML, CSS, JavaScript, or DOM rewriting.

The libcurl transport uses its package defaults for concurrent connections instead of overriding them with a high per-host limit. This avoids multiplying connection and memory pressure during media playback; no 1080p playback benchmark is available, so this is not a claim of improved video performance.

## Requirements and limitations

- Use HTTPS (or localhost) so workers and secure WebSockets are available.
- The host must permit WebSocket upgrades to `/wisp/`. Reverse proxies must forward upgrade headers and use TLS consistently.
- Some sites use DRM, hardware-backed media, strict embedding policies, private APIs, or server-side bot/access controls that cannot be fixed by client-side rewriting.
- The service worker catches route failures and returns HTTP 502. Check the browser console and server logs for the underlying failure.
- Scramjet is an upstream experimental engine; test the sites and browser versions relevant to your deployment before relying on it.
