let frame = document.getElementById("siteurl");
const status = document.getElementById("proxy-status");
let proxyNavigationStarted = false;
let activeProxyEngine;

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
  home.textContent = "Return to Snorlax's Cave";

  status.append(title, detail, home);
  status.hidden = false;
}

function isYouTubeHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === "youtube.com"
    || host.endsWith(".youtube.com")
    || host === "youtube-nocookie.com"
    || host.endsWith(".youtube-nocookie.com")
    || host === "youtu.be";
}

function keepYouTubeLinksInProxy(event) {
  const anchor = event.composedPath().find((node) => node?.tagName === "A" && node.href);
  if (!anchor || !window.__scramjetController || !window.__scramjetFrame) return;

  try {
    const proxyFrame = window.__scramjetFrame;
    const pathname = new URL(anchor.href).pathname;
    if (!pathname.startsWith(proxyFrame.prefix)) return;

    const encodedTarget = pathname.slice(proxyFrame.prefix.length);
    const target = new URL(window.__scramjetController.config.codec.decode(encodedTarget));
    if (!isYouTubeHostname(target.hostname)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.__scramjetFrame.go(target.href);
  } catch {
    return;
  }
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
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

  activeProxyEngine = "uv";
  frame.src = window.__uv$config.prefix + window.__uv$config.encodeUrl(targetUrl);
  proxyNavigationStarted = true;
}

async function startScramjet(targetUrl) {
  await loadClassicScript("/scramjet/scramjet.js");
  await loadClassicScript("/controller/controller.api.js");

  const registration = await navigator.serviceWorker.register("/scramjet-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  const serviceWorker = await window.waitForActiveServiceWorker(registration);
  if (!serviceWorker) throw new Error("Scramjet service worker did not activate");

  const wispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
  const { LibcurlClient } = await import("/libcurl/index.mjs");
  const controllerConfig = window.$scramjetController.config;
  const controller = new window.$scramjetController.Controller({
    serviceworker: serviceWorker,
    transport: new LibcurlClient({
      wisp: wispUrl,
      connections: [160, 120, 24],
    }),
    config: {
      ...controllerConfig,
      prefix: "/scramjet-proxy/",
      scramjetPath: "/scramjet/scramjet.js",
      injectPath: "/controller/controller.inject.js",
      wasmPath: "/scramjet/scramjet.wasm",
      virtualWasmPath: "scramjet.wasm.js",
    },
  });
  await controller.wait();

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
  activeProxyEngine = "scramjet";
  proxyFrame.go(targetUrl);
  proxyNavigationStarted = true;
}

async function startTitan(targetUrl) {
  try {
    await startUltraviolet(targetUrl);
  } catch (uvError) {
    console.warn("Titan could not initialize Ultraviolet; trying Scramjet.", uvError);
    try {
      await startScramjet(targetUrl);
    } catch (scramjetError) {
      throw new AggregateError(
        [uvError, scramjetError],
        "Titan could not initialize either proxy engine.",
      );
    }
  }
}

function handleFrameLoad() {
  if (proxyNavigationStarted) status.hidden = true;

  if (activeProxyEngine !== "scramjet") return;

  try {
    const proxyDocument = frame.contentDocument;
    if (!proxyDocument || proxyDocument.__snorlaxYouTubeClickHandler) return;
    proxyDocument.__snorlaxYouTubeClickHandler = true;
    proxyDocument.addEventListener("click", keepYouTubeLinksInProxy, true);
  } catch {
    return;
  }
}

if (frame) frame.addEventListener("load", handleFrameLoad);

async function startPortal() {
  if (!frame || !status) throw new Error("Proxy page elements are missing");
  const engine = localStorage.getItem("proxyEngine") === "scramjet" ? "scramjet" : "uv";
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
  } else if (engine === "titan") {
    await startTitan(target.href);
  } else {
    await startUltraviolet(target.href);
  }
}

startPortal().catch((error) => {
  console.error("Unable to start the selected proxy engine:", error);
  showError(error);
});
