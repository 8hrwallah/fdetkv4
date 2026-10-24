import { isDuckDuckGoSearchUrl, resolveAddressInput } from "./search.js";

const input = document.getElementById("search");
const form = input?.closest("form") || document.getElementById("proxy-search-form");

async function openProxy(event) {
  event?.preventDefault();
  if (!form || !input || form.dataset.proxySubmitting === "true" || !input.value.trim()) return;

  form.dataset.proxySubmitting = "true";

  let url;
  try {
    url = resolveAddressInput(input.value, localStorage.getItem("searchEngine"));
    if (!url) {
      form.dataset.proxySubmitting = "false";
      return;
    }
    const target = new URL(url);
    if (target.hostname === "nvidia.com" || target.hostname.endsWith(".nvidia.com")) {
      window.location.assign(target.href);
      return;
    }

    if (typeof window.openProxyTarget !== "function") {
      throw new Error("Proxy routing did not load");
    }

    await window.openProxyTarget(url);
  } catch (error) {
    if (url && isDuckDuckGoSearchUrl(url)) {
      console.warn("DuckDuckGo proxy navigation failed; opening results directly.", error);
      window.location.assign(url);
      return;
    }
    form.dataset.proxySubmitting = "false";
    console.error("Unable to start the proxy:", error);
  }
}

if (form && input && form.dataset.proxyBound !== "true") {
  form.dataset.proxyBound = "true";
  form.addEventListener("submit", openProxy);
}