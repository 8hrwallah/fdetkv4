import { resolveProxyEngine } from "./proxy-engine.js";
import { getScramjetController } from "./scramjet-runtime.js?v=shared-runtime-3";

let frame = document.getElementById("siteurl");
const status = document.getElementById("proxy-status");

window.__proxyHostDiagnostics = async () => {
  const canvas = document.createElement("canvas");
  let webgl = false;
  let webglError;
  try {
    webgl = Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch (error) {
    webglError = error instanceof Error ? error.message : String(error);
  }

  const inspectAsset = async (url) => {
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        cacheControl: response.headers.get("cache-control"),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    context: "outer portal only",
    protocol: location.protocol,
    isSecureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    webAssembly: typeof WebAssembly !== "undefined",
    webGL: webgl,
    webGLError: webglError,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    serviceWorker: "serviceWorker" in navigator,
    scramjetWasm: await inspectAsset("/scramjet/scramjet.wasm"),
    uvServiceWorker: await inspectAsset("/sw.js"),
  };
};

function showError(error) {
  if (!status) {
    console.error("Proxy page status element is missing:", error);
    return;
  }

  status.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = "The proxy could not start.";

  const detail = document.createElement("span");
  detail.textContent = error instanceof AggregateError
    ? error.errors.map((reason) => reason instanceof Error ? reason.message : String(reason)).join(" ")
    : error instanceof Error ? error.message : String(error);

  const home = document.createElement("a");
  home.href = "/";
  home.textContent = "Return to INSTA XC4RS";

  status.append(title, detail, home);
  status.hidden = false;
}

async function ensureUvConfig() {
  if (window.__uv$config?.encodeUrl && window.__uv$config?.decodeUrl) return;
  await loadClassicScript("/uv/uv.bundle.js");
  await loadClassicScript("/uv/uv.config.js");

  if (!window.__uv$config?.encodeUrl || !window.__uv$config?.decodeUrl) {
    throw new Error("UV configuration did not load");
  }
}

async function getTargetUrl(engine) {
  const storedTarget = localStorage.getItem("proxyTargetUrl");
  if (storedTarget) return new URL(storedTarget).href;

  const legacyEncodedUrl = localStorage.getItem("encodedUrl");
  if (!legacyEncodedUrl) return "";

  await ensureUvConfig();
  const decoded = window.__uv$config.decodeUrl(legacyEncodedUrl);
  const target = new URL(decoded);
  if (engine !== "uv") localStorage.setItem("proxyTargetUrl", target.href);
  return target.href;
}

async function startUltraviolet(targetUrl) {
  await ensureUvConfig();

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: window.__uv$config.prefix,
    updateViaCache: "none",
  });
  await window.waitForActiveServiceWorker(registration);

  frame.src = window.__uv$config.prefix + window.__uv$config.encodeUrl(targetUrl);
}

async function startScramjet(targetUrl) {
  const controller = await getScramjetController();

  window.__scramjetController = controller;
  const proxyFrame = controller.createFrame(frame);
  window.__scramjetFrame = proxyFrame;
  window.$scramjet.Tap.tap(proxyFrame.hooks.fetch.request, ({ request }, { init, url }) => {
    if (
      request.method.toUpperCase() === "POST"
      && /(^|\.)googlevideo\.com$/i.test(url.hostname)
      && init.body == null
    ) {
      init.body = new Uint8Array(0);
    }
  });
  proxyFrame.go(targetUrl);
}

async function startPortal() {
  if (!frame || !status) throw new Error("Proxy page elements are missing");
  const engine = resolveProxyEngine(localStorage.getItem("proxyEngine"));
  const targetUrl = await getTargetUrl(engine);

  if (!targetUrl) {
    window.location.replace("/");
    return;
  }

  const target = new URL(targetUrl);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS websites can be opened in the proxy");
  }

  if (engine === "scramjet") {
    await startScramjet(target.href);
  } else {
    await startUltraviolet(target.href);
  }
}

startPortal().catch((error) => {
  console.error("Unable to start the selected proxy engine:", error);
  showError(error);
});
