import { resolveAddressInput } from "./search.js";
import { getScramjetController } from "./scramjet-runtime.js?v=shared-runtime-1";

const themes = new Set(["midnight", "obsidian", "slate", "light"]);
const accents = new Set(["violet", "ice", "silver"]);
const sites = [
  { name: "Discord", url: "https://discord.com/login" },
  { name: "Wikipedia", url: "https://www.wikipedia.org/" },
];

export function normalizeWorkspaceSettings(storage) {
  let mode = "casual";
  let theme = "midnight";
  let accent = "violet";
  try {
    mode = storage.getItem("interfaceMode") === "tabbed" ? "tabbed" : "casual";
    const savedTheme = storage.getItem("tabbedTheme");
    const savedAccent = storage.getItem("tabbedAccent");
    if (themes.has(savedTheme)) theme = savedTheme;
    if (accents.has(savedAccent)) accent = savedAccent;
  } catch {
    return { mode: "casual", theme, accent };
  }
  return { mode, theme, accent };
}

export function resolveWorkspaceAddress(value, searchEngine = "duckduckgo", baseUrl = location.href) {
  const target = resolveAddressInput(value, searchEngine);
  if (!target) return null;
  const url = new URL(target, baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS addresses can be opened.");
  }
  return url.href;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "New tab";
  }
}

function getRemoteUrl(frame, controller) {
  try {
    const current = new URL(frame.element.contentWindow.location.href);
    const path = current.pathname;
    if (!path.startsWith(frame.prefix)) return "";
    const encoded = path.slice(frame.prefix.length);
    return controller.config.codec.decode(encoded);
  } catch {
    return "";
  }
}

function developmentHost() {
  return location.hostname === "localhost"
    || location.hostname === "127.0.0.1"
    || location.hostname.endsWith(".app.github.dev")
    || location.hostname.endsWith(".github.dev")
    || location.hostname.endsWith(".githubpreview.dev")
    || location.hostname.endsWith(".replit.dev")
    || location.hostname.endsWith(".repl.co");
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null };
  }
}

export function mountTabbedBrowser() {
  const workspace = document.getElementById("tabbed-workspace");
  if (!workspace) return;

  const tabsElement = document.getElementById("tabbed-tabs");
  const pagesElement = document.getElementById("tabbed-pages");
  const address = document.getElementById("tabbed-address");
  const addressForm = document.getElementById("tabbed-address-form");
  const newTabButton = document.getElementById("tabbed-new-tab");
  const actionButtons = [...workspace.querySelectorAll("[data-tab-action]")];
  if (!tabsElement || !pagesElement || !address || !addressForm || !newTabButton) return;

  const storage = getLocalStorage();
  const settings = normalizeWorkspaceSettings(storage);
  document.documentElement.dataset.interfaceMode = settings.mode;
  document.documentElement.dataset.tabbedTheme = settings.theme;
  document.documentElement.dataset.tabbedAccent = settings.accent;
  workspace.hidden = settings.mode !== "tabbed";
  if (workspace.hidden) return;

  let controllerPromise;
  let activeId = "";
  let tabNumber = 0;
  const tabs = [];

  const persistTheme = () => {
    const current = normalizeWorkspaceSettings(storage);
    workspace.dataset.theme = current.theme;
    workspace.dataset.accent = current.accent;
  };
  persistTheme();

  function renderTabs() {
    tabsElement.replaceChildren();
    for (const tab of tabs) {
      const tabButton = element("button", `tabbed-tab${tab.id === activeId ? " is-active" : ""}`);
      tabButton.type = "button";
      tabButton.id = `tab-button-${tab.id}`;
      tabButton.role = "tab";
      tabButton.setAttribute("aria-selected", String(tab.id === activeId));
      tabButton.setAttribute("aria-controls", `tab-page-${tab.id}`);
      tabButton.setAttribute("aria-label", `${tab.title}${tab.loading ? ", loading" : ""}`);
      const title = element("span", "tabbed-tab-title", tab.title);
      const close = element("span", "tabbed-tab-close", "×");
      close.setAttribute("aria-hidden", "true");
      tabButton.append(title, close);
      tabButton.addEventListener("click", (event) => {
        if (event.target === close) closeTab(tab.id);
        else selectTab(tab.id);
      });
      tabButton.addEventListener("keydown", (event) => {
        if (event.key === "Delete" || (event.key === "w" && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          closeTab(tab.id);
        }
      });
      tabsElement.append(tabButton);
    }
    newTabButton.disabled = tabs.length >= 12;
  }

  function updateControls() {
    const tab = tabs.find((entry) => entry.id === activeId);
    address.value = tab?.url ?? "";
    address.placeholder = "Search or enter a web address";
    const back = workspace.querySelector('[data-tab-action="back"]');
    const forward = workspace.querySelector('[data-tab-action="forward"]');
    const reload = workspace.querySelector('[data-tab-action="reload"]');
    if (back) back.disabled = !tab || tab.historyIndex <= 0;
    if (forward) forward.disabled = !tab || tab.historyIndex >= tab.history.length - 1;
    if (reload) reload.disabled = !tab?.frame;
    for (const entry of tabs) {
      const page = entry.page;
      const selected = entry.id === activeId;
      page.hidden = !selected;
      page.setAttribute("aria-labelledby", `tab-button-${entry.id}`);
      if (entry.frameElement) entry.frameElement.loading = selected ? "eager" : "lazy";
    }
    renderTabs();
  }

  function updateTabTitle(tab, title) {
    tab.title = title || (tab.url ? hostLabel(tab.url) : "New tab");
    const selectedTitle = tabsElement.querySelector(`#tab-button-${tab.id} .tabbed-tab-title`);
    if (selectedTitle) selectedTitle.textContent = tab.title;
    const tabButton = tabsElement.querySelector(`#tab-button-${tab.id}`);
    tabButton?.setAttribute("aria-label", `${tab.title}${tab.loading ? ", loading" : ""}`);
    if (tab.id === activeId) document.title = `${tab.title} | wld al3m`;
  }

  function makeTab() {
    if (tabs.length >= 12) return;
    tabNumber += 1;
    const id = `tab-${tabNumber}`;
    const page = element("section", "tabbed-page");
    page.id = `tab-page-${id}`;
    page.role = "tabpanel";
    page.tabIndex = 0;

    const start = element("div", "tabbed-start");
    start.append(
      element("div", "tabbed-mark", "XC"),
      element("h1", "", "A clearer place to browse"),
      element("p", "", "Search the web or open one of your usual destinations."),
    );
    const quickLinks = element("div", "tabbed-quick-links");
    for (const site of sites) {
      const button = element("button", "tabbed-quick-link", site.name);
      button.type = "button";
      button.addEventListener("click", () => navigate(tab, site.url));
      quickLinks.append(button);
    }
    start.append(quickLinks);
    const message = element("p", "tabbed-page-message");
    message.setAttribute("role", "status");
    const frameHost = element("div", "tabbed-frame-host");
    page.append(start, message, frameHost);
    pagesElement.append(page);
    const tab = {
      id,
      title: "New tab",
      url: "",
      history: [],
      historyIndex: -1,
      page,
      start,
      message,
      frameHost,
      frame: null,
      frameElement: null,
      loading: false,
      navigationId: 0,
    };
    tabs.push(tab);
    selectTab(id);
    return tab;
  }

  function selectTab(id) {
    if (!tabs.some((tab) => tab.id === id)) return;
    activeId = id;
    updateControls();
  }

  function closeTab(id) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [tab] = tabs.splice(index, 1);
    if (tab.timeout) clearTimeout(tab.timeout);
    tab.frameElement?.remove();
    if (tab.frame && window.__snorlaxScramjetController) {
      const frames = window.__snorlaxScramjetController.frames;
      const frameIndex = frames.indexOf(tab.frame);
      if (frameIndex >= 0) frames.splice(frameIndex, 1);
    }
    tab.page.remove();
    if (!tabs.length) {
      makeTab();
      return;
    }
    if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)].id;
    updateControls();
  }

  function recordUrl(tab, url, mode = "push") {
    if (!url || tab.url === url) return;
    if (mode === "replace" && tab.historyIndex >= 0) {
      tab.history[tab.historyIndex] = url;
    } else if (mode === "pop") {
      const existingIndex = tab.history.lastIndexOf(url);
      if (existingIndex >= 0) tab.historyIndex = existingIndex;
      else {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
      }
    } else {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      if (tab.history.at(-1) !== url) tab.history.push(url);
      tab.historyIndex = tab.history.length - 1;
    }
    tab.url = url;
    updateTabTitle(tab, hostLabel(url));
    if (tab.id === activeId) address.value = url;
    updateControls();
  }

  async function ensureFrame(tab) {
    if (tab.frame) return tab.frame;
    if (!controllerPromise) controllerPromise = getScramjetController();
    const controller = await controllerPromise;
    const iframe = document.createElement("iframe");
    iframe.className = "tabbed-frame";
    iframe.title = `${tab.title} proxied page`;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "fullscreen; encrypted-media; picture-in-picture";
    iframe.loading = "eager";
    tab.frameElement = iframe;
    tab.frame = controller.createFrame(iframe);
    tab.frameHost.append(iframe);
    if (window.$scramjet?.Tap) {
      window.$scramjet.Tap.tap(tab.frame.hooks.init.post, ({ window: frameWindow }) => {
        const syncUrl = (mode = "push") => {
          const remoteUrl = getRemoteUrl(tab.frame, controller);
          if (remoteUrl && /^https?:\/\//i.test(remoteUrl)) recordUrl(tab, remoteUrl, mode);
        };
        frameWindow.addEventListener("popstate", () => syncUrl("pop"));
        frameWindow.addEventListener("hashchange", () => syncUrl("push"));
        for (const method of ["pushState", "replaceState"]) {
          const original = frameWindow.history[method];
          frameWindow.history[method] = function (...args) {
            const result = Reflect.apply(original, this, args);
            queueMicrotask(() => syncUrl(method === "replaceState" ? "replace" : "push"));
            return result;
          };
        }
      });
      window.$scramjet.Tap.tap(
        tab.frame.hooks.error.request,
        ({ rawrequest, error }) => {
          if (!developmentHost()) return;
          let remoteUrl = { hostname: "unknown", pathname: "/" };
          try {
            const parsedUrl = new URL(rawrequest.rawUrl);
            remoteUrl = { hostname: parsedUrl.hostname, pathname: parsedUrl.pathname };
          } catch {
            // Keep diagnostics useful without exposing malformed request data.
          }
          console.warn("[proxy:dev] upstream transport error", {
            method: rawrequest.method,
            host: remoteUrl.hostname,
            path: remoteUrl.pathname,
            error: error instanceof Error ? error.name : "UnknownError",
          });
        },
      );
    }
    iframe.addEventListener("load", () => {
      if (tab.timeout) clearTimeout(tab.timeout);
      tab.loading = false;
      tab.message.textContent = "";
      tab.message.dataset.state = "";
      tab.start.hidden = Boolean(tab.url);
      let title = "";
      try {
        title = iframe.contentDocument?.title ?? "";
      } catch {
        title = "";
      }
      updateTabTitle(tab, title || (tab.url ? hostLabel(tab.url) : "New tab"));
      const remoteUrl = getRemoteUrl(tab.frame, controller);
      if (remoteUrl && /^https?:\/\//i.test(remoteUrl)) recordUrl(tab, remoteUrl);
      updateControls();
    });
    return tab.frame;
  }

  async function navigate(tab, input) {
    let target;
    try {
      target = resolveWorkspaceAddress(input, storage.getItem("searchEngine") || "duckduckgo");
    } catch (error) {
      tab.message.textContent = error instanceof Error ? error.message : "That address could not be opened.";
      tab.message.dataset.state = "error";
      return;
    }
    if (!target) return;

    tab.navigationId += 1;
    const navigationId = tab.navigationId;
    tab.loading = true;
    tab.message.dataset.state = "loading";
    tab.message.textContent = "Connecting through Scramjet…";
    tab.start.hidden = true;
    tab.url = target;
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    if (tab.history.at(-1) !== target) tab.history.push(target);
    tab.historyIndex = tab.history.length - 1;
    updateTabTitle(tab, hostLabel(target));
    updateControls();

    try {
      const frame = await ensureFrame(tab);
      if (navigationId !== tab.navigationId) return;
      frame.go(target);
      if (tab.timeout) clearTimeout(tab.timeout);
      tab.timeout = window.setTimeout(() => {
        if (tab.navigationId !== navigationId || !tab.loading) return;
        tab.loading = false;
        tab.message.dataset.state = "error";
        tab.message.textContent = "The page has not finished loading. The site or proxy may be unavailable; you can retry or enter another address.";
        updateControls();
      }, 30_000);
    } catch (error) {
      if (navigationId !== tab.navigationId) return;
      tab.loading = false;
      tab.message.dataset.state = "error";
      tab.message.textContent = `Could not start the proxied page: ${error instanceof Error ? error.message : String(error)}`;
      tab.start.hidden = true;
      updateControls();
    }
  }

  function goHistory(delta) {
    const tab = tabs.find((entry) => entry.id === activeId);
    if (!tab) return;
    const nextIndex = tab.historyIndex + delta;
    if (nextIndex < 0 || nextIndex >= tab.history.length) return;
    tab.historyIndex = nextIndex;
    tab.url = tab.history[nextIndex];
    tab.navigationId += 1;
    if (tab.frame) {
      tab.loading = true;
      tab.message.dataset.state = "loading";
      tab.message.textContent = "Loading page…";
      tab.frame.go(tab.url);
    } else {
      navigate(tab, tab.url);
    }
    updateControls();
  }

  addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const tab = tabs.find((entry) => entry.id === activeId);
    if (tab) navigate(tab, address.value);
  });
  address.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      address.select();
    }
  });
  newTabButton.addEventListener("click", makeTab);
  for (const button of actionButtons) {
    button.addEventListener("click", () => {
      const tab = tabs.find((entry) => entry.id === activeId);
      if (!tab) return;
      switch (button.dataset.tabAction) {
        case "back":
          goHistory(-1);
          break;
        case "forward":
          goHistory(1);
          break;
        case "reload":
          if (tab.frame) {
            tab.loading = true;
            tab.message.textContent = "Reloading…";
            tab.frame.reload();
            updateControls();
          }
          break;
        case "home":
          tab.navigationId += 1;
          if (tab.timeout) clearTimeout(tab.timeout);
          if (tab.frame) {
            const controller = window.__snorlaxScramjetController;
            const frameIndex = controller?.frames.indexOf(tab.frame) ?? -1;
            if (frameIndex >= 0) controller.frames.splice(frameIndex, 1);
            tab.frameElement.remove();
          }
          tab.frame = null;
          tab.frameElement = null;
          tab.frameHost.replaceChildren();
          tab.url = "";
          tab.history = [];
          tab.historyIndex = -1;
          tab.loading = false;
          tab.message.textContent = "";
          tab.start.hidden = false;
          updateTabTitle(tab, "New tab");
          updateControls();
          break;
      }
    });
  }
  window.addEventListener("storage", (event) => {
    if (["tabbedTheme", "tabbedAccent"].includes(event.key)) persistTheme();
  });
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t") {
      event.preventDefault();
      makeTab();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
      event.preventDefault();
      closeTab(activeId);
    }
  });

  makeTab();
}

if (typeof document !== "undefined") mountTabbedBrowser();
