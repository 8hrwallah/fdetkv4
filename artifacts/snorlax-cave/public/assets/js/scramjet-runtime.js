let controllerPromise;

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

export function getScramjetController() {
  if (window.__snorlaxScramjetController) {
    return Promise.resolve(window.__snorlaxScramjetController);
  }
  if (controllerPromise) return controllerPromise;

  controllerPromise = (async () => {
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
      transport: new LibcurlClient({ wisp: wispUrl }),
      config: {
        ...controllerConfig,
        prefix: "/scramjet-proxy/",
        scramjetPath: "/scramjet/scramjet.js",
        injectPath: "/controller/snorlax.inject.js?v=compat-2",
        wasmPath: "/scramjet/scramjet.wasm",
        virtualWasmPath: "scramjet.wasm.js",
      },
    });
    await controller.wait();
    window.__snorlaxScramjetController = controller;
    return controller;
  })().catch((error) => {
    controllerPromise = undefined;
    throw error;
  });

  return controllerPromise;
}
