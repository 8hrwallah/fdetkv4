# Compatibility and verification status

This status distinguishes automated local checks from real website/browser verification. It does not treat a page that renders as proof that its login, navigation, media, or game streaming works.

## Local baseline and regression checks

Before the latest fixes, the workspace typecheck and production build passed. The repository had no test script or browser automation dependency. Automated Node tests now exercise Brave search URL generation, UV response status/body handling, binary partial responses, WASM streaming compilation, malformed target URL rejection, rewritten-body headers, internal transport errors, and engine selection.

| Check | Result | Evidence |
| --- | --- | --- |
| Workspace TypeScript check | Passed | `pnpm run typecheck` |
| Production site and API build | Passed | `pnpm run build:snorlax` |
| UV upstream 500 preservation | Passed | Node regression test |
| UV binary 206 preservation | Passed | Node regression test |
| UV WASM response and streaming compilation | Passed | Minimal valid WASM module via `WebAssembly.instantiateStreaming` |
| UV malformed decoded URL handling | Passed | Returns 400 before opening upstream transport |
| UV transformed script headers | Passed | Node regression test |
| UV internal transport failure response | Passed | Node regression test |
| Titan engine selection | Passed | Explicitly rejects old `titan` value; never routes it to UV/Scramjet |
| Real-browser click / back-forward regression | Untested | No local Playwright/Puppeteer package or browser executable detected |
| UV versus Scramjet benchmark | Not measured | No browser benchmark harness or equivalent browser execution in this environment |

## Site matrix

The site-specific failures in the supplied engineering brief were not reproduced here: no browser console/network trace or live-site test result accompanied the brief. A Node service-worker test cannot establish full website compatibility.

| Site / test case | Main page | Assets / JS | Client navigation | Login | Media / streaming | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| YouTube video click and back/forward | Untested | Untested | Untested | Untested | Untested | Requires real-browser reproduction |
| Discord landing and resource loading | Untested | Untested | Untested | Untested | Untested | Needs upstream request/response trace |
| Discord authenticated API | Untested | Untested | N/A | Untested | N/A | Requires user-authorized browser session; no auth bypass |
| GeForce NOW public page | Untested | Untested | Untested | Untested | Untested | Needs browser test and service-side status evidence |
| car-soccer.com secure-context requirements | Untested | Untested | Untested | N/A | Untested | Outer portal security is not proof of proxied document capability |
| GitHub | Untested | Untested | Untested | Untested | N/A | No real-browser run |
| Reddit | Untested | Untested | Untested | Untested | N/A | No real-browser run |
| Wikipedia | Untested | Untested | Untested | N/A | N/A | No real-browser run |
| Representative SPA / worker / WASM / WebSocket targets | Untested | Untested | Untested | N/A | Untested | No browser harness available |

## Browser-visible host diagnostics

On `/portal`, run `await window.__proxyHostDiagnostics()` in DevTools to inspect the **outer portal's** secure-context, cross-origin isolation, WebAssembly, WebGL, service-worker, and local engine-asset response headers. These values do not claim that the proxied site has the same native origin, secure context, or capabilities.

## Remaining evidence

To close the untested rows, run a browser automation suite on a machine with Chromium/Playwright and capture console errors, failed requests, response status/headers, navigation events, and renderer exit information. Benchmark UV and Scramjet against identical targets and cold/warm cache states before claiming performance differences. Titan is not selectable because the repository does not yet contain an independent Titan implementation.
