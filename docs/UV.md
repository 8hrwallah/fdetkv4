# Ultraviolet

Ultraviolet is the default proxy engine. Its bundled runtime and rewrite handlers are served from `public/uv/`; `/sw.js` controls requests under the configured `/service/` scope and `/bare/` is the Bare transport endpoint.

The page registers the worker before navigating the proxy iframe. The worker now activates updates without waiting for every older proxied tab to close, then claims in-scope clients. Proxy cookies and request rewriting remain handled by the upstream UV runtime included in this repository.

## Requirements and limitations

- The site must be served from a secure context (HTTPS, or localhost) for service workers.
- Service workers can be blocked by browser policy, private browsing settings, or embedded preview environments.
- The browser still enforces sandbox, DRM, authentication, cross-origin isolation, and media restrictions. Rewriting cannot remove server-side access controls or make every site embeddable.
- Do not edit the minified `uv.bundle.js` to patch upstream behavior. Update the upstream runtime deliberately and test its matching service-worker and handler assets as a set.
