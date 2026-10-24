import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { resolveProxyEngine } from "../artifacts/snorlax-cave/public/assets/js/proxy-engine.js";
import {
  buildSearchUrl,
  isDuckDuckGoSearchUrl,
  resolveAddressInput,
} from "../artifacts/snorlax-cave/public/assets/js/search.js";

const uvWorkerSource = await readFile(
  new URL("../artifacts/snorlax-cave/public/uv/uv.sw.js", import.meta.url),
  "utf8",
);
const portalSource = await readFile(
  new URL("../artifacts/snorlax-cave/public/assets/js/portal-proxy.js", import.meta.url),
  "utf8",
);
const functionsSource = await readFile(
  new URL("../artifacts/snorlax-cave/public/assets/js/functions.js", import.meta.url),
  "utf8",
);
const addressBarSource = await readFile(
  new URL("../artifacts/snorlax-cave/public/assets/js/index.js", import.meta.url),
  "utf8",
);
const homepageSource = await readFile(
  new URL("../artifacts/snorlax-cave/index.html", import.meta.url),
  "utf8",
);

class TestEventEmitter {
  emit() {}
}

class TestUltraviolet {
  constructor() {
    this.meta = {};
    this.cookie = {
      db: async () => ({}),
      getCookies: async () => [],
      serialize: () => "",
      setCookies: async () => {},
    };
    this.js = { rewrite: (source) => `rewritten:${source}` };
  }

  sourceUrl() {
    return TEST_DECODED_URL;
  }

  rewriteUrl(value) {
    return value;
  }
}

TestUltraviolet.Bowser = {
  getParser: () => ({ getBrowserName: () => "Chrome" }),
};
TestUltraviolet.mime = {
  contentType: (value) => value,
};

function makeWorker(upstreamFetch, decodedUrl = "https://upstream.example/resource") {
  class WorkerUltraviolet extends TestUltraviolet {
    sourceUrl() {
      return decodedUrl;
    }
  }

  const self = {
    navigator: { userAgent: "test" },
    clients: { matchAll: async () => [] },
  };
  const errors = [];
  const location = new URL("https://proxy.example/");
  const config = {
    prefix: "/service/",
    bare: "/bare/",
    bundle: "/uv/uv.bundle.js",
    handler: "/uv/uv.handler.js",
    config: "/uv/uv.config.js",
  };
  const sandbox = {
    self,
    location,
    Ultraviolet: WorkerUltraviolet,
    EventEmitter: TestEventEmitter,
    HookEvent: undefined,
    RequestContext: undefined,
    ResponseContext: undefined,
    importScripts() {},
    fetch: upstreamFetch,
    Request: class {
      constructor(url, init) {
        this.url = String(url);
        this.init = init;
      }
    },
    Response,
    Headers,
    URL,
    Blob,
    console: {
      error: (...args) => errors.push(args),
      warn: (...args) => errors.push(args),
    },
    __uv: undefined,
    __uv$config: config,
  };

  vm.runInNewContext(`const userKey = "";\n${uvWorkerSource}`, sandbox);
  return { worker: new self.UVServiceWorker(config), errors };
}

function request(destination = "image") {
  return {
    url: "https://proxy.example/service/encoded-target",
    method: "GET",
    headers: new Headers({ accept: "*/*" }),
    referrer: "",
    mode: "cors",
    destination,
    redirect: "follow",
    blob: async () => new Blob(),
  };
}

function bareResponse(status, headers, body) {
  return new Response(body, {
    headers: {
      "x-bare-status": String(status),
      "x-bare-status-text": status === 500 ? "Upstream Error" : "OK",
      "x-bare-headers": JSON.stringify(headers),
    },
  });
}

test("engine selection never aliases Titan to UV or Scramjet", () => {
  assert.equal(resolveProxyEngine("uv"), "uv");
  assert.equal(resolveProxyEngine("scramjet"), "scramjet");
  assert.equal(resolveProxyEngine(null), "scramjet");
  assert.equal(resolveProxyEngine("invalid"), "scramjet");
  assert.throws(() => resolveProxyEngine("titan"), /not yet an independent proxy engine/);
});

test("new proxy navigations default to Scramjet and preserve explicit UV", async () => {
  async function navigate(initialEngine) {
    const values = new Map(initialEngine ? [["proxyEngine", initialEngine]] : []);
    const locations = [];
    const localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    const window = {
      location: { href: "https://portal.example/", assign: (value) => locations.push(value) },
      navigator: {
        serviceWorker: {
          register: async () => ({ active: { state: "activated" } }),
        },
      },
      waitForActiveServiceWorker: async (registration) => registration.active,
      "__uv$config": { prefix: "/service/", encodeUrl: (value) => `encoded:${value}` },
    };
    const sandbox = {
      document: { addEventListener() {} },
      localStorage,
      URL,
      window,
      console,
    };

    vm.runInNewContext(functionsSource, sandbox);
    await sandbox.openProxyTarget("https://example.com");
    return { values, locations };
  }

  const defaultNavigation = await navigate(null);
  assert.equal(defaultNavigation.values.get("proxyEngine"), "scramjet");
  assert.deepEqual(defaultNavigation.locations, ["/portal"]);

  const uvNavigation = await navigate("uv");
  assert.equal(uvNavigation.values.get("proxyEngine"), "uv");
  assert.equal(uvNavigation.values.get("encodedUrl"), "encoded:https://example.com/");

  const invalidPreference = await navigate("unknown");
  assert.equal(invalidPreference.values.get("proxyEngine"), "scramjet");
});

test("portal does not override native YouTube anchor click behavior", () => {
  assert.doesNotMatch(portalSource, /preventDefault|stopImmediatePropagation|keepYouTubeLinksInProxy/);
});

test("search URLs default to DuckDuckGo and safely encode queries", () => {
  const query = 'cats & dogs "quotes"';
  assert.equal(
    buildSearchUrl(null, query),
    "https://duckduckgo.com/?q=cats%20%26%20dogs%20%22quotes%22",
  );
  assert.equal(
    buildSearchUrl("brave", query),
    "https://search.brave.com/search?q=cats%20%26%20dogs%20%22quotes%22",
  );
  assert.equal(
    buildSearchUrl("duckduckgo", query),
    "https://duckduckgo.com/?q=cats%20%26%20dogs%20%22quotes%22",
  );
  assert.equal(
    buildSearchUrl("google", query),
    "https://www.google.com/search?q=cats%20%26%20dogs%20%22quotes%22",
  );
  assert.equal(buildSearchUrl("unknown", "test"), "https://duckduckgo.com/?q=test");
  assert.equal(buildSearchUrl("toString", "test"), "https://duckduckgo.com/?q=test");
  assert.equal(buildSearchUrl("duckduckgo", "  café + tea?  "), "https://duckduckgo.com/?q=caf%C3%A9%20%2B%20tea%3F");
  assert.throws(() => buildSearchUrl("duckduckgo", " \t "), /Enter a search query/);
});

test("address input distinguishes HTTP URLs from search terms and rejects unsafe schemes", () => {
  assert.equal(resolveAddressInput("  https://example.com/path?a=1#top  "), "https://example.com/path?a=1#top");
  assert.equal(resolveAddressInput("http://example.com", "duckduckgo"), "http://example.com/");
  assert.equal(resolveAddressInput("example.com/path?q=hello", "duckduckgo"), "https://example.com/path?q=hello");
  assert.equal(resolveAddressInput("localhost:3000/path", "duckduckgo"), "https://localhost:3000/path");
  assert.equal(resolveAddressInput("192.168.1.1", "duckduckgo"), "https://192.168.1.1/");
  assert.equal(resolveAddressInput("cats and dogs", null), "https://duckduckgo.com/?q=cats%20and%20dogs");
  assert.equal(resolveAddressInput("東京 + tea", "duckduckgo"), "https://duckduckgo.com/?q=%E6%9D%B1%E4%BA%AC%20%2B%20tea");
  assert.equal(resolveAddressInput("999.168.1.1", "duckduckgo"), "https://duckduckgo.com/?q=999.168.1.1");
  assert.equal(resolveAddressInput("example..com", "duckduckgo"), "https://duckduckgo.com/?q=example..com");
  assert.throws(() => resolveAddressInput("javascript:alert(1)"), /Only HTTP and HTTPS/);
  assert.throws(() => resolveAddressInput("data:text/html,hello"), /Only HTTP and HTTPS/);
  assert.equal(resolveAddressInput(""), null);
  assert.equal(resolveAddressInput(" \t "), null);
  assert.equal(isDuckDuckGoSearchUrl("https://duckduckgo.com/?q=proxy"), true);
  assert.equal(isDuckDuckGoSearchUrl("https://example.com/?q=proxy"), false);
});

test("address bar submit handler routes the required input matrix once", async () => {
  assert.match(homepageSource, /<script type="module" src="\/assets\/js\/index\.js"><\/script>/);

  const cases = [
    ["example.com", "https://example.com/"],
    ["https://example.com", "https://example.com/"],
    ["http://example.com", "http://example.com/"],
    ["example", "https://duckduckgo.com/?q=example"],
    ["cats playing", "https://duckduckgo.com/?q=cats%20playing"],
    ["localhost:5000", "https://localhost:5000/"],
    ["192.168.1.1", "https://192.168.1.1/"],
    ["https://example.com/path?q=hello%20world", "https://example.com/path?q=hello%20world"],
    ["  https://example.com  ", "https://example.com/"],
    ["مرحبا world?", "https://duckduckgo.com/?q=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%20world%3F"],
  ];

  async function createAddressBar(openProxyTarget) {
    const submissions = [];
    const listeners = {};
    const form = {
      dataset: {},
      addEventListener: (type, listener) => { listeners[type] = listener; },
    };
    const input = {
      value: "",
      closest: () => form,
      addEventListener: () => {},
    };
    const sandbox = {
      document: {
        getElementById: (id) => id === "search" ? input : id === "proxy-search-form" ? form : null,
      },
      localStorage: { getItem: () => "duckduckgo" },
      URL,
      window: {
        openProxyTarget: async (url) => {
          submissions.push(url);
          return openProxyTarget?.(url);
        },
        location: { assign: (url) => submissions.push(url) },
      },
      console,
      testSearchHelpers: { isDuckDuckGoSearchUrl, resolveAddressInput },
    };
    const source = addressBarSource.replace(
      /^import \{ isDuckDuckGoSearchUrl, resolveAddressInput \} from "\.\/search\.js";$/m,
      "const { isDuckDuckGoSearchUrl, resolveAddressInput } = testSearchHelpers;",
    );
    vm.runInNewContext(source, sandbox);
    return {
      form,
      input,
      submissions,
      submit: () => listeners.submit({ preventDefault() {} }),
    };
  }

  for (const [value, expected] of cases) {
    const addressBar = await createAddressBar();
    addressBar.input.value = value;
    await addressBar.submit();
    assert.deepEqual(addressBar.submissions, [expected], `address bar input: ${value}`);
  }

  for (const value of ["", " \t "]) {
    const addressBar = await createAddressBar();
    addressBar.input.value = value;
    await addressBar.submit();
    assert.deepEqual(addressBar.submissions, [], `empty address bar input: ${JSON.stringify(value)}`);
  }

  let completeNavigation;
  const pendingNavigation = new Promise((resolve) => { completeNavigation = resolve; });
  const duplicateSubmission = await createAddressBar(() => pendingNavigation);
  duplicateSubmission.input.value = "cats playing";
  const first = duplicateSubmission.submit();
  const second = duplicateSubmission.submit();
  assert.deepEqual(duplicateSubmission.submissions, ["https://duckduckgo.com/?q=cats%20playing"]);
  completeNavigation();
  await Promise.all([first, second]);
});

test("UV preserves an upstream 500 status and response body", async () => {
  const { worker } = makeWorker(async () =>
    bareResponse(500, { "content-type": "text/plain" }, "upstream failure"),
  );

  const response = await worker.fetch({ request: request() });
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "upstream failure");
});

test("UV preserves binary partial responses", async () => {
  const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255]);
  const { worker } = makeWorker(async () =>
    bareResponse(
      206,
      { "content-type": "application/octet-stream", "content-range": "bytes 0-5/10" },
      bytes,
    ),
  );

  const response = await worker.fetch({ request: request() });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-5/10");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("UV preserves and instantiates valid WASM responses", async () => {
  const wasmBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const { worker } = makeWorker(async () =>
    bareResponse(200, { "content-type": "application/wasm" }, wasmBytes),
  );

  const response = await worker.fetch({ request: request("") });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  const { module } = await WebAssembly.instantiateStreaming(response);
  assert.ok(module instanceof WebAssembly.Module);
});

test("UV returns a clear client error for an invalid decoded target URL", async () => {
  let transportRequested = false;
  const { worker } = makeWorker(async () => {
    transportRequested = true;
    throw new Error("transport should not run");
  }, "not a valid URL");

  const response = await worker.fetch({ request: request() });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await response.text(), "The proxied URL is invalid.");
  assert.equal(transportRequested, false);
});

test("UV removes stale compression and length metadata after script rewriting", async () => {
  const { worker } = makeWorker(async () =>
    bareResponse(
      200,
      {
        "content-type": "text/javascript",
        "content-length": "18",
        "content-encoding": "gzip",
      },
      "const value = 1;",
    ),
  );

  const response = await worker.fetch({ request: request("script") });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.match(await response.text(), /rewritten:const value = 1;/);
});

test("UV reports internal transport failures as plain-text 502 responses", async () => {
  const { worker, errors } = makeWorker(async () => {
    throw new Error("transport unavailable");
  });

  const response = await worker.fetch({ request: request() });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "The proxied request could not be completed.");
  assert.equal(errors.length, 1);
});
