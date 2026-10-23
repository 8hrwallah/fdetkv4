# Changelog

## 2026-10-23

- Added `pnpm start:snorlax-nodb` to build and run the site and proxy without PostgreSQL. It keeps health checks available and disables database-backed chat endpoints; the default startup remains unchanged.
- UV's service worker now activates updates immediately and claims its `/service/` clients, avoiding waiting updates that could time out while older proxy tabs remain open.
- Restored the UV worker's `userKey` value used when constructing Bare requests, preventing a `ReferenceError` that stopped proxied navigation and search.
- Scramjet request failures now return a non-cacheable 502 response and are logged in the service worker instead of becoming opaque fetch failures.
- Static assets and proxy engine bundles can be cached for one hour; the two service-worker entrypoints remain revalidated so deployments can update promptly.
- `.wasm` files are explicitly served with the `application/wasm` MIME type, including in production.
- HTTPS detection for HSTS now uses Express's trusted-proxy-aware `req.secure` property.
- Added Titan as an optional experimental profile. It starts UV and attempts Scramjet only when UV fails before navigation; it does not add a separate rewrite engine or claim to detect target-site runtime incompatibilities.
- Replit startup now launches the built API server directly and forwards shutdown signals, avoiding an extra long-lived pnpm subprocess.
- The API server rejects fractional and out-of-range port values early.
- Added UV, Scramjet, and Titan operation guides with browser and server-side limitations.

## Existing functionality

- Existing UV and Scramjet engines remain available and retain their existing URL formats and service-worker scopes.
- The default engine remains Ultraviolet.
- Replit continues to use the Node 24 workspace configuration and the `start:snorlax` command.
