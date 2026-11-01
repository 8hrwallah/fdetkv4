// Controlled popup ad. It only runs in the top-level portal pages listed below, opens one new tab
// per genuine click, and never touches navigation. The tab opens directly at the Scramjet URL for
// the ad, built with the shared controller and a dedicated detached frame (the user's own proxy
// target is never touched). The service worker routes that URL through the controller page, so the
// page that opened the tab must stay open for the ad tab to keep loading.
// Change CONFIG.enabled to switch the whole feature on or off.
(function (global) {
  "use strict";

  var CONFIG = {
    enabled: true,
    url: "https://uplcm.com/4/12106796",
    cooldownMs: 7000,
    maxPerWindow: 10,
    windowMs: 60 * 60 * 1000,
    // Optional opt-in list of interface modes (localStorage.interfaceMode) to silence. Empty by
    // default: the route list, top-window check and proxied-frame check already keep it out of
    // /portal and proxied sessions in every mode.
    suppressedModes: [],
    eligiblePaths: [
      "/", "/index.html",
      "/english", "/apps.html",
      "/math", "/games.html",
      "/about", "/about.html",
      "/settings", "/settings.html",
    ],
    storageKey: "popupAd.v1",
    proxyPrefix: "/scramjet-proxy/",
    runtimePath: "/assets/js/scramjet-runtime.js?v=shared-runtime-5",
  };

  var PROXIED_FRAME = 'iframe[src*="/scramjet-proxy/"], iframe[src*="/service/"]';
  var IGNORED_TARGETS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-popup-ad="off"]';

  // Same builder Frame.go() uses: rewriteUrl(url, frame.context, ...) => frame.prefix + encoded URL.
  function defaultBuildProxyUrl(win, adUrl, cfg) {
    return import(cfg.runtimePath).then(function (runtime) {
      return runtime.getScramjetController();
    }).then(function (controller) {
      var frame = controller.createFrame();
      var here = new URL(win.location.href);
      return win.$scramjet.rewriteUrl(adUrl, frame.context, { origin: here, base: here });
    });
  }

  function createPopupAd(overrides, env) {
    var cfg = Object.assign({}, CONFIG, overrides);
    var win = (env && env.window) || global;
    var now = (env && env.now) || Date.now;
    var buildProxyUrl = (env && env.buildProxyUrl) || defaultBuildProxyUrl;
    var lastAttempt = -Infinity;
    var proxyUrl = null;
    var preparing = null;
    var lastPrepare = -Infinity;

    function localStore() {
      try {
        return win.localStorage;
      } catch (_error) {
        return null;
      }
    }

    function isTopWindow() {
      try {
        return win.top === win;
      } catch (_error) {
        return false;
      }
    }

    function normalizedPath() {
      var path = String(win.location.pathname || "/").toLowerCase();
      return path.length > 1 && path.charAt(path.length - 1) === "/" ? path.slice(0, -1) : path;
    }

    function currentMode(store) {
      return store.getItem("interfaceMode") === "tabbed" ? "tabbed" : "casual";
    }

    function eligibility() {
      if (!cfg.enabled) return "disabled";
      if (!isTopWindow()) return "embedded";
      if (cfg.eligiblePaths.indexOf(normalizedPath()) === -1) return "page";
      var store = localStore();
      if (!store) return "storage-unavailable";
      if (cfg.suppressedModes.indexOf(currentMode(store)) !== -1) return "mode";
      if (win.document.querySelector(PROXIED_FRAME)) return "proxied-content";
      return "ok";
    }

    // Cooldown applies to every eligible attempt (including blocked popups); the cap counts the same attempts.
    function reserveSlot() {
      var store = localStore();
      var t = now();
      var attempts = [];
      try {
        var saved = JSON.parse(store.getItem(cfg.storageKey));
        if (saved && Array.isArray(saved.attempts)) {
          attempts = saved.attempts.filter(function (a) {
            return typeof a === "number" && isFinite(a) && a <= t && t - a < cfg.windowMs;
          });
        }
      } catch (_error) {
        attempts = [];
      }
      var last = attempts.reduce(function (max, a) { return Math.max(max, a); }, lastAttempt);
      if (t - last < cfg.cooldownMs) return "cooldown";
      if (attempts.length >= cfg.maxPerWindow) return "frequency-cap";
      attempts.push(t);
      try {
        store.setItem(cfg.storageKey, JSON.stringify({ attempts: attempts }));
      } catch (_error) {
        return "storage-unavailable";
      }
      lastAttempt = t;
      return "ok";
    }

    // Only a same-origin /scramjet-proxy/ URL is ever opened.
    function validProxyUrl(value) {
      try {
        var parsed = new URL(String(value), win.location.href);
        var here = new URL(win.location.href);
        if (parsed.origin !== here.origin || parsed.pathname.indexOf(cfg.proxyPrefix) !== 0) return null;
        return parsed.href;
      } catch (_error) {
        return null;
      }
    }

    // Boots the controller on the first eligible interaction (never on load); throttled on failure.
    function prepare() {
      if (proxyUrl || preparing) return preparing;
      var t = now();
      if (t - lastPrepare < cfg.cooldownMs) return null;
      lastPrepare = t;
      preparing = Promise.resolve()
        .then(function () { return buildProxyUrl(win, cfg.url, cfg); })
        .then(function (url) { proxyUrl = validProxyUrl(url); })
        .catch(function () { proxyUrl = null; })
        .then(function () { preparing = null; });
      return preparing;
    }

    function openAd() {
      var opened = null;
      try {
        opened = win.open(proxyUrl, "_blank");
      } catch (_error) {
        opened = null;
      }
      if (!opened) return "blocked";
      try {
        opened.opener = null;
      } catch (_error) {
        // ignore
      }
      return "opened";
    }

    function attempt() {
      var reason = eligibility();
      if (reason !== "ok") return reason;
      if (!proxyUrl) {
        prepare();
        return "preparing";
      }
      reason = reserveSlot();
      if (reason !== "ok") return reason;
      return openAd();
    }

    function onClick(event) {
      if (!event.isTrusted || (typeof event.button === "number" && event.button !== 0)) return;
      var target = event.target;
      if (target && typeof target.closest === "function" && target.closest(IGNORED_TARGETS)) return;
      attempt();
    }

    function start() {
      if (!cfg.enabled || win.__popupAdStarted || !isTopWindow()) return;
      win.__popupAdStarted = true;
      win.document.addEventListener("click", onClick, { capture: true, passive: true });
    }

    return {
      attempt: attempt,
      start: start,
      eligibility: eligibility,
      ready: function () { return preparing || Promise.resolve(); },
      config: cfg,
    };
  }

  var api = { create: createPopupAd, defaults: CONFIG };
  if (global.document) {
    global.PopupAd = api;
    createPopupAd().start();
  }
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
