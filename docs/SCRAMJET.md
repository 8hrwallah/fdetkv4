# Scramjet

Scramjet is the separately selectable experimental engine. The UI loads its runtime, controller, worker, libcurl transport, and WASM asset from the local origin. `/scramjet-sw.js` controls the controller's root scope, and the controller uses the local `/wisp/` WebSocket endpoint (`wss:` when the app itself is HTTPS).

The runtime and rewrite pipeline come from the pinned `@mercuryworkshop/scramjet` and controller packages. The application adds only the controller configuration and a targeted YouTube link behavior; it does not reimplement Scramjet's HTML, CSS, JavaScript, or DOM rewriting.

## Requirements and limitations

- Use HTTPS (or localhost) so workers and secure WebSockets are available.
- The host must permit WebSocket upgrades to `/wisp/`. Reverse proxies must forward upgrade headers and use TLS consistently.
- Some sites use DRM, hardware-backed media, strict embedding policies, private APIs, or server-side bot/access controls that cannot be fixed by client-side rewriting.
- The service worker catches route failures and returns HTTP 502. Check the browser console and server logs for the underlying failure.
- Scramjet is marked experimental; test the sites and browser versions relevant to your deployment before relying on it.
