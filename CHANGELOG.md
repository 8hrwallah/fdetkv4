# Changelog

- Rebuilt the Tabbed new-tab page: centered search plus up to six user-managed shortcut tiles (add/edit/remove, http(s) validation, lazy favicons with letter fallback, persisted in `tabbedShortcuts`). Home/Games/Apps/Settings/About are no longer tiles; `fdetk://` routes are unchanged.
- Fixed misplaced Tabbed blocks: the global `nav` rule in the Casual stylesheet was fixing Tabbed's `<nav>` link rows to the viewport; they are now plain containers, and new-tab controls are reset with low-specificity `:where()` rules.

- Fixed Casual mode turning black: embedded-catalog theming rules matched every page through `html[data-tabbed-theme]`, overriding the body background; they are now scoped to `html[data-tabbed-embed]`, which only Tabbed's internal frames set.
- Renamed app-defined internal routes from `chrome://` to `fdetk://`.

## 2026-10-25

- Added a useful Tabbed start page, in-shell Settings/About/Games/Apps pages, safe `fdetk://` routing, theme-aware internal catalogs, and browser-history navigation without leaving the workspace.
- Reduced the Tabbed chrome height, made the new-tab control square, and moved the shared-session privacy note into About.
- Replaced the default Slope shortcut with TikTok and migrated the saved shortcut slot; TikTok continues through the normal Scramjet proxy navigation path.
- Updated site branding and page titles to INSTA XC4RS / `wld al3m`; the saved tab-name preference now applies to Home and the proxy portal without replacing named-page titles.
- Preserved the shortcut loop phase during resizing and pause/resume at page visibility changes.
- Removed an Apps-page favicon handler that accessed a Settings-only input and threw when a custom favicon was saved.

## 2026-10-24

- Added a compact, horizontally scrollable shortcut row below the home search field for YouTube, GeForce NOW, Discord, TikTok, DuckDuckGo, and Azgames.io. Shortcut destinations reuse the existing `openLink` routing behavior; the membership has no add control.
- Shortcuts retain their order in local storage, support pointer and keyboard reordering, and use a drag threshold so ordinary clicks activate without a drag delay. Removed the home-page Version 2.0 label while preserving its background preference logic.
- Added a seamless, reduced-motion-aware continuous rightward loop using non-focusable visual copies. Shortcut membership stays fixed; users can drag to reorder the listed shortcuts.
- Routed GeForce NOW's `play.geforcenow.com` shortcut through the existing Scramjet proxy path; the separate NVIDIA-domain direct-navigation exception remains unchanged.
- Replaced Slope with proxied TikTok in the default shortcuts and preserved the slot when migrating an existing saved order.
- Applied the INSTA XC4RS branding and `wld al3m` page titles across site pages. The Settings title preference now affects Home and the proxy portal without overwriting page-specific titles.
- Preserved continuous shortcut motion across viewport resizing by scaling the scroll phase, and suspend motion while the page is hidden.

- Made Scramjet the default for new sessions and invalid saved engine values while preserving explicit Ultraviolet preferences; Titan still fails clearly instead of falling back.
- Made DuckDuckGo the default search provider and added explicit URL-versus-search classification for domains, localhost ports, IPv4, and ordinary queries. Explicit HTTP remains HTTP; unsafe schemes and malformed hosts are rejected or searched rather than treated as proxy URLs.
- Fixed the built homepage to load the address-bar module, safely ignores empty submissions, prevents duplicate in-flight submissions, and opens DuckDuckGo results directly if proxy navigation startup fails.
- Added regression coverage for engine default/persistence behavior, DuckDuckGo defaults, the actual address-bar submit handler's URL/search matrix, Unicode/query encoding, HTTP URL preservation, empty input, and unsafe schemes.

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
- Scramjet is the default engine for new sessions; explicit Ultraviolet preferences remain supported.
- Replit continues to use the Node 24 workspace configuration and the `start:snorlax` command.
