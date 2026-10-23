# Changelog

## 2026-10-23

- Added `pnpm start:snorlax-nodb` to build and run the site and proxy without PostgreSQL. It keeps health checks available and disables database-backed chat endpoints; the default startup remains unchanged.
- Added Brave Search as a selectable provider for search terms, with encoded query parameters and a Google fallback for unknown stored values.
- UV's service worker now activates updates immediately and claims its `/service/` clients, avoiding waiting updates that could time out while older proxy tabs remain open.
- Restored the UV worker's `userKey` value used when constructing Bare requests, preventing a `ReferenceError` that stopped proxied navigation and search.
- Scramjet request failures now return a non-cacheable 502 response and are logged in the service worker instead of becoming opaque fetch failures.
- Static assets and proxy engine bundles can be cached for one hour; the two service-worker entrypoints remain revalidated so deployments can update promptly.
- `.wasm` files are explicitly served with the `application/wasm` MIME type, including in production.
- HTTPS detection for HSTS now uses Express's trusted-proxy-aware `req.secure` property.
- Added Titan as an optional experimental profile. It starts UV and attempts Scramjet only when UV fails before navigation; it does not add a separate rewrite engine or claim to detect target-site runtime incompatibilities.
- Removed Titan from engine selection after confirming it was only an initialization fallback, not an independent engine. Old saved Titan selections now show an explicit unavailable-engine message rather than silently starting UV.
- Removed the portal's custom YouTube click interception so Scramjet's rewritten anchors and normal browser click/modifier behavior are not overridden by `preventDefault()` and a forced controller navigation.
- UV now preserves upstream 500 bodies/statuses, removes stale compression and length headers after rewriting text bodies, and returns logged, non-cacheable plain-text 502 responses for internal transport failures.
- UV rejects malformed decoded proxy targets as a clear 400 before transport, and regression tests verify unmodified `application/wasm` bytes load through `WebAssembly.instantiateStreaming`.
- Added Node regression tests for engine selection, upstream error statuses, binary range response preservation, rewritten-body headers, and UV transport errors.
- Added an opt-in outer-portal diagnostics function for secure-context, isolation, WebAssembly, WebGL, and local service-worker/WASM response headers. It explicitly does not claim proxied pages share those host capabilities.
- Replit startup now launches the built API server directly and forwards shutdown signals, avoiding an extra long-lived pnpm subprocess.
- The API server rejects fractional and out-of-range port values early.
- Added UV, Scramjet, and Titan operation guides with browser and server-side limitations.

## Existing functionality

- Existing UV and Scramjet engines remain available and retain their existing URL formats and service-worker scopes.
- The default engine remains Ultraviolet.
- Replit continues to use the Node 24 workspace configuration and the `start:snorlax` command.
