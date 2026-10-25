# Compatibility and verification status

This status distinguishes automated local checks from real website/browser verification. It does not treat a page that renders as proof that its login, navigation, media, or game streaming works.

## Local baseline and regression checks

Baseline checks before this change passed: all nine existing Node tests, workspace typecheck, and production build. Automated Node tests now exercise Scramjet defaults and explicit UV selection, DuckDuckGo search URL generation and safe input parsing, address-bar submit-handler routing, and UV response status/body handling, binary partial responses, WASM streaming compilation, malformed target URL rejection, rewritten-body headers, and internal transport errors.

| Check | Result | Evidence |
| --- | --- | --- |
| Workspace TypeScript check | Passed | `pnpm run typecheck` |
| Production site and API build | Passed | `pnpm run build:snorlax` |
| Local HTTP and Wisp endpoints | Passed | `GET /` and `GET /portal` returned 200; Scramjet opened `ws://127.0.0.1:5000/wisp/`, exchanged 707 sent and 647 received frames, and remained open during the 1.5-second sample |
| Scramjet default and explicit UV preference | Passed | Node regression tests for portal engine resolution and actual link navigation state |
| DuckDuckGo default, URL/query parsing, unsafe schemes | Passed | Node regression tests; whitespace and Unicode query encoding |
| Address bar URL/search matrix | Passed | 12 inputs run through the actual submit handler in a Node DOM harness; Enter/control behavior remains browser-unverified |
| Fixed app shortcuts and destination routing | Passed | Node tests cover YouTube, Discord, GeForce NOW, TikTok, DuckDuckGo, and Azgames; external shortcut destinations use the existing proxy path |
| Shortcut click and reorder | Partial | Clicking the GeForce NOW shortcut opened `/portal`; Discord was separately routed through `/portal` with its target stored. Pointer drag reordered a shortcut to the end, saved the new order, and suppressed navigation |
| Shortcut order persistence after refresh | Not verified | The post-drag reload did not render the shortcut module before the bounded browser wait expired; storage write was observed, but reload persistence was not confirmed |
| Fixed shortcut membership | Passed | Membership is limited to the six defaults; the app and game catalogs do not expose an add-to-shortcuts action |
| Shortcut motion and reduced motion | Partial | Rightward movement was observed and reduced-motion preference held the row stationary; no full browser wrap was observed, while unit tests cover repeatable wrap math |
| Shortcut layout and responsive overflow | Passed | Browser measured the bar below search, no extra visible controls or Version 2.0 label, and horizontal scrolling at 360px width |
| Apps catalog search and boot | Passed | Search showed Google and the no-results message; with a saved custom favicon preference, the catalog loaded without the prior null-reference after removal of its redundant Settings-input handler |
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

## Discord and GeForce NOW routing findings

The home Apps catalog sends Discord through `openLink` → `apps` → `openProxyTarget` → `/portal`. With Scramjet selected, the portal creates a Scramjet controller and `LibcurlClient`; the client connects over `ws:` or `wss:` to the same-origin `/wisp/` endpoint. The root-scoped Scramjet service worker delegates routed requests to the upstream controller. The API server routes `/wisp/` WebSocket upgrades to `wispServer.routeRequest`. Installed versions are Scramjet `2.0.67-alpha.2`, controller `0.0.14`, libcurl transport `2.0.5` / libcurl.js `0.7.4`, and Wisp `0.4.1`.

GeForce NOW's `play.geforcenow.com` app shortcut uses the standard `openLink` → `openProxyTarget` → `/portal` path with Scramjet selected. The existing direct-navigation exception remains for `nvidia.com` and its subdomains.

| Evidence / reported error | Finding |
| --- | --- |
| Discord public homepage | Through the Scramjet portal, the login document and eight observed JavaScript assets returned HTTP 200. The Cloudflare challenge path returned 404 as HTML and Chromium rejected it as a script; upstream versus proxy origin is undetermined. This is not an authenticated Discord test. |
| Discord CSS and font sample | One proxied stylesheet returned 200 `text/css` with `br` content encoding; one WOFF2 returned 200 `font/woff2`, 38,156 bytes, and the expected `wOF2` signature. The sampled login document had no `integrity` attributes; the reported SRI mismatch was not reproduced or compared against upstream bytes. |
| GeForce NOW public entrypoint | Clicking the shortcut opened `/portal` with `proxyTargetUrl=https://play.geforcenow.com/` and Scramjet selected. The upstream entry redirected 302 to `/mall/`, which returned 200; the observed logo, background, JavaScript, and CSS assets returned 200. |
| Wisp connection sample | The Scramjet browser client connected to same-origin `/wisp/`; 707 outbound and 647 inbound frames were observed with no close or socket error during the sample. This does not establish correctness for all stream lifetimes or payload types. |
| libcurl SSL error 35 / HTTP/2 error 16 / proxy 500 | Not reproduced through Scramjet. These indicate a failed TLS or HTTP/2 request path but do not identify whether the origin, network, or transport caused it without the request URL, response, and transport trace. |
| Wisp DATA for unknown stream | Not independently reproduced; the available evidence is insufficient to distinguish an aborted request's late frame from a stream lifecycle defect. |
| Discord SRI / WOFF2 / challenge-script errors | The challenge-script 404 and HTML-MIME rejection were reproduced. A sampled font response had a valid WOFF2 signature; no SRI attributes were present on the sampled login document. The supplied CSS SRI mismatch and other font failures were not reproduced, and no upstream-byte comparison was made. No integrity policy or challenge response was changed. |
| NVIDIA queue, ad area, authentication, and game APIs | Not reached. The page remained at the welcome/EULA screen, displayed NVIDIA's unsupported-browser warning, and logged `requestStorageAccess: Permission denied`; no queue, ad request, account login, or game launch was tested. |
| NVIDIA native IPC and streaming capability | The browser logged a missing `CrimsonNative` `QUERY_IPC_EXTENSION_MESSAGE`/`Overrides.getConfig` command. This indicates an unavailable native-app interface, not a proxy-generated successful response. Game streaming was not tested. |
| Home-page ad script | `topcreativeformat.com` returned `ERR_NAME_NOT_RESOLVED` in the local browser, delaying home-page parsing. This is separate from NVIDIA's unobserved in-game ad request and was not changed. |
| Discord authentication, API, and media | Not run. No authenticated Discord session or media request was available. |

## Site matrix

The two files available with the supplied brief were instruction text rather than raw console/network exports. The pasted error descriptions are useful leads, but do not contain the original response headers or bytes needed to verify SRI, font decoding, content encoding, or truncation.

| Site / test case | Main page | Assets / JS | Client navigation | Login | Media / streaming | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| YouTube video click and back/forward | Loaded in browser | Partial; player UI rendered, transport errors observed | One same-tab recommendation navigation stayed alive; Ctrl+click/back-forward not run | Port-5000 session reached sign-in; authenticated state unverified | Proxy failures observed; 1080p not tested | No crash reproduced; compatibility and performance unverified |
| Discord landing and resource loading | Proxied login document returned 200 | Eight observed JS assets returned 200; challenge script returned 404 as HTML; one CSS and one WOFF2 sample returned 200 with expected MIME/signature; reported SRI mismatch not reproduced | Login form rendered | Not entered | Not run | Initial page and sampled assets loaded; Cloudflare challenge failure remains unresolved |
| Discord authenticated API | Untested | Untested | N/A | Not entered | N/A | Requires user-authorized session; no auth bypass |
| GeForce NOW public page and streaming | Proxied entry returned 302 then `/mall/` returned 200; welcome/EULA rendered | Several observed app assets returned 200 | Initial redirect completed; post-consent navigation not tested | Not entered; unsupported-browser warning and storage-access denial observed | Queue, ad request, launch, and sustained stream not reached | Initialization passed; later stages are blocked/not run |
| car-soccer.com secure-context requirements | Untested | Untested | Untested | N/A | Untested | Outer portal security is not proof of proxied document capability |
| GitHub | Untested | Untested | Untested | Untested | N/A | No real-browser run |
| Reddit | Untested | Untested | Untested | Untested | N/A | No real-browser run |
| Wikipedia | Untested | Untested | Untested | N/A | N/A | No real-browser run |
| Representative SPA / worker / WASM / WebSocket targets | Untested | Untested | Untested | N/A | Untested | No representative target matrix run |

## Browser-visible host diagnostics

On `/portal`, run `await window.__proxyHostDiagnostics()` in DevTools to inspect the **outer portal's** secure-context, cross-origin isolation, WebAssembly, WebGL, service-worker, and local engine-asset response headers. These values do not claim that the proxied site has the same native origin, secure context, or capabilities.

## Remaining evidence

To close the untested rows, run isolated authenticated Discord and GeForce NOW sessions with response headers, WebSocket close codes, media requests, queue/ad events, game launch, and sustained-stream evidence. The local browser also encountered DNS failures for an external home-page ad script; page parsing was delayed, which prevented a bounded shortcut-order-after-reload check. Benchmark UV and Scramjet against identical targets and cold/warm cache states before claiming performance differences. Titan is not selectable because the repository does not yet contain an independent Titan implementation.
