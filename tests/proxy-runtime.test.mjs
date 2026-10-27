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
  resolveWorkspaceNavigation,
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
  assert.deepEqual(
    resolveWorkspaceNavigation("fdetk://settings", "duckduckgo", "https://portal.example/"),
    { type: "internal", route: "settings", address: "fdetk://settings" },
  );
  assert.deepEqual(
    resolveWorkspaceNavigation("/math", "duckduckgo", "https://portal.example/"),
    { type: "internal", route: "games", address: "fdetk://games" },
  );
  assert.deepEqual(
    resolveWorkspaceNavigation("fdetk://extensions", "duckduckgo", "https://portal.example/"),
    { type: "internal", route: "not-found", address: "fdetk://extensions" },
  );
  assert.deepEqual(
    resolveWorkspaceNavigation("example.org", "duckduckgo", "https://portal.example/"),
    { type: "web", address: "https://example.org/" },
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
  assert.match(homepageSource, /href="fdetk:\/\/settings"/);
  assert.doesNotMatch(homepageSource, /tabbed-note/);
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
  assert.match(homepageSource, /\["\/assets\/js\/index\.js", true\]/);

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

test("Tabbed embedded-page theming cannot restyle the Casual document", async () => {
  const css = await readFile(new URL("../artifacts/snorlax-cave/public/assets/css/tabbed-internal.css", import.meta.url), "utf8");
  const selectors = css.match(/html\[data-tabbed-[^{]+\{/g) || [];
  assert.ok(selectors.length > 0);
  for (const selector of selectors) assert.match(selector, /data-tabbed-embed/);
});

test("new-tab shortcuts validate URLs, cap at six, and never expose internal pages", async () => {
  const mod = await import("../artifacts/snorlax-cave/public/assets/js/tabbed-shortcuts.js");
  assert.equal(mod.normalizeShortcutUrl("example.com"), "https://example.com/");
  assert.equal(mod.normalizeShortcutUrl("http://example.com/a"), "http://example.com/a");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "fdetk://settings", "ftp://x.com", "a b.com", "", "localnamewithoutdot", "https://u:p@example.com"]) {
    assert.equal(mod.normalizeShortcutUrl(bad), null, bad);
  }
  assert.ok(mod.validateShortcut({ name: "", url: "example.com" }).error);
  assert.ok(mod.validateShortcut({ name: "x".repeat(25), url: "example.com" }).error);
  assert.deepEqual(mod.validateShortcut({ name: " A  b ", url: "example.com" }).value, { name: "A b", url: "https://example.com/" });
  const data = new Map();
  const store = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const defaults = mod.loadShortcuts(store);
  assert.ok(defaults.length > 0 && defaults.length <= mod.MAX_SHORTCUTS);
  assert.ok(defaults.every((item) => item.id && /^https?:/.test(item.url)));
  store.setItem(mod.SHORTCUT_STORAGE_KEY, JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, name: `S${i}`, url: `https://s${i}.com` }))));
  assert.equal(mod.loadShortcuts(store).length, 6);
  store.setItem(mod.SHORTCUT_STORAGE_KEY, "[]");
  assert.equal(mod.loadShortcuts(store).length, 0);
  store.setItem(mod.SHORTCUT_STORAGE_KEY, "not json");
  assert.ok(mod.loadShortcuts(store).length > 0);
});

test("startup loads only the selected interface's scripts and defaults to Casual", () => {
  const firstDocument = homepageSource.split("</html>")[0];
  assert.match(firstDocument, /mode === "tabbed" \? "tabbed" : "casual"/);
  assert.doesNotMatch(firstDocument, /<script[^>]+src="\/assets\/js\/tabbed-browser\.js/);
  assert.doesNotMatch(firstDocument, /<script[^>]+src="\/uv\/uv\.bundle\.js/);
  assert.match(firstDocument, /fdetkLoadScripts\("tabbed", \[\["\/assets\/js\/tabbed-browser\.js[^"]*", true\]\]\)/);
  assert.match(firstDocument, /fdetkLoadScripts\("casual", \[\s*\["\/uv\/uv\.bundle\.js"\],\s*\["\/uv\/uv\.config\.js"\],/);
  assert.doesNotMatch(firstDocument, /fdetkWriteScript/);
  assert.match(firstDocument, /el\.async = false/);
  assert.doesNotMatch(firstDocument, /document\.write\(/);
});

test("Scramjet compat shim keeps the URL for null history arguments and matches encoded script selectors", async () => {
  const source = await readFile(new URL("../artifacts/snorlax-cave/proxy/scramjet-compat.js", import.meta.url), "utf8");
  const calls = [];
  class History { pushState(...a) { calls.push(["push", ...a]); } replaceState(...a) { calls.push(["replace", ...a]); } }
  const queries = [];
  class Document { querySelector(s) { queries.push(s); return null; } querySelectorAll(s) { queries.push(s); return []; } }
  class Element extends Document {}
  class DocumentFragment extends Document {}
  const window = { History, Document, Element, DocumentFragment, location: { href: "https://proxy/x" } };
  const loads = [];
  const controller = { load: (...a) => loads.push(a) };
  // The shim reassigns the global, so read it back from the context.
  const context = vm.createContext({ window, console, $scramjetController: controller });
  vm.runInContext(source, context);
  context.$scramjetController.load({ ok: true });
  assert.deepEqual(loads.at(-1), [{ ok: true }]);
  const history = new History();
  history.replaceState(null, "", undefined);
  history.pushState({}, "", null);
  history.replaceState({}, "", "/real");
  assert.deepEqual(calls[0].slice(3), ["https://proxy/x"]);
  assert.deepEqual(calls[1].slice(3), ["https://proxy/x"]);
  assert.equal(calls[2][3], "/real");
  new Document().querySelector('script[src*="/secsdk_runtime_bundler"]');
  assert.equal(queries.at(-1), 'script[src*="/secsdk_runtime_bundler"],script[src*="%2Fsecsdk_runtime_bundler"]');
  new Document().querySelector("div.plain");
  assert.equal(queries.at(-1), "div.plain");
});

test("Scramjet compat shim also covers history methods assigned on the history instance (Tabbed hook)", async () => {
  const source = await readFile(new URL("../artifacts/snorlax-cave/proxy/scramjet-compat.js", import.meta.url), "utf8");
  const calls = [];
  class History { pushState(...a) { calls.push(["proto-push", ...a]); } replaceState(...a) { calls.push(["proto-replace", ...a]); } }
  const history = new History();
  const window = { History, history, location: { href: "https://proxy/page" } };
  // Mirrors tabbed-browser.js: init.post (inside load) shadows the prototype with own properties.
  const controller = {
    load() {
      for (const method of ["pushState", "replaceState"]) {
        const original = history[method];
        history[method] = function (...args) { return Reflect.apply(original, this, args); };
      }
    },
  };
  const context = vm.createContext({ window, console, $scramjetController: controller });
  vm.runInContext(source, context);
  context.$scramjetController.load({});
  history.replaceState({ a: 1 }, "", undefined);
  history.pushState({}, "");
  history.pushState({}, "", null);
  history.replaceState({}, "", "/next");
  assert.deepEqual(calls.map((c) => c[3]), ["https://proxy/page", "https://proxy/page", "https://proxy/page", "/next"]);
});

test("TikTok resolves to a valid HTTPS URL on every entry path and empty targets never become URLs", async () => {
  assert.equal(APP_SHORTCUTS.find((item) => item.id === "tiktok").url, "https://www.tiktok.com/");
  for (const input of ["tiktok.com", "www.tiktok.com", "https://www.tiktok.com/"]) {
    const resolved = resolveAddressInput(input, "duckduckgo");
    assert.equal(new URL(resolved).protocol, "https:", input);
    assert.match(new URL(resolved).hostname, /^(www\.)?tiktok\.com$/, input);
    assert.equal(resolveWorkspaceAddress(input, "duckduckgo", "https://portal.example/"), resolved);
  }
  for (const empty of [undefined, null, "", "  "]) {
    assert.equal(resolveAddressInput(empty, "duckduckgo"), null);
    assert.equal(resolveWorkspaceAddress(empty, "duckduckgo", "https://portal.example/"), null);
  }

  const values = new Map();
  const locations = [];
  const sandbox = {
    document: { addEventListener() {} },
    localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) },
    URL,
    window: { location: { href: "https://portal.example/", assign: (v) => locations.push(v) } },
    console,
  };
  vm.runInNewContext(functionsSource, sandbox);
  for (const bad of [undefined, null, "", "  ", "undefined", "null", 42]) {
    sandbox.openLink(bad);
    await assert.rejects(() => sandbox.openProxyTarget(bad));
  }
  assert.equal(values.has("proxyTargetUrl"), false);
  assert.deepEqual(locations, []);
  sandbox.openLink("tiktok.com");
  assert.equal(values.get("proxyTargetUrl"), "https://tiktok.com/");
  assert.deepEqual(locations, ["/portal"]);
});

test("Scramjet runtime loads the compat inject script that Vite builds and appends", async () => {
  const runtime = await readFile(new URL("../artifacts/snorlax-cave/public/assets/js/scramjet-runtime.js", import.meta.url), "utf8");
  const vite = await readFile(new URL("../artifacts/snorlax-cave/vite.config.ts", import.meta.url), "utf8");
  const injectUrl = runtime.match(/injectPath:\s*"(\/controller\/[^"?]+)/)?.[1];
  assert.equal(injectUrl, "/controller/snorlax.inject.js");
  assert.match(vite, /url: '\/controller\/snorlax\.inject\.js'[^}]*append: compatShimPath/);
  assert.match(vite, /compatShimPath = path\.resolve\(import\.meta\.dirname, 'proxy\/scramjet-compat\.js'\)/);
  // The stock inject script stays untouched for non-Snorlax consumers.
  assert.match(vite, /url: '\/controller\/controller\.inject\.js', source: [^}]*\}/);
  assert.doesNotMatch(vite.match(/url: '\/controller\/controller\.inject\.js'[^}]*\}/)[0], /append/);
});

test("build-time precompression writes verified .br/.gz siblings and a manifest, skipping small and binary files", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { gunzipSync, brotliDecompressSync } = await import("node:zlib");
  const { precompressDirectory } = await import("../artifacts/snorlax-cave/proxy/precompress.mjs");
  const root = mkdtempSync(join(tmpdir(), "precompress-"));
  try {
    mkdirSync(join(root, "a"));
    const text = "function f(){return 'proxy';}\n".repeat(400);
    writeFileSync(join(root, "a", "big.js"), text);
    writeFileSync(join(root, "tiny.js"), "x=1");
    writeFileSync(join(root, "movie.swf"), Buffer.alloc(5000, 1));
    const manifest = precompressDirectory(root);
    assert.deepEqual(Object.keys(manifest), ["/a/big.js"]);
    assert.equal(brotliDecompressSync(readFileSync(join(root, "a", "big.js.br"))).toString(), text);
    assert.equal(gunzipSync(readFileSync(join(root, "a", "big.js.gz"))).toString(), text);
    assert.equal(existsSync(join(root, "tiny.js.br")), false);
    assert.equal(existsSync(join(root, "movie.swf.gz")), false);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "precompressed.json"), "utf8")), manifest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("precompressedStatic negotiates encodings, keeps types, and never touches ranges or unlisted paths", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createServer } = await import("node:http");
  const { gunzipSync, brotliDecompressSync } = await import("node:zlib");
  const { default: express } = await import("../artifacts/api-server/node_modules/express/index.js");
  const { precompressedStatic } = await import("../artifacts/api-server/src/lib/precompressed.ts");
  const { precompressDirectory } = await import("../artifacts/snorlax-cave/proxy/precompress.mjs");
  const root = mkdtempSync(join(tmpdir(), "precompressed-static-"));
  const js = "const a = 1;\n".repeat(500);
  const html = "<!doctype html><p>hello</p>\n".repeat(200);
  mkdirSync(join(root, "scramjet"));
  writeFileSync(join(root, "scramjet", "x.js"), js);
  writeFileSync(join(root, "loader.html"), html);
  writeFileSync(join(root, "scramjet", "x.wasm"), Buffer.alloc(4000, 7));
  precompressDirectory(root);
  const app = express();
  app.use(precompressedStatic(root, { "/portal": "/loader.html" }));
  app.use(express.static(root));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, headers = {}) => {
    const res = await fetch(base + path, { headers: { "Accept-Encoding": "identity", ...headers }, redirect: "manual" });
    return { res, body: Buffer.from(await res.arrayBuffer()) };
  };
  const raw = (path, encoding) => new Promise((resolve, reject) => {
    import("node:http").then(({ get: httpGet }) => httpGet(base + path, { headers: { "Accept-Encoding": encoding } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
    }).on("error", reject));
  });
  try {
    let { res, body } = await raw("/scramjet/x.js", "br, gzip");
    assert.equal(res.headers["content-encoding"], "br");
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.headers.vary, /Accept-Encoding/i);
    assert.equal(brotliDecompressSync(body).toString(), js);
    ({ res, body } = await raw("/scramjet/x.js", "gzip"));
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.equal(gunzipSync(body).toString(), js);
    ({ res, body } = await raw("/scramjet/x.js", "br;q=0, gzip;q=0"));
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(body.toString(), js);
    ({ res, body } = await raw("/portal", "br"));
    assert.equal(res.headers["content-encoding"], "br");
    assert.match(res.headers["content-type"], /text\/html/);
    assert.equal(brotliDecompressSync(body).toString(), html);
    ({ res } = await raw("/scramjet/x.wasm", "gzip"));
    assert.equal(res.headers["content-type"], "application/wasm");
    ({ res, body } = await get("/scramjet/x.js", { Range: "bytes=0-9" }));
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-encoding"), null);
    assert.equal(body.toString(), js.slice(0, 10));
    ({ res } = await get("/scramjet/missing.js", { "Accept-Encoding": "br" }));
    assert.equal(res.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test("server start script raises the libuv threadpool for concurrent Wisp DNS lookups", async () => {
  const source = await readFile(new URL("../scripts/start-snorlax.mjs", import.meta.url), "utf8");
  assert.match(source, /UV_THREADPOOL_SIZE: process\.env\.UV_THREADPOOL_SIZE \|\| '16'/);
});

test("compat shim is idempotent: running load() repeatedly never stacks history or selector wrappers", async () => {
  const source = await readFile(new URL("../artifacts/snorlax-cave/proxy/scramjet-compat.js", import.meta.url), "utf8");
  const calls = [];
  const queries = [];
  class History { pushState(...a) { calls.push(a); } replaceState(...a) { calls.push(a); } }
  class Document { querySelector(s) { queries.push(s); return null; } querySelectorAll() { return []; } }
  const history = new History();
  history.pushState = history.pushState.bind(history);
  const window = { History, history, Document, location: { href: "https://proxy/p" } };
  const context = vm.createContext({ window, console, $scramjetController: { load() {} } });
  vm.runInContext(source, context);
  const ownBefore = history.pushState;
  for (let i = 0; i < 5; i += 1) context.$scramjetController.load();
  const protoWrapper = History.prototype.replaceState;
  const docWrapper = Document.prototype.querySelector;
  context.$scramjetController.load();
  assert.equal(History.prototype.replaceState, protoWrapper);
  assert.equal(Document.prototype.querySelector, docWrapper);
  assert.equal(history.pushState.__snorlaxCompat, true);
  assert.equal(history.pushState.__snorlaxCompat && history.pushState === history.pushState, true);
  assert.notEqual(history.pushState, ownBefore);
  new Document().querySelector('script[src*="/a/b"]');
  assert.deepEqual(queries, ['script[src*="/a/b"],script[src*="%2Fa%2Fb"]']);
  history.pushState({}, "", undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], "https://proxy/p");
});

test("Tabbed installs its frame hooks once per proxied window", async () => {
  const source = await readFile(new URL("../artifacts/snorlax-cave/public/assets/js/tabbed-browser.js", import.meta.url), "utf8");
  assert.equal((source.match(/hooks\.init\.post/g) || []).length, 1);
  assert.match(source, /iframe\.addEventListener\("load", \(\) => \{\s*if \(tab\.internalRoute\) return;/);
  assert.match(source, /if \(frameWindow\.__fdetkTabbedHooks\) return;\s*frameWindow\.__fdetkTabbedHooks = true;/);
  assert.equal((source.match(/addEventListener\("popstate"/g) || []).length, 1);
  assert.doesNotMatch(source, /setInterval|MutationObserver/);
});

// Mimics libcurl.js: push-based stream, no cancel handler, request freed only via the abort signal.
function mockCurlTransport() {
  const state = { aborted: 0, freed: 0, seen: [], enqueue: null, close: null };
  return {
    state,
    async request(remote, method, body, headers, signal) {
      state.seen.push({ remote: remote.href, method, range: headers.get("range"), hasSignal: Boolean(signal) });
      let controller;
      const stream = new ReadableStream({ start(c) { controller = c; } });
      state.enqueue = (chunk) => { try { controller.enqueue(chunk); } catch { state.freed += 1; } };
      state.close = () => controller.close();
      signal?.addEventListener("abort", () => { state.aborted += 1; state.freed += 1; });
      return { body: stream, headers: [["content-range", "bytes 0-9/10"]], status: 206, statusText: "Partial Content" };
    },
  };
}

test("controller passes no abort signal to the transport and libcurl streams have no cancel handler", async () => {
  const api = await readFile(new URL("../artifacts/snorlax-cave/node_modules/@mercuryworkshop/scramjet-controller/dist/controller.api.js", import.meta.url), "utf8");
  assert.match(api, /transport\.request\(new URL\(\w+\),\w+,\w+,\w+,void 0\)/);
  const curl = await readFile(new URL("../artifacts/snorlax-cave/node_modules/@mercuryworkshop/libcurl-transport/dist/index.mjs", import.meta.url), "utf8");
  const streamDef = curl.slice(curl.indexOf("stream_response(url"), curl.indexOf("stream_response(url") + 400);
  assert.doesNotMatch(streamDef, /cancel\s*\(/);
});

test("cancelling a proxied media body aborts the underlying request and keeps status, range headers and chunks intact", async () => {
  const { cancelableTransport } = await import("../artifacts/snorlax-cave/public/assets/js/scramjet-runtime.js");
  const transport = cancelableTransport(mockCurlTransport());
  assert.equal(cancelableTransport(transport), transport);
  const headers = new Headers({ range: "bytes=0-" });
  const response = await transport.request(new URL("https://media.example/v.mp4?sig=abc&exp=1"), "GET", null, headers, undefined);
  assert.equal(response.status, 206);
  assert.deepEqual(response.headers, [["content-range", "bytes 0-9/10"]]);
  assert.deepEqual(transport.state.seen[0], { remote: "https://media.example/v.mp4?sig=abc&exp=1", method: "GET", range: "bytes=0-", hasSignal: true });
  const reader = response.body.getReader();
  transport.state.enqueue(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...(await reader.read()).value], [1, 2, 3]);
  await reader.cancel("seek");
  assert.equal(transport.state.aborted, 1);
  assert.equal(transport.state.freed, 1);
});

test("a completed media body is not aborted, and a caller abort signal still aborts the request", async () => {
  const { cancelableTransport } = await import("../artifacts/snorlax-cave/public/assets/js/scramjet-runtime.js");
  const done = cancelableTransport(mockCurlTransport());
  const response = await done.request(new URL("https://media.example/a"), "GET", null, new Headers());
  const reader = response.body.getReader();
  done.state.enqueue(new Uint8Array([9]));
  done.state.close();
  assert.equal((await reader.read()).done, false);
  assert.equal((await reader.read()).done, true);
  assert.equal(done.state.aborted, 0);

  const caller = new AbortController();
  const linked = cancelableTransport(mockCurlTransport());
  await linked.request(new URL("https://media.example/b"), "GET", null, new Headers(), caller.signal);
  caller.abort();
  assert.equal(linked.state.aborted, 1);
});

test("every Scramjet controller wraps its libcurl transport once and bodiless responses pass through", async () => {
  const runtime = await readFile(new URL("../artifacts/snorlax-cave/public/assets/js/scramjet-runtime.js", import.meta.url), "utf8");
  assert.equal((runtime.match(/new LibcurlClient\(/g) || []).length, 1);
  assert.match(runtime, /transport: cancelableTransport\(new LibcurlClient\(\{ wisp: wispUrl \}\)\)/);
  const { cancelableTransport } = await import("../artifacts/snorlax-cave/public/assets/js/scramjet-runtime.js");
  const empty = cancelableTransport({ async request() { return { body: null, headers: [], status: 204, statusText: "" }; } });
  assert.equal((await empty.request(new URL("https://x.example/"), "GET", null, new Headers())).body, null);
});

function fixedTransport(headers, chunks) {
  return {
    async request() {
      let i = 0;
      return {
        status: 206, statusText: "", headers,
        body: new ReadableStream({ pull(c) { i < chunks.length ? c.enqueue(chunks[i++]) : c.close(); } }),
      };
    },
  };
}

async function drain(response) {
  const reader = response.body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    bytes += value.byteLength;
  }
}

test("a body that ends short of its Content-Length errors; complete, encoded and HEAD bodies do not", async () => {
  const { cancelableTransport } = await import("../artifacts/snorlax-cave/public/assets/js/scramjet-runtime.js");
  const req = (t, method = "GET") => t.request(new URL("https://m.example/"), method, null, new Headers());
  const short = cancelableTransport(fixedTransport([["Content-Length", "10"]], [new Uint8Array(4)]));
  await assert.rejects(async () => drain(await req(short)), /ended after 4 of 10 bytes/);
  const whole = cancelableTransport(fixedTransport([["Content-Length", "6"]], [new Uint8Array(4), new Uint8Array(2)]));
  assert.equal(await drain(await req(whole)), 6);
  const encoded = cancelableTransport(fixedTransport([["Content-Length", "10"], ["Content-Encoding", "gzip"]], [new Uint8Array(4)]));
  assert.equal(await drain(await req(encoded)), 4);
  const head = cancelableTransport(fixedTransport([["Content-Length", "10"]], []));
  assert.equal(await drain(await req(head, "HEAD")), 0);
});
