// Monetag In-Page Push (Banner) for first-party portal pages only.
// To enable: paste the script URL from the Monetag tag generated for THIS site into
// MONETAG.src. To disable: set MONETAG.enabled to false (or clear src).
export const MONETAG = {
  enabled: true,
  src: "",
  id: "fdetk-monetag-inpage",
};

export function loadMonetag(win = window, config = MONETAG) {
  try {
    if (!config.enabled || !config.src) return "disabled";
    if (win.__fdetkMonetagRequested) return "already-requested";
    // Never inside proxied sites, frames, the proxy wrapper page, or the Tabbed UI.
    if (win.top !== win) return "framed";
    const path = win.location.pathname;
    if (path === "/portal" || path.startsWith("/scramjet-proxy/") || path.startsWith("/service/")) return "proxy-page";
    if (win.fdetkInterface === "tabbed") return "tabbed";
    const url = new URL(config.src, win.location.href);
    if (url.protocol !== "https:") return "invalid-src";
    const doc = win.document;
    if (doc.getElementById(config.id)) return "already-requested";

    win.__fdetkMonetagRequested = true;
    const script = doc.createElement("script");
    script.id = config.id;
    script.async = true;
    script.src = url.href;
    script.dataset.cfasync = "false";
    // A failed load is final: no retries, no UI impact.
    script.onerror = () => script.remove();
    doc.head.append(script);
    return "requested";
  } catch {
    return "error";
  }
}

export function scheduleMonetag(win = window) {
  const run = () => loadMonetag(win);
  const idle = () => (win.requestIdleCallback ? win.requestIdleCallback(run, { timeout: 4000 }) : win.setTimeout(run, 2000));
  if (win.document.readyState === "complete") idle();
  else win.addEventListener("load", idle, { once: true });
}

if (typeof window !== "undefined" && typeof document !== "undefined") scheduleMonetag();
