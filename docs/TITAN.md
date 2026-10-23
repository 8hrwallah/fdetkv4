# Titan (not available)

Titan is **not currently an independent proxy engine**. An earlier implementation only tried UV and then Scramjet during startup; it had no separate request pipeline, URL format, rewriting implementation, service worker, or compatibility tests. That fallback profile has been removed from engine selection so Titan is not presented as an engine or silently routed to another engine.

If a browser still has `proxyEngine=titan` in local storage, the portal reports that Titan is unavailable and asks the user to select UV or Scramjet in Settings. This is intentional and avoids silently changing the selected engine.

A real Titan implementation will require its own URL/origin layer, request and response pipeline, HTML/CSS/JavaScript rewriting, worker integration, WebSocket transport, tests, and repeatable benchmarks. No performance or site-compatibility claim is made until those components exist and have been measured.

## Current engine ownership

- **Ultraviolet** owns the `/service/` URL scheme and `sw.js` request handling. Its rewrite and cookie logic comes from the bundled UV runtime.
- **Scramjet** owns `/scramjet-proxy/`, the root-scoped controller worker, and Wisp/libcurl transport. Its rewriting comes from the pinned upstream Scramjet packages.
- Neither existing engine is Titan, and neither is selected as a fallback under the Titan name.
