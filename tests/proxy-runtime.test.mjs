import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { resolveProxyEngine } from "../artifacts/snorlax-cave/public/assets/js/proxy-engine.js";

const uvWorkerSource = await readFile(
  new URL("../artifacts/snorlax-cave/public/uv/uv.sw.js", import.meta.url),
  "utf8",
);
const portalSource = await readFile(
  new URL("../artifacts/snorlax-cave/public/assets/js/portal-proxy.js", import.meta.url),
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
    return "https://upstream.example/resource";
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

function makeWorker(upstreamFetch) {
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
    Ultraviolet: TestUltraviolet,
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
    console: { error: (...args) => errors.push(args) },
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
  assert.equal(resolveProxyEngine(null), "uv");
  assert.throws(() => resolveProxyEngine("titan"), /not yet an independent proxy engine/);
});

test("portal does not override native YouTube anchor click behavior", () => {
  assert.doesNotMatch(portalSource, /preventDefault|stopImmediatePropagation|keepYouTubeLinksInProxy/);
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
