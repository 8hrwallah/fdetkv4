import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { resolveProxyEngine } from "../artifacts/snorlax-cave/public/assets/js/proxy-engine.js";
import {
  APP_SHORTCUTS,
  advanceRightwardScroll,
  getMarqueeRepetitions,
  getShortcutOrder,
  moveShortcut,
  preserveLoopPhase,
} from "../artifacts/snorlax-cave/public/assets/js/app-shortcuts.js";
import { NodeTCPSocket } from "../artifacts/api-server/node_modules/@mercuryworkshop/wisp-js/src/server/net.mjs";
import { resolvePortalTitle } from "../artifacts/snorlax-cave/public/assets/js/site-title.js";
import {
  findCrxZipOffset,
  inspectCrxFile,
} from "../artifacts/snorlax-cave/public/assets/js/settings-workspace.js";
import {
  normalizeWorkspaceSettings,
  resolveWorkspaceAddress,
} from "../artifacts/snorlax-cave/public/assets/js/tabbed-browser.js";
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
const shortcutStyles = await readFile(
  new URL("../artifacts/snorlax-cave/public/assets/css/style.css", import.meta.url),
  "utf8",
);
const scramjetWorkerSource = await readFile(
  new URL("../artifacts/snorlax-cave/public/scramjet-sw.js", import.meta.url),
  "utf8",
);
const settingsSource = await readFile(
  new URL("../artifacts/snorlax-cave/public/Settings.html", import.meta.url),
  "utf8",
);

function makeStoredCrx3(manifest) {
  const name = Buffer.from("manifest.json");
  const payload = Buffer.from(JSON.stringify(manifest));
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(payload.length, 18);
  localHeader.writeUInt32LE(payload.length, 22);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(payload.length, 20);
  centralHeader.writeUInt32LE(payload.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);

  const localEntry = Buffer.concat([localHeader, name, payload]);
  const centralOffset = localEntry.length;
  const centralEntry = Buffer.concat([centralHeader, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralEntry.length, 12);
  end.writeUInt32LE(centralOffset, 16);

  const zip = Buffer.concat([localEntry, centralEntry, end]);
  const header = Buffer.alloc(12);
  header.write("Cr24", 0);
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(0, 8);
  return Buffer.concat([header, zip]);
}

function toFile(bytes, name = "sample.crx") {
  const copy = Uint8Array.from(bytes);
  return {
    name,
    size: copy.byteLength,
    arrayBuffer: async () => copy.buffer,
  };
}

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

test("shortcut targets use the existing proxy route, including GeForce NOW", async () => {
  const values = new Map();
  const locations = [];
  const sandbox = {
    document: { addEventListener() {} },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    URL,
    window: {
      location: { href: "https://portal.example/", assign: (value) => locations.push(value) },
    },
    console,
  };

  vm.runInNewContext(functionsSource, sandbox);
  for (const url of [
    "https://discord.com/login",
    "https://www.tiktok.com/",
    "https://duckduckgo.com/",
    "https://azgames.io/",
    "https://play.geforcenow.com/",
  ]) {
    sandbox.openLink(url);
    assert.equal(values.get("proxyTargetUrl"), url);
    assert.deepEqual(locations, ["/portal"]);
    locations.length = 0;
  }
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

test("fixed app shortcuts preserve valid saved order and move exactly one position", () => {
  const ids = APP_SHORTCUTS.map((item) => item.id);
  assert.deepEqual(
    getShortcutOrder(JSON.stringify(["discord", "missing", "discord", 1])),
    ["discord", ...ids.filter((id) => id !== "discord")],
  );
  assert.deepEqual(getShortcutOrder("{invalid"), ids);
  assert.deepEqual(getShortcutOrder(JSON.stringify(["discord", "slope"])), ["discord", "tiktok", "youtube", "geforce-now", "duckduckgo", "azgames"]);
  assert.deepEqual(ids, ["youtube", "geforce-now", "discord", "tiktok", "duckduckgo", "azgames"]);
  assert.equal(APP_SHORTCUTS.find((item) => item.id === "geforce-now").url, "https://play.geforcenow.com/");
  assert.equal(APP_SHORTCUTS.find((item) => item.id === "tiktok").url, "https://www.tiktok.com/");
  assert.equal(APP_SHORTCUTS.find((item) => item.id === "duckduckgo").url, "https://duckduckgo.com/");
  assert.equal(APP_SHORTCUTS.find((item) => item.id === "azgames").url, "https://azgames.io/");
  assert.deepEqual(moveShortcut(["a", "b", "c", "d"], "b", 2), ["a", "c", "b", "d"]);
  assert.deepEqual(moveShortcut(["a", "b", "c", "d"], "c", 0), ["c", "a", "b", "d"]);
  assert.deepEqual(moveShortcut(["a", "b", "c", "d"], "b", 3), ["a", "c", "d", "b"]);
});

test("rightward shortcut motion wraps repeatedly without leaving the loop interval", () => {
  const loopWidth = 490;
  let position = loopWidth;
  for (let index = 0; index < 10_000; index += 1) {
    position = advanceRightwardScroll(position, 16, loopWidth);
    assert.ok(position >= 0 && position < loopWidth);
  }
  assert.equal(advanceRightwardScroll(10, 1_000, loopWidth, 20), 480);
  assert.equal(advanceRightwardScroll(10, 50_000, loopWidth, 20), 480);
  assert.equal(advanceRightwardScroll(10, 1_000, 0), 0);
});

test("shortcut loop resizing preserves the current phase", () => {
  assert.equal(preserveLoopPhase(250, 500, 800), 400);
  assert.equal(preserveLoopPhase(0, 500, 800), 0);
  assert.equal(preserveLoopPhase(525, 500, 800), 40);
  assert.equal(preserveLoopPhase(250, 0, 800), 800);
});

test("shortcut marquee repeats enough content to cover desktop and mobile viewports", () => {
  for (const viewportWidth of [320, 490, 920, 1440]) {
    const sequenceWidth = 6 * 80;
    const repetitions = getMarqueeRepetitions(viewportWidth, sequenceWidth);
    assert.ok(repetitions * sequenceWidth >= viewportWidth + sequenceWidth);
  }
  assert.match(homepageSource, /aria-label="Move shortcuts left"/);
  assert.match(homepageSource, /aria-label="Move shortcuts right"/);
  assert.match(shortcutStyles, /@keyframes app-shortcuts-marquee/);
  assert.match(shortcutStyles, /prefers-reduced-motion: reduce/);
});

test("tabbed preferences use safe defaults and validate web navigation", () => {
  const storage = new Map([
    ["interfaceMode", "tabbed"],
    ["tabbedTheme", "light"],
    ["tabbedAccent", "ice"],
  ]);
  assert.deepEqual(
    normalizeWorkspaceSettings({ getItem: (key) => storage.get(key) ?? null }),
    { mode: "tabbed", theme: "light", accent: "ice" },
  );
  assert.deepEqual(
    normalizeWorkspaceSettings({ getItem: () => "invalid" }),
    { mode: "casual", theme: "midnight", accent: "violet" },
  );
  assert.equal(
    resolveWorkspaceAddress("example.org", "duckduckgo", "https://portal.example/"),
    "https://example.org/",
  );
  assert.equal(
    resolveWorkspaceAddress("snorlax test", "duckduckgo", "https://portal.example/"),
    "https://duckduckgo.com/?q=snorlax%20test",
  );
  assert.throws(
    () => resolveWorkspaceAddress("javascript:alert(1)", "duckduckgo", "https://portal.example/"),
    /Only HTTP and HTTPS/,
  );
});

test("CRX upload inspection validates headers and reads only manifest metadata", async () => {
  const bytes = makeStoredCrx3({
    name: "Local test extension",
    version: "1.2.3",
    manifest_version: 3,
    permissions: ["storage", "tabs"],
  });
  assert.deepEqual(findCrxZipOffset(bytes), { version: 3, zipOffset: 12 });
  assert.deepEqual(await inspectCrxFile(toFile(bytes)), {
    crxVersion: 3,
    name: "Local test extension",
    version: "1.2.3",
    manifestVersion: 3,
    permissionCount: 2,
  });
  await assert.rejects(
    () => inspectCrxFile(toFile(bytes, "extension.txt")),
    /\.crx/,
  );
  await assert.rejects(
    () => inspectCrxFile(toFile(Buffer.alloc(32))),
    /valid CRX header/,
  );
});

test("tabbed workspace reuses the Scramjet controller and development logs omit query data", () => {
  assert.match(homepageSource, /tabbed-browser\.js/);
  assert.match(settingsSource, /value="casual"/);
  assert.match(settingsSource, /value="tabbed"/);
  assert.match(settingsSource, /not installed or running|cannot install Chrome extensions/i);
  assert.ok(scramjetWorkerSource.includes('response.headers.get("content-type")'));
  assert.ok(scramjetWorkerSource.includes("response.status >= 400"));
  assert.equal(scramjetWorkerSource.includes("request.body"), false);
  assert.equal(scramjetWorkerSource.includes("searchParams"), false);
});

test("Wisp TCP writes tolerate a socket closed while queued data is pending", async () => {
  const socket = Object.create(NodeTCPSocket.prototype);
  socket.hostname = "ads.example";
  socket.port = 443;
  let writes = 0;
  socket.socket = {
    destroyed: false,
    writable: true,
    write(_data, callback) {
      writes += 1;
      callback();
    },
  };

  await socket.send(Buffer.from("pending"));
  assert.equal(writes, 1);
  socket.socket = null;
  await assert.doesNotReject(() => socket.send(Buffer.from("closed")));
  assert.equal(writes, 1);

  socket.data_queue = { size: 128, max_size: 128 };
  assert.doesNotThrow(() => socket.pause());

  socket.socket = {
    destroyed: false,
    writable: true,
    write(_data, callback) {
      callback(new Error("socket closed during write"));
    },
  };
  await assert.rejects(() => socket.send(Buffer.from("failed")), /socket closed during write/);
});

test("portal title defaults to wld al3m and honors a saved custom title", () => {
  assert.equal(resolvePortalTitle(null), "wld al3m");
  assert.equal(resolvePortalTitle("   "), "wld al3m");
  assert.equal(resolvePortalTitle(" My Portal "), "My Portal");
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
