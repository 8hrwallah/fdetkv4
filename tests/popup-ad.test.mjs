import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/snorlax-cave");
const moduleBox = { exports: {} };
vm.runInNewContext(readFileSync(path.join(root, "public/assets/js/popup-ad.js"), "utf8"), { module: moduleBox, Date, Object, Array, JSON, Math, Number, isFinite, URL, String });
const popupAd = moduleBox.exports;
const AD_URL = "https://uplcm.com/4/12106796";

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

const PROXY_URL = "http://portal.test/scramjet-proxy/ctl123/frm456/https%3A%2F%2Fuplcm.com%2F4%2F12106796";

function makeEnv({ path: pathname = "/", local = {}, embedded = false, proxiedFrame = false, openResult = {}, proxyUrl = PROXY_URL, buildFails = false } = {}) {
  const localStorage = makeStorage(local);
  const sessionStorage = makeStorage();
  const listeners = [];
  const opens = [];
  const builds = [];
  const navigations = [];
  const clock = { t: 1_000_000 };
  const win = {
    location: {
      pathname,
      href: `http://portal.test${pathname}`,
      assign: (u) => navigations.push(u),
      replace: (u) => navigations.push(u),
    },
    localStorage,
    sessionStorage,
    document: {
      querySelector: () => (proxiedFrame ? {} : null),
      addEventListener: (type, fn, options) => listeners.push({ type, fn, options }),
    },
    open(url, target) {
      opens.push({ url, target });
      return openResult === null ? null : openResult;
    },
  };
  win.top = embedded ? {} : win;
  const buildProxyUrl = async (_win, adUrl) => {
    builds.push(adUrl);
    if (buildFails) throw new Error("controller unavailable");
    return typeof proxyUrl === "function" ? proxyUrl() : proxyUrl;
  };
  const click = (extra = {}) => {
    for (const l of listeners) l.fn({ isTrusted: true, button: 0, target: { closest: () => null }, ...extra });
  };
  return { win, opens, builds, navigations, listeners, clock, localStorage, sessionStorage, click, buildProxyUrl, now: () => clock.t };
}

// A popup only opens once the proxy URL has been prepared by an earlier eligible interaction.
async function build(envOptions, overrides = {}) {
  const env = makeEnv(envOptions);
  const ad = popupAd.create({ ...overrides }, { window: env.win, now: env.now, buildProxyUrl: env.buildProxyUrl });
  return { ...env, ad };
}

async function prime(env) {
  const first = env.ad.attempt();
  await env.ad.ready();
  return first;
}

async function ready(envOptions, overrides) {
  const env = await build(envOptions, overrides);
  await prime(env);
  return env;
}

test("ships enabled, 7 second cooldown, 10 per hour, no global mode suppression", async () => {
  assert.equal(popupAd.defaults.enabled, true);
  assert.deepEqual([...popupAd.defaults.suppressedModes], []);
  assert.equal(popupAd.defaults.url, AD_URL);
  assert.equal(popupAd.defaults.cooldownMs, 7000);
  assert.equal(popupAd.defaults.maxPerWindow, 10);
  assert.equal(popupAd.defaults.proxyPrefix, "/scramjet-proxy/");

  const env = await build();
  env.ad.start();
  assert.equal(env.listeners.length, 1);
  assert.equal(env.listeners[0].type, "click");
  assert.equal(env.builds.length, 0);
});

test("global switch: disabled never prepares or opens, enabled does", async () => {
  const off = await build({}, { enabled: false });
  off.ad.start();
  off.click();
  await off.ad.ready();
  assert.equal(off.opens.length, 0);
  assert.equal(off.builds.length, 0);
  assert.equal(off.listeners.length, 0);
  assert.equal(off.ad.attempt(), "disabled");

  const on = await ready();
  assert.equal(on.ad.attempt(), "opened");
  assert.equal(on.opens.length, 1);
});

test("loading the page never prepares the proxy or opens anything", async () => {
  const env = await build();
  env.ad.start();
  await env.ad.ready();
  assert.equal(env.builds.length, 0);
  assert.equal(env.opens.length, 0);
  assert.equal(env.localStorage.map.size, 0);
});

test("first eligible click only prepares (no popup, no cooldown used), then opens", async () => {
  const env = await build();
  env.ad.start();
  env.click();
  await env.ad.ready();
  assert.deepEqual(env.builds, [AD_URL]);
  assert.equal(env.opens.length, 0);
  assert.equal(env.localStorage.getItem("popupAd.v1"), null);
  env.click();
  assert.equal(env.opens.length, 1);
  assert.equal(env.builds.length, 1);
});

test("opens directly at the /scramjet-proxy/ URL, never /portal, and leaves proxy state alone", async () => {
  const env = await ready();
  env.ad.attempt();
  assert.equal(env.opens.length, 1);
  assert.equal(env.opens[0].url, PROXY_URL);
  assert.equal(env.opens[0].target, "_blank");
  assert.ok(new URL(env.opens[0].url).pathname.startsWith("/scramjet-proxy/"));
  assert.ok(!env.opens.some((o) => new URL(o.url).pathname === "/portal"));
  assert.equal(env.localStorage.getItem("proxyTargetUrl"), null);
  assert.equal(env.localStorage.getItem("proxyEngine"), null);
  assert.equal(env.localStorage.getItem("encodedUrl"), null);
  assert.equal(env.sessionStorage.map.size, 0);
  assert.deepEqual(env.navigations, []);
});

test("eligible on Home, Apps, Games, About and Settings routes and files", async () => {
  for (const p of ["/", "/index.html", "/english", "/apps.html", "/math", "/Games.html", "/about", "/About.html", "/settings", "/Settings.html", "/about/"]) {
    const env = await ready({ path: p });
    assert.equal(env.ad.attempt(), "opened", p);
    assert.equal(env.opens.length, 1, p);
  }
});

test("not eligible on portal, dashboard, proxied URLs or unknown pages", async () => {
  for (const p of ["/portal", "/dashboard", "/chat", "/scramjet-proxy/a/b/https%3A%2F%2Fdiscord.com", "/service/abc", "/mobile.html"]) {
    const env = await build({ path: p });
    assert.equal(env.ad.attempt(), "page", p);
    await env.ad.ready();
    assert.equal(env.builds.length, 0, p);
    assert.equal(env.opens.length, 0, p);
  }
});

test("Tabbed and Casual modes do not globally disable it on any eligible page", async () => {
  for (const mode of ["tabbed", "casual", undefined]) {
    for (const p of ["/", "/english", "/math", "/about", "/settings"]) {
      const env = await ready({ path: p, local: mode ? { interfaceMode: mode } : {} });
      assert.equal(env.ad.attempt(), "opened", `${mode} ${p}`);
      assert.equal(env.opens.length, 1);
    }
  }
});

test("neither mode lets it run in the portal, proxied sessions or embedded frames", async () => {
  for (const mode of ["tabbed", "casual"]) {
    const local = { interfaceMode: mode };
    for (const p of ["/portal", "/dashboard", "/scramjet-proxy/a/b/https%3A%2F%2Fdiscord.com"]) {
      const env = await build({ path: p, local });
      assert.equal(env.ad.attempt(), "page", `${mode} ${p}`);
      assert.equal(env.opens.length, 0);
    }
    const active = await build({ local, proxiedFrame: true });
    assert.equal(active.ad.attempt(), "proxied-content");
    await active.ad.ready();
    assert.equal(active.builds.length, 0);
    const embedded = await build({ local, embedded: true });
    embedded.ad.start();
    assert.equal(embedded.listeners.length, 0);
    assert.equal(embedded.ad.attempt(), "embedded");
  }
});

test("the opt-in suppressedModes list still works when configured", async () => {
  const env = await ready({ local: { interfaceMode: "tabbed" } }, { suppressedModes: ["tabbed"] });
  assert.equal(env.ad.attempt(), "mode");
  const casual = await ready({ local: { interfaceMode: "casual" } }, { suppressedModes: ["tabbed"] });
  assert.equal(casual.ad.attempt(), "opened");
});

test("rapid clicks cannot bypass the exact 7 second cooldown", async () => {
  const env = await ready();
  env.ad.start();
  for (let i = 0; i < 20; i++) env.click();
  assert.equal(env.opens.length, 1);
  env.clock.t += 6999;
  env.click();
  assert.equal(env.opens.length, 1);
  env.clock.t += 1;
  env.click();
  assert.equal(env.opens.length, 2);
});

test("cooldown and frequency state persist across page navigation and reloads", async () => {
  const first = await ready({ path: "/" });
  assert.equal(first.ad.attempt(), "opened");

  // a fresh page object (navigation) sharing the same localStorage
  const nextWin = { ...first.win, location: { ...first.win.location, pathname: "/settings", href: "http://portal.test/settings" } };
  nextWin.top = nextWin;
  const nav = popupAd.create({}, { window: nextWin, now: first.now, buildProxyUrl: first.buildProxyUrl });
  nav.attempt();
  await nav.ready();
  assert.equal(nav.attempt(), "cooldown");
  first.clock.t += 7000;
  assert.equal(nav.attempt(), "opened");
  assert.equal(first.opens.length, 2);
});

test("frequency cap: 10 per rolling hour, 11th blocked, slot frees as attempts age out", async () => {
  const env = await ready();
  assert.equal(popupAd.defaults.windowMs, 3_600_000);
  const start = env.clock.t;
  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push(env.ad.attempt());
    env.clock.t += 7000;
  }
  assert.deepEqual(results, Array(10).fill("opened"));
  assert.equal(env.opens.length, 10);
  assert.equal(env.ad.attempt(), "frequency-cap");
  assert.equal(env.opens.length, 10);

  // rolling, not fixed: the oldest attempt expires exactly windowMs after it was made
  env.clock.t = start + 3_600_000 - 1;
  assert.equal(env.ad.attempt(), "frequency-cap");
  env.clock.t = start + 3_600_000;
  assert.equal(env.ad.attempt(), "opened");
  assert.equal(env.opens.length, 11);
  // the second-oldest (start+7000) is still inside the window, so the cap holds again
  env.clock.t += 7000 - 1;
  assert.equal(env.ad.attempt(), "cooldown");
  env.clock.t += 1;
  assert.equal(env.ad.attempt(), "opened");
  assert.equal(env.ad.attempt(), "cooldown");
});

test("ignores untrusted events, non-primary buttons and form fields", async () => {
  const env = await ready();
  env.ad.start();
  env.click({ isTrusted: false });
  env.click({ button: 2 });
  env.click({ target: { closest: () => ({}) } });
  assert.equal(env.opens.length, 0);
  env.click();
  assert.equal(env.opens.length, 1);
});

test("blocked popups fail quietly: no redirect, no /portal, cooldown still applies", async () => {
  const env = await ready({ openResult: null });
  env.ad.start();
  const before = env.win.location.href;
  env.click();
  assert.equal(env.opens.length, 1);
  assert.equal(env.win.location.href, before);
  assert.deepEqual(env.navigations, []);
  env.click();
  assert.equal(env.opens.length, 1);
});

test("if the proxy URL cannot be generated nothing opens and no cooldown slot is used", async () => {
  for (const opts of [{ buildFails: true }, { proxyUrl: null }, { proxyUrl: "https://uplcm.com/4/12106796" }, { proxyUrl: "http://evil.test/scramjet-proxy/a/b/c" }, { proxyUrl: "/portal" }]) {
    const env = await build(opts);
    env.ad.start();
    env.click();
    await env.ad.ready();
    env.click();
    assert.equal(env.opens.length, 0, JSON.stringify(opts));
    assert.deepEqual(env.navigations, []);
    assert.equal(env.localStorage.getItem("popupAd.v1"), null);
  }
});

test("a failed preparation is retried, but not faster than the cooldown", async () => {
  let fail = true;
  const env = await build({ proxyUrl: () => { if (fail) throw new Error("x"); return PROXY_URL; } });
  env.ad.start();
  env.click();
  await env.ad.ready();
  fail = false;
  env.click();
  await env.ad.ready();
  assert.equal(env.builds.length, 1);
  env.clock.t += 7000;
  env.click();
  await env.ad.ready();
  assert.equal(env.builds.length, 2);
  env.click();
  assert.equal(env.opens.length, 1);
  assert.equal(env.opens[0].url, PROXY_URL);
});

test("unavailable storage means no popup", async () => {
  const env = await ready();
  env.win.localStorage = { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem() {} };
  assert.equal(env.ad.attempt(), "storage-unavailable");
  assert.equal(env.opens.length, 0);
});

test("default builder uses the shared controller, a detached frame and Scramjet's own rewriteUrl", () => {
  const src = readFileSync(path.join(root, "public/assets/js/popup-ad.js"), "utf8");
  assert.match(src, /getScramjetController\(\)/);
  assert.match(src, /controller\.createFrame\(\)/);
  assert.match(src, /\$scramjet\.rewriteUrl\(adUrl, frame\.context/);
  assert.ok(!/\/portal/.test(src.replace(/\/\/.*$/gm, "")));
  assert.ok(!/sessionStorage|popupAdTarget/.test(src));
  const runtime = readFileSync(path.join(root, "public/assets/js/scramjet-runtime.js"), "utf8");
  assert.match(runtime, /prefix: "\/scramjet-proxy\/"/);
  assert.match(src, new RegExp(popupAd.defaults.runtimePath.replace(/[.?]/g, "\\$&")));
});

test("wiring: five pages load the module; the portal has no ad handoff", () => {
  for (const file of ["index.html", "public/Apps.html", "public/Games.html", "public/About.html", "public/Settings.html"]) {
    const html = readFileSync(path.join(root, file), "utf8");
    assert.match(html, /\/assets\/js\/popup-ad\.js\?v=popup-ad-4/, file);
    // the Vite build trims index.html after its first </html>, so the tag must come before it
    if (file === "index.html") assert.ok(html.indexOf("popup-ad.js") < html.toLowerCase().indexOf("</html"));
  }
  for (const file of ["public/loader.html", "public/mobile.html", "public/chat.html"]) {
    try {
      assert.doesNotMatch(readFileSync(path.join(root, file), "utf8"), /popup-ad\.js/, file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const proxy = readFileSync(path.join(root, "public/assets/js/portal-proxy.js"), "utf8");
  assert.ok(!/popupAd|uplcm/.test(proxy));
});
