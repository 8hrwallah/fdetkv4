import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const shimUrl = new URL("../artifacts/snorlax-cave/proxy/scramjet-compat.js", import.meta.url);
const runtimeUrl = new URL("../artifacts/snorlax-cave/public/assets/js/scramjet-runtime.js", import.meta.url);

const CLOUDFLARE_SRC =
  "https://proxy.test/scramjet-proxy/abc/def/https%3A%2F%2Fdiscord.com%2Fcdn-cgi%2Fchallenge-platform%2Fscripts%2Fjsd%2Fmain.js%3Fray%3D1?%24io=null";

// A minimal DOM: just the surface the shim touches. `frames` maps an iframe to its window.
function createEnvironment({ fetchImpl, extraWindow } = {}) {
  const fetchCalls = [];
  const inserted = [];
  const releasedBlobs = [];

  class HTMLScriptElement {
    constructor(src, type) {
      this.nodeName = "SCRIPT";
      this._src = src;
      this.type = type || "";
      this.listeners = {};
    }
    get src() { return this._src; }
    set src(value) { this._src = value; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    fire(name) { (this.listeners[name] || []).forEach((fn) => fn()); }
  }

  class HTMLIFrameElement {
    constructor(attributes = {}) {
      this.attributes = attributes;
      this.nativeWindow = createFrameWindow();
    }
    hasAttribute(name) { return name in this.attributes; }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    get contentWindow() { return this.nativeWindow; }
    get contentDocument() { return this.nativeWindow.document; }
  }

  function createFrameWindow() {
    class Node {
      appendChild(node) { inserted.push({ via: "appendChild", node, parent: this }); return node; }
      insertBefore(node) { inserted.push({ via: "insertBefore", node, parent: this }); return node; }
    }
    const win = { Node, fetch: function frameFetch() {}, XMLHttpRequest: function FrameXhr() {} };
    win.document = { defaultView: win };
    return win;
  }

  const parentFetch = (url, options) => {
    fetchCalls.push({ url, options });
    return (fetchImpl || (async () => ({ ok: true, status: 200, text: async () => "window.__ran = 1;" })))(url, options);
  };
  const win = {
    HTMLIFrameElement,
    HTMLScriptElement,
    fetch: parentFetch,
    XMLHttpRequest: function ParentXhr() {},
    location: { href: "https://proxy.test/scramjet/x" },
    ...extraWindow,
  };
  const nodeUrl = Object.assign(function URLShim(...args) { return new URL(...args); }, {
    createObjectURL(blob) { return `blob:test/${blob.size}`; },
    revokeObjectURL(url) { releasedBlobs.push(url); },
  });
  const context = vm.createContext({
    window: win,
    HTMLIFrameElement,
    HTMLScriptElement,
    URL: nodeUrl,
    Blob,
    Promise,
    WeakSet,
    console,
    $scramjetController: { load() { return Promise.resolve(); } },
  });
  vm.runInContext(shimSource, context);
  return { context, win, HTMLIFrameElement, HTMLScriptElement, fetchCalls, inserted, releasedBlobs };
}

const shimSource = await readFile(shimUrl, "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function loaded(env) {
  await env.context.$scramjetController.load();
  await flush();
}

test("about:blank iframes get their fetch/XHR routed through the service-worker-controlled document", async () => {
  for (const attributes of [{}, { src: "about:blank" }]) {
    const env = createEnvironment();
    await loaded(env);
    const frame = new env.HTMLIFrameElement(attributes);
    const frameWindow = frame.contentWindow;
    assert.notEqual(frameWindow.fetch.name, "frameFetch");
    await frameWindow.fetch("https://proxy.test/scramjet-proxy/a/b/https%3A%2F%2Fexample.com%2F");
    assert.equal(env.fetchCalls.length, 1);
    assert.equal(frameWindow.XMLHttpRequest, env.win.XMLHttpRequest);
    // contentDocument.defaultView is prepared the same way
    const second = new env.HTMLIFrameElement({});
    second.contentDocument;
    assert.equal(second.nativeWindow.XMLHttpRequest, env.win.XMLHttpRequest);
  }
});

test("Cloudflare challenge script: an injected <script src> in a blank frame is fetched by the parent and run from a blob", async () => {
  const env = createEnvironment();
  await loaded(env);
  const frame = new env.HTMLIFrameElement({});
  const frameWindow = frame.contentWindow;
  const head = new frameWindow.Node();
  const script = new env.HTMLScriptElement(CLOUDFLARE_SRC);

  assert.equal(head.appendChild(script), script);
  // Nothing is inserted (and so nothing can escape to the origin) until the parent fetch finishes.
  assert.equal(env.inserted.length, 0);
  assert.deepEqual(env.fetchCalls.map((call) => call.url), [CLOUDFLARE_SRC]);
  assert.equal(env.fetchCalls[0].options.credentials, "include");

  await flush();
  assert.equal(env.inserted.length, 1);
  assert.equal(env.inserted[0].node, script);
  assert.match(script.src, /^blob:/);
  script.fire("load");
  assert.deepEqual(env.releasedBlobs, [script.src]);
});

test("a failed parent fetch falls back to the original insertion exactly once", async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 404, text: async () => "" }),
    async () => { throw new TypeError("network"); },
  ]) {
    const env = createEnvironment({ fetchImpl });
    await loaded(env);
    const frameWindow = new env.HTMLIFrameElement({}).contentWindow;
    const script = new env.HTMLScriptElement(CLOUDFLARE_SRC);
    new frameWindow.Node().insertBefore(script, null);
    await flush();
    assert.equal(env.inserted.length, 1);
    assert.equal(env.inserted[0].via, "insertBefore");
    assert.equal(script.src, CLOUDFLARE_SRC);
  }
});

test("normal iframes (src, srcdoc) and non-script nodes are left untouched", async () => {
  const env = createEnvironment();
  await loaded(env);
  for (const attributes of [{ src: "https://proxy.test/scramjet-proxy/a/b/https%3A%2F%2Fexample.com%2F" }, { srcdoc: "<p>x</p>" }, { src: "/portal" }]) {
    const frame = new env.HTMLIFrameElement(attributes);
    const frameWindow = frame.contentWindow;
    assert.equal(frameWindow.fetch.name, "frameFetch");
    const script = new env.HTMLScriptElement(CLOUDFLARE_SRC);
    new frameWindow.Node().appendChild(script);
    assert.equal(env.inserted.at(-1).node, script, "script inserted synchronously");
    assert.equal(script.src, CLOUDFLARE_SRC);
  }
  assert.equal(env.fetchCalls.length, 0);

  // Inside a prepared blank frame, module, inline and non-http scripts and other nodes still pass straight through.
  const blank = new env.HTMLIFrameElement({}).contentWindow;
  const parent = new blank.Node();
  const before = env.inserted.length;
  const others = [
    new env.HTMLScriptElement(CLOUDFLARE_SRC, "module"),
    new env.HTMLScriptElement(""),
    new env.HTMLScriptElement("data:text/javascript,1"),
    { nodeName: "DIV" },
  ];
  others.forEach((node) => parent.appendChild(node));
  assert.equal(env.inserted.length - before, others.length);
  assert.equal(env.fetchCalls.length, 0);
});

test("the workaround never touches the top-level document or other windows", async () => {
  const env = createEnvironment();
  const parentFetch = env.win.fetch;
  const parentXhr = env.win.XMLHttpRequest;
  await loaded(env);
  assert.equal(env.win.fetch, parentFetch);
  assert.equal(env.win.XMLHttpRequest, parentXhr);
  // Only HTMLIFrameElement window getters change; nothing prepares a frame until its window is read.
  const frame = new env.HTMLIFrameElement({});
  assert.equal(frame.nativeWindow.fetch.name, "frameFetch");
});

test("blank-frame wrappers are idempotent across repeated load() and reads", async () => {
  const env = createEnvironment();
  await loaded(env);
  const getter = Object.getOwnPropertyDescriptor(env.HTMLIFrameElement.prototype, "contentWindow").get;
  assert.equal(getter.__snorlaxCompat, true);
  for (let i = 0; i < 4; i += 1) await loaded(env);
  assert.equal(Object.getOwnPropertyDescriptor(env.HTMLIFrameElement.prototype, "contentWindow").get, getter);

  const frame = new env.HTMLIFrameElement({});
  const frameWindow = frame.contentWindow;
  const wrappedAppend = frameWindow.Node.prototype.appendChild;
  const wrappedFetch = frameWindow.fetch;
  frame.contentWindow;
  frame.contentDocument;
  assert.equal(frameWindow.Node.prototype.appendChild, wrappedAppend);
  assert.equal(frameWindow.fetch, wrappedFetch);

  const script = new env.HTMLScriptElement(CLOUDFLARE_SRC);
  new frameWindow.Node().appendChild(script);
  await flush();
  assert.equal(env.fetchCalls.length, 1, "a script is fetched once, not once per stacked wrapper");
  assert.equal(env.inserted.length, 1);
});

test("shim loads harmlessly where there are no iframes (workers) and keeps the history/selector fixes", async () => {
  const calls = [];
  const queries = [];
  class History { pushState(...a) { calls.push(a); } replaceState(...a) { calls.push(a); } }
  class Document { querySelector(s) { queries.push(s); return null; } querySelectorAll() { return []; } }
  const win = { History, Document, history: new History(), location: { href: "https://proxy/p" } };
  const context = vm.createContext({ window: win, console, $scramjetController: { load() {} } });
  vm.runInContext(shimSource, context);
  context.$scramjetController.load();
  await flush();
  win.history.replaceState({}, "", undefined);
  assert.equal(calls[0][2], "https://proxy/p");
  new Document().querySelector('script[src*="/secsdk_runtime_bundler"]');
  assert.deepEqual(queries, ['script[src*="/secsdk_runtime_bundler"],script[src*="%2Fsecsdk_runtime_bundler"]']);
});

test("history and selector fixes still apply when the blank-frame fix is active", async () => {
  const queries = [];
  const calls = [];
  class History { replaceState(...a) { calls.push(a); } pushState(...a) { calls.push(a); } }
  class Document { querySelector(s) { queries.push(s); } querySelectorAll() { return []; } }
  const env = createEnvironment({ extraWindow: { History, Document, history: new History() } });
  await loaded(env);
  env.win.history.replaceState({}, "", null);
  assert.equal(calls[0][2], "https://proxy.test/scramjet/x");
  new Document().querySelector('a[href*="/x/y"]');
  assert.deepEqual(queries, ['a[href*="/x/y"],a[href*="%2Fx%2Fy"]']);
  assert.equal(Object.getOwnPropertyDescriptor(env.HTMLIFrameElement.prototype, "contentWindow").get.__snorlaxCompat, true);
});

// The inject script is cached for an hour, so its URL query must change whenever the shim does.
// When this fails after a shim edit: bump `?v=compat-N` in scramjet-runtime.js, then update both constants.
const EXPECTED_SHIM_DIGEST = "f13fc61dfbe4"; // first 12 hex chars of sha256(proxy/scramjet-compat.js)
const EXPECTED_INJECT_VERSION = "compat-5";

test("injectPath version query is a cache-buster bound to the shim contents", async () => {
  const runtime = await readFile(runtimeUrl, "utf8");
  const match = runtime.match(/injectPath:\s*"\/controller\/snorlax\.inject\.js\?v=([^"]+)"/);
  assert.ok(match, "injectPath must carry a ?v= query");
  assert.equal(match[1], EXPECTED_INJECT_VERSION);
  const digest = createHash("sha256").update(shimSource).digest("hex").slice(0, 12);
  assert.equal(digest, EXPECTED_SHIM_DIGEST, `scramjet-compat.js changed (digest ${digest}): bump injectPath ?v= in scramjet-runtime.js and update this test`);
  const app = await readFile(new URL("../artifacts/api-server/src/app.ts", import.meta.url), "utf8");
  assert.match(app, /\(assets\|uv\|scramjet\|controller\|libcurl\)[\s\S]*max-age=3600/);
});

test("built snorlax.inject.js ends with the current shim and the stock inject script is unchanged", async (t) => {
  const dist = new URL("../artifacts/snorlax-cave/dist/public/controller/", import.meta.url);
  if (!existsSync(new URL("snorlax.inject.js", dist))) return t.skip("frontend not built");
  const snorlax = await readFile(new URL("snorlax.inject.js", dist), "utf8");
  const stock = await readFile(new URL("controller.inject.js", dist), "utf8");
  assert.ok(snorlax.endsWith(`\n${shimSource}`), "dist snorlax.inject.js must embed the current shim");
  assert.ok(snorlax.startsWith(stock));
  assert.ok(!stock.includes("installBlankFrameCompat"));
});

test("a request that skips the service worker reaches Express and 404s (documents why the workaround exists)", async () => {
  const app = await readFile(new URL("../artifacts/api-server/src/app.ts", import.meta.url), "utf8");
  // No catch-all or /scramjet-proxy/ handler exists in Express, so any proxied URL that bypasses the
  // service worker is answered by Express's own HTML 404.
  assert.doesNotMatch(app, /app\.(use|get|all)\(\s*["'`]\/scramjet-proxy/);
  assert.doesNotMatch(app, /app\.(use|get|all)\(\s*["'`]\*/);
});
