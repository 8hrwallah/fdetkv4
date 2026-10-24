# Compatibility and verification status

This status distinguishes automated local checks from real website/browser verification. It does not treat a page that renders as proof that its login, navigation, media, or game streaming works.

## Local baseline and regression checks

Baseline checks before this change passed: all nine existing Node tests, workspace typecheck, and production build. Automated Node tests now exercise Scramjet defaults and explicit UV selection, DuckDuckGo search URL generation and safe input parsing, address-bar submit-handler routing, and UV response status/body handling, binary partial responses, WASM streaming compilation, malformed target URL rejection, rewritten-body headers, and internal transport errors.

| Check | Result | Evidence |
| --- | --- | --- |
| Workspace TypeScript check | Passed | `pnpm run typecheck` |
| Production site and API build | Passed | `pnpm run build:snorlax` |
| Scramjet default and explicit UV preference | Passed | Node regression tests for portal engine resolution and actual link navigation state |
| DuckDuckGo default, URL/query parsing, unsafe schemes | Passed | Node regression tests; whitespace and Unicode query encoding |
| Address bar URL/search matrix | Passed | 12 inputs run through the actual submit handler in a Node DOM harness; Enter/control behavior remains browser-unverified |
| Scramjet runtime/controller package compatibility | Passed | Installed controller bundle expects Scramjet `2.0.67-alpha.2`, matching installed runtime |
| Scramjet runtime, WASM, controller, worker, and libcurl assets | Passed | Production build emits each configured asset; WASM is served with `application/wasm` |
| UV upstream 500 preservation | Passed | Node regression test |
| UV binary 206 preservation | Passed | Node regression test |
| UV WASM response and streaming compilation | Passed | Minimal valid WASM module via `WebAssembly.instantiateStreaming` |
| UV malformed decoded URL handling | Passed | Returns 400 before opening upstream transport |
| UV transformed script headers | Passed | Node regression test |
| UV internal transport failure response | Passed | Node regression test |
| Titan engine selection | Passed | Explicitly rejects old `titan` value; never routes it to UV/Scramjet |
| YouTube same-tab recommendation click | Partial pass | On port 5199, the existing Scramjet iframe changed to the selected video URL and the outer portal remained alive; no renderer crash occurred in this run |
| YouTube Ctrl+click and back/forward | Not run | Separate browser cases were not completed |
| YouTube 1080p playback | Not verified | Requests included `itag=18` and failed media requests; no 1080p quality selection, sustained playback, or buffering measurement was completed |
| Port-5000 signed-in browser test | Blocked | YouTube navigation reached a Google sign-in page in the available browser context; no credentials were entered and an authenticated session was not established |
| Real-browser address-bar matrix | Not run | The app and module entrypoint loaded on port 5000, but the complete input matrix was only exercised in the Node DOM harness |
| UV versus Scramjet benchmark | Not measured | No browser benchmark harness or equivalent browser execution in this environment |

## Site matrix

The two files available with the supplied brief were instruction text rather than raw console/network exports. The pasted error descriptions are useful leads, but do not contain the original response headers or bytes needed to verify SRI, font decoding, content encoding, or truncation.

| Site / test case | Main page | Assets / JS | Client navigation | Login | Media / streaming | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| YouTube video click and back/forward | Loaded in browser | Partial; player UI rendered, transport errors observed | One same-tab recommendation navigation stayed alive; Ctrl+click/back-forward not run | Port-5000 session reached sign-in; authenticated state unverified | Proxy failures observed; 1080p not tested | No crash reproduced; compatibility and performance unverified |
| Discord landing and resource loading | Not run | Not run; supplied raw response evidence unavailable | Not run | Not run | Not run | Needs isolated browser requests and upstream response headers/bytes |
| Discord authenticated API | Untested | Untested | N/A | Untested | N/A | Requires user-authorized browser session; no auth bypass |
| GeForce NOW public page and streaming | Not run | Not run | Not run | Not run | Not run | Page initialization, authenticated API access, and actual streaming remain unverified |
| car-soccer.com secure-context requirements | Untested | Untested | Untested | N/A | Untested | Outer portal security is not proof of proxied document capability |
| GitHub | Untested | Untested | Untested | Untested | N/A | No real-browser run |
| Reddit | Untested | Untested | Untested | Untested | N/A | No real-browser run |
| Wikipedia | Untested | Untested | Untested | N/A | N/A | No real-browser run |
| Representative SPA / worker / WASM / WebSocket targets | Untested | Untested | Untested | N/A | Untested | No browser harness available |

## Browser-visible host diagnostics

On `/portal`, run `await window.__proxyHostDiagnostics()` in DevTools to inspect the **outer portal's** secure-context, cross-origin isolation, WebAssembly, WebGL, service-worker, and local engine-asset response headers. These values do not claim that the proxied site has the same native origin, secure context, or capabilities.

## Remaining evidence

To close the untested rows, run a browser automation suite on a machine with Chromium/Playwright and capture console errors, failed requests, response status/headers, navigation events, and renderer exit information. Benchmark UV and Scramjet against identical targets and cold/warm cache states before claiming performance differences. Titan is not selectable because the repository does not yet contain an independent Titan implementation.
