let controllerPromise;

// Two defects in the installed libcurl-transport 2.0.5 / libcurl.js 0.7.4 stream (measured with
// scripts/transport-bench.mjs against the real transport and a real wisp-js server):
//  1. The controller calls transport.request(..., signal = undefined) and the response stream has
//     no cancel handler, so a body the browser stops reading keeps its curl connection until the
//     next chunk arrives. If the upstream goes quiet it is never freed, and libcurl's 6-per-host
//     cap then blocks every further request to that host. Cancelling the body now aborts the
//     underlying request immediately.
//  2. An upstream that disconnects mid-body ends the stream as if it had completed, so a short
//     media body looks whole. A body that ends before its identity Content-Length now errors
//     instead. Nothing is retried, buffered or rewritten, and headers/status are untouched.
function expectedBodyLength(method, response) {
  if (String(method).toUpperCase() === "HEAD") return null;
  if (response.status < 200 || response.status === 204 || response.status === 304) return null;
  let length = null;
  for (const [name, value] of response.headers ?? []) {
    const key = String(name).toLowerCase();
    // A transformed or chunked body has no trustworthy byte count to compare against.
    if (key === "content-encoding" || key === "transfer-encoding") return null;
    if (key === "content-length") length = /^\d+$/.test(String(value).trim()) ? Number(value) : null;
  }
  return length;
}

export function cancelableTransport(transport) {
  if (transport.__snorlaxCancelable) return transport;
  const request = transport.request;
  transport.request = async function (remote, method, body, headers, signal) {
    const abort = new AbortController();
    if (signal?.aborted) abort.abort();
    else signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const response = await request.call(this, remote, method, body, headers, abort.signal);
    if (!response?.body || typeof response.body.getReader !== "function") return response;
    const reader = response.body.getReader();
    const expected = expectedBodyLength(method, response);
    let received = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (!done) {
            received += value.byteLength;
            controller.enqueue(value);
          } else if (expected !== null && received < expected) {
            controller.error(new TypeError(`Upstream response ended after ${received} of ${expected} bytes`));
          } else {
            controller.close();
          }
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      },
      cancel(reason) {
        cancelled = true;
        abort.abort();
        return reader.cancel(reason).catch(() => {});
      },
    });
    return { ...response, body: stream };
  };
  transport.__snorlaxCancelable = true;
  return transport;
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

export function getScramjetController() {
  if (window.__snorlaxScramjetController) {
    return Promise.resolve(window.__snorlaxScramjetController);
  }
  if (controllerPromise) return controllerPromise;

  controllerPromise = (async () => {
    await loadClassicScript("/scramjet/scramjet.js");
    await loadClassicScript("/controller/controller.api.js");

    const registration = await navigator.serviceWorker.register("/scramjet-sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    const serviceWorker = await window.waitForActiveServiceWorker(registration);
    if (!serviceWorker) throw new Error("Scramjet service worker did not activate");

    const wispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
    const { LibcurlClient } = await import("/libcurl/index.mjs");
    const controllerConfig = window.$scramjetController.config;
    const controller = new window.$scramjetController.Controller({
      serviceworker: serviceWorker,
      transport: cancelableTransport(new LibcurlClient({ wisp: wispUrl })),
      config: {
        ...controllerConfig,
        prefix: "/scramjet-proxy/",
        scramjetPath: "/scramjet/scramjet.js",
        injectPath: "/controller/snorlax.inject.js?v=compat-2",
        wasmPath: "/scramjet/scramjet.wasm",
        virtualWasmPath: "scramjet.wasm.js",
      },
    });
    await controller.wait();
    window.__snorlaxScramjetController = controller;
    return controller;
  })().catch((error) => {
    controllerPromise = undefined;
    throw error;
  });

  return controllerPromise;
}
