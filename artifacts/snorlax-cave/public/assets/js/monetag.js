// Monetag tags for the first-party Casual pages (home, about, apps, games, settings). Casual pages
// navigate with full page loads, so a tag that runs here is torn down on the next navigation.
// Never load these from the shared <head> or from Tabbed: Tabbed is a single document, so a tag that runs
// there (timers, observers, listeners, popups) stays active across every in-app view.
// To disable a tag: set its `enabled` to false.
// In-Page Push is OFF: it overlapped MultiTag and showed two ad layers at once.
export const MONETAG = {
  enabled: false,
  zone: "12130102",
  src: "https://nap5k.com/tag.min.js",
  id: "fdetk-monetag-inpage",
};

// MultiTag (zone 302480). Previously a bare <script> in index.html's <head>, which ran in
// Tabbed too. Its own config keeps it to one request per page and one zone.
export const MONETAG_MULTITAG = {
  enabled: true,
  zone: "302480",
  src: "https://quge5.com/88/tag.min.js",
  id: "fdetk-monetag-multitag",
  cfasync: true,
};

// Available but intentionally INACTIVE (for a later controlled comparison). Nothing reads this.
export const MONETAG_INACTIVE_FORMATS = {
  vignetteBanner: { zone: "12130107", src: "https://n6wxm.com/vignette.min.js" },
};

// Casual only: one tag, zone 302480. Tabbed never loads this file; its home-only slot is the
// isolated document /assets/ads/home-slot.html, mounted by tabbed-browser.js only on fdetk://home.
export const MONETAG_TAGS = [MONETAG_MULTITAG];

// Casual pages are full page loads, so the tag is torn down on every navigation.
export const CASUAL_AD_PATHS = ["/", "/index.html", "/about", "/english", "/math", "/settings"];

export function loadMonetag(win = window, config = MONETAG) {
  try {
    if (!config.enabled || !config.src || !config.zone) return "disabled";
    const requested = (win.__fdetkMonetagRequested ??= {});
    if (requested[config.id]) return "already-requested";
    // Never inside proxied sites, frames, or the proxy wrapper page; each tag only runs in its own interface.
    if (win.top !== win) return "framed";
    const path = win.location.pathname;
    if (path === "/portal" || path.startsWith("/scramjet-proxy/") || path.startsWith("/service/")) return "proxy-page";
    let stored = null;
    try { stored = win.localStorage?.getItem("interfaceMode"); } catch {}
    const isTabbed = win.fdetkInterface === "tabbed" || win.document?.documentElement?.dataset?.interfaceMode === "tabbed" || stored === "tabbed";
    if (isTabbed) return "tabbed";
    if (!CASUAL_AD_PATHS.includes(path)) return "not-casual-page";
    const url = new URL(config.src, win.location.href);
    if (url.protocol !== "https:") return "invalid-src";
    const doc = win.document;
    if (doc.getElementById(config.id)) return "already-requested";

    requested[config.id] = true;
    const script = doc.createElement("script");
    script.id = config.id;
    script.async = true;
    script.src = url.href;
    script.dataset.zone = config.zone;
    if (config.cfasync) script.dataset.cfasync = "false";
    // A failed load is final: no retries, no UI impact.
    script.onerror = () => script.remove();
    doc.head.append(script);
    return "requested";
  } catch {
    return "error";
  }
}

export function scheduleMonetag(win = window) {
  const run = () => MONETAG_TAGS.map((config) => loadMonetag(win, config));
  const idle = () => (win.requestIdleCallback ? win.requestIdleCallback(run, { timeout: 4000 }) : win.setTimeout(run, 2000));
  if (win.document.readyState === "complete") idle();
  else win.addEventListener("load", idle, { once: true });
}

if (typeof window !== "undefined" && typeof document !== "undefined") scheduleMonetag();
