import { resolveAddressInput } from "./search.js";
import { getScramjetController } from "./scramjet-runtime.js?v=shared-runtime-1";

const themes = new Set(["midnight", "obsidian", "slate", "light"]);
const accents = new Set(["violet", "ice", "silver"]);
const internalRoutes = new Map([
  ["home", "fdetk://home"],
  ["settings", "fdetk://settings"],
  ["about", "fdetk://about"],
  ["games", "fdetk://games"],
  ["apps", "fdetk://apps"],
]);
const firstPartyRoutes = new Map([
  ["/", "home"],
  ["/index.html", "home"],
  ["/settings", "settings"],
  ["/Settings.html", "settings"],
  ["/about", "about"],
  ["/About.html", "about"],
  ["/math", "games"],
  ["/Games.html", "games"],
  ["/english", "apps"],
  ["/Apps.html", "apps"],
]);
const routeSources = {
  games: "/Games.html",
  apps: "/Apps.html",
};
const shortcutPages = [
  { route: "home", name: "Home", mark: "⌂" },
  { route: "games", name: "Games", mark: "▦" },
  { route: "apps", name: "Apps", mark: "◫" },
  { route: "settings", name: "Settings", mark: "⚙" },
  { route: "about", name: "About", mark: "i" },
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

export function resolveWorkspaceNavigation(value, searchEngine = "duckduckgo", baseUrl = location.href) {
  const input = String(value ?? "").trim();
  const internalAddress = input.match(/^fdetk:\/\/([^/?#]+)\/?$/i);
  if (input.toLowerCase().startsWith("fdetk://")) {
    const route = internalAddress?.[1]?.toLowerCase();
    return {
      type: "internal",
      route: internalRoutes.has(route) ? route : "not-found",
      address: route && internalRoutes.has(route) ? internalRoutes.get(route) : `fdetk://${route || "not-found"}`,
    };
  }

  try {
    const url = new URL(input, baseUrl);
    if (url.origin === new URL(baseUrl).origin && firstPartyRoutes.has(url.pathname)) {
      const route = firstPartyRoutes.get(url.pathname);
      return { type: "internal", route, address: internalRoutes.get(route) };
    }
  } catch {
    // Address parsing below provides the user-facing invalid URL error.
  }

  return {
    type: "web",
    address: resolveWorkspaceAddress(input, searchEngine, baseUrl),
  };
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
    return {
      getItem: () => null,
      setItem() {
        throw new Error("Browser storage is unavailable.");
      },
    };
  }
}

function createWorkspaceLink(tab, navigate, route, title, description = "") {
  const button = element("button", "tabbed-shortcut");
  button.type = "button";
  const mark = element("span", "tabbed-shortcut-mark", shortcutPages.find((item) => item.route === route)?.mark || "↗");
  const copy = element("span", "tabbed-shortcut-copy");
  copy.append(element("strong", "", title));
  if (description) copy.append(element("small", "", description));
  button.append(mark, copy);
  button.addEventListener("click", () => navigate(tab, internalRoutes.get(route)));
  return button;
}

function applyInternalFrameTheme(frame, workspace) {
  const internalDocument = frame.contentDocument;
  if (!internalDocument) return;
  internalDocument.documentElement.dataset.tabbedEmbed = "";
  internalDocument.documentElement.dataset.tabbedTheme = workspace.dataset.theme || "midnight";
  internalDocument.documentElement.dataset.tabbedAccent = workspace.dataset.accent || "violet";
  if (!internalDocument.getElementById("tabbed-internal-style")) {
    const stylesheet = internalDocument.createElement("link");
    stylesheet.id = "tabbed-internal-style";
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/assets/css/tabbed-internal.css?v=4";
    internalDocument.head.append(stylesheet);
  }
  frame.contentWindow.openLink = (url) => navigateInternalFrameLink(frame, url);
}

function navigateInternalFrameLink(frame, url) {
  const tab = frame.__workspaceTab;
  if (tab) tab.navigate(url);
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
    for (const tab of tabs) {
      for (const frame of tab.internalFrames.values()) applyInternalFrameTheme(frame, workspace);
    }
  };

  function renderPageHeading(title, description) {
    const heading = element("header", "tabbed-internal-heading");
    heading.append(element("h1", "", title), element("p", "", description));
    return heading;
  }

  function renderHome(tab) {
    const home = element("div", "tabbed-home");
    const searchForm = element("form", "tabbed-home-search");
    searchForm.setAttribute("role", "search");
    const search = element("input", "");
    search.type = "search";
    search.placeholder = "Search the web or enter an address";
    search.setAttribute("aria-label", "Search or enter a web address");
    search.autocomplete = "off";
    const submit = element("button", "", "Search");
    submit.type = "submit";
    searchForm.append(search, submit);
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      navigate(tab, search.value);
    });
    home.append(
      element("div", "tabbed-home-mark", "XC"),
      element("p", "tabbed-home-eyebrow", "INSTA XC4RS"),
      element("h1", "", "Where to next?"),
      searchForm,
    );
    const grid = element("nav", "tabbed-shortcut-grid");
    grid.setAttribute("aria-label", "Workspace shortcuts");
    for (const page of shortcutPages) {
      grid.append(createWorkspaceLink(tab, navigate, page.route, page.name));
    }
    home.append(grid);
    return home;
  }

  function renderSettings(tab) {
    const settingsPage = element("div", "tabbed-internal-content");
    settingsPage.append(renderPageHeading("Settings", "Personalize this workspace. Changes apply immediately."));

    const modeSection = element("section", "tabbed-settings-section");
    modeSection.append(element("h2", "", "Interface mode"));
    const modeSelect = element("select", "tabbed-settings-select");
    modeSelect.setAttribute("aria-label", "Interface mode");
    for (const [value, label] of [["tabbed", "Tabbed"], ["casual", "Casual"]]) {
      const option = element("option", "", label);
      option.value = value;
      modeSelect.append(option);
    }
    modeSelect.value = normalizeWorkspaceSettings(storage).mode;
    const modeButton = element("button", "tabbed-settings-button", "Apply mode");
    modeButton.type = "button";
    modeButton.addEventListener("click", () => {
      const mode = modeSelect.value === "casual" ? "casual" : "tabbed";
      try {
        storage.setItem("interfaceMode", mode);
      } catch (error) {
        tab.message.dataset.state = "error";
        tab.message.textContent = `Could not save interface mode: ${error instanceof Error ? error.message : String(error)}`;
        return;
      }
      if (mode === "casual") window.location.assign("/");
      else {
        document.documentElement.dataset.interfaceMode = "tabbed";
        tab.message.dataset.state = "success";
        tab.message.textContent = "Tabbed mode is already active.";
      }
    });
    modeSection.append(modeSelect, modeButton);
    settingsPage.append(modeSection);

    const themeSection = element("section", "tabbed-settings-section");
    themeSection.append(element("h2", "", "Tabbed theme"));
    const themeGrid = element("div", "tabbed-settings-options");
    for (const [value, label] of [["midnight", "Midnight"], ["obsidian", "Obsidian"], ["slate", "Slate"], ["light", "Light"]]) {
      const button = element("button", "tabbed-theme-choice", label);
      button.type = "button";
      button.dataset.theme = value;
      button.setAttribute("aria-pressed", String(workspace.dataset.theme === value));
      button.addEventListener("click", () => {
        try {
          storage.setItem("tabbedTheme", value);
        } catch (error) {
          tab.message.dataset.state = "error";
          tab.message.textContent = `Could not save the theme: ${error instanceof Error ? error.message : String(error)}`;
          return;
        }
        persistTheme();
        for (const choice of themeGrid.querySelectorAll("[data-theme]")) {
          choice.setAttribute("aria-pressed", String(choice.dataset.theme === value));
        }
      });
      themeGrid.append(button);
    }
    themeSection.append(themeGrid);

    const accentHeading = element("h3", "", "Accent color");
    const accentGrid = element("div", "tabbed-settings-options");
    for (const [value, label] of [["violet", "Violet"], ["ice", "Icy blue"], ["silver", "Silver"]]) {
      const button = element("button", "tabbed-accent-choice", label);
      button.type = "button";
      button.dataset.accent = value;
      button.setAttribute("aria-pressed", String(workspace.dataset.accent === value));
      button.addEventListener("click", () => {
        try {
          storage.setItem("tabbedAccent", value);
        } catch (error) {
          tab.message.dataset.state = "error";
          tab.message.textContent = `Could not save the accent color: ${error instanceof Error ? error.message : String(error)}`;
          return;
        }
        persistTheme();
        for (const choice of accentGrid.querySelectorAll("[data-accent]")) {
          choice.setAttribute("aria-pressed", String(choice.dataset.accent === value));
        }
      });
      accentGrid.append(button);
    }
    themeSection.append(accentHeading, accentGrid);
    settingsPage.append(themeSection);
    return settingsPage;
  }

  function renderAbout(tab) {
    const about = element("div", "tabbed-internal-content");
    about.append(
      renderPageHeading("About INSTA XC4RS", "A familiar space for browsing, games and apps."),
    );
    const card = element("section", "tabbed-settings-section");
    card.append(
      element("h2", "", "Browse with clarity"),
      element("p", "", "Tabbed mode keeps your pages together in one compact workspace while continuing to use the project’s Scramjet and Wisp proxy setup."),
      element("p", "", "Tabs share this site’s proxy session, cookies, storage and service worker. They are not separate browser profiles."),
    );
    about.append(card);
    const links = element("nav", "tabbed-shortcut-grid");
    links.setAttribute("aria-label", "About page links");
    for (const page of shortcutPages.filter((item) => ["games", "apps", "settings"].includes(item.route))) {
      links.append(createWorkspaceLink(tab, navigate, page.route, page.name));
    }
    about.append(links);
    return about;
  }

  function renderUnknownInternal(tab, address) {
    const page = element("div", "tabbed-internal-content");
    page.append(
      renderPageHeading("Page not found", "That internal workspace address is not available."),
      element("p", "tabbed-internal-address", address),
    );
    const home = createWorkspaceLink(tab, navigate, "home", "Back to Home");
    page.append(home);
    return page;
  }

  function mountInternalCatalog(tab, route) {
    let frame = tab.internalFrames.get(route);
    if (frame) {
      tab.internalFrameHost.replaceChildren(frame);
      applyInternalFrameTheme(frame, workspace);
      return;
    }
    frame = document.createElement("iframe");
    frame.className = "tabbed-internal-frame";
    frame.title = route === "games" ? "Games catalog" : "Apps catalog";
    frame.loading = "eager";
    frame.referrerPolicy = "same-origin";
    frame.__workspaceTab = { navigate: (url) => navigate(tab, url) };
    frame.addEventListener("load", () => {
      applyInternalFrameTheme(frame, workspace);
      const internalDocument = frame.contentDocument;
      internalDocument?.addEventListener("click", (event) => {
        const link = event.target.closest?.("a[href]");
        if (!link) return;
        const target = new URL(link.href);
        if (target.origin !== location.origin) {
          event.preventDefault();
          navigate(tab, target.href);
        } else if (firstPartyRoutes.has(target.pathname)) {
          event.preventDefault();
          navigate(tab, target.pathname);
        }
      }, true);
    });
    frame.src = routeSources[route];
    tab.internalFrames.set(route, frame);
    tab.internalFrameHost.replaceChildren(frame);
  }

  function renderInternalPage(tab, route, addressValue) {
    tab.internalFrameHost.replaceChildren();
    if (route === "games" || route === "apps") {
      mountInternalCatalog(tab, route);
      return;
    }
    tab.internalHost.replaceChildren();
    if (route === "home") tab.internalHost.append(renderHome(tab));
    else if (route === "settings") tab.internalHost.append(renderSettings(tab));
    else if (route === "about") tab.internalHost.append(renderAbout(tab));
    else tab.internalHost.append(renderUnknownInternal(tab, addressValue));
  }

  persistTheme();

  function renderTabs() {
    tabsElement.replaceChildren();
    for (const tab of tabs) {
      const tabButton = element("button", `tabbed-tab${tab.id === activeId ? " is-active" : ""}${tab.loading ? " is-loading" : ""}`);
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
    if (tab) document.title = `${tab.title} | wld al3m`;
    const back = workspace.querySelector('[data-tab-action="back"]');
    const forward = workspace.querySelector('[data-tab-action="forward"]');
    const reload = workspace.querySelector('[data-tab-action="reload"]');
    if (back) back.disabled = !tab || tab.historyIndex <= 0;
    if (forward) forward.disabled = !tab || tab.historyIndex >= tab.history.length - 1;
    if (reload) reload.disabled = !tab || (!tab.frame && !tab.internalRoute);
    for (const entry of tabs) {
      const page = entry.page;
      const selected = entry.id === activeId;
      page.hidden = !selected;
      page.setAttribute("aria-labelledby", `tab-button-${entry.id}`);
      if (entry.frameElement) entry.frameElement.loading = selected ? "eager" : "lazy";
      const isInternal = Boolean(entry.internalRoute);
      entry.internalHost.hidden = !isInternal || entry.internalRoute === "games" || entry.internalRoute === "apps";
      entry.internalFrameHost.hidden = !isInternal || (entry.internalRoute !== "games" && entry.internalRoute !== "apps");
      entry.frameHost.hidden = isInternal;
      entry.start.hidden = Boolean(entry.url);
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
    const message = element("p", "tabbed-page-message");
    message.setAttribute("role", "status");
    const frameHost = element("div", "tabbed-frame-host");
    const internalHost = element("div", "tabbed-internal-host");
    const internalFrameHost = element("div", "tabbed-internal-frame-host");
    page.append(start, internalHost, internalFrameHost, message, frameHost);
    pagesElement.append(page);
    const tab = {
      id,
      title: "New tab",
      url: "",
      history: [],
      historyIndex: -1,
      page,
      start,
      internalHost,
      internalFrameHost,
      internalFrames: new Map(),
      internalRoute: "home",
      navigate: (url) => navigate(tab, url),
      message,
      frameHost,
      frame: null,
      frameElement: null,
      loading: false,
      navigationId: 0,
    };
    tabs.push(tab);
    selectTab(id);
    navigate(tab, "fdetk://home", { historyMode: "replace" });
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

  function updateHistory(tab, addressValue, historyMode) {
    if (historyMode === "none") return;
    if (historyMode === "replace" && tab.historyIndex >= 0) {
      tab.history[tab.historyIndex] = addressValue;
    } else {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      if (tab.history.at(-1) !== addressValue) tab.history.push(addressValue);
      tab.historyIndex = tab.history.length - 1;
    }
  }

  async function navigate(tab, input, { historyMode = "push" } = {}) {
    let resolved;
    try {
      resolved = resolveWorkspaceNavigation(input, storage.getItem("searchEngine") || "duckduckgo");
    } catch (error) {
      tab.message.textContent = error instanceof Error ? error.message : "That address could not be opened.";
      tab.message.dataset.state = "error";
      return;
    }
    if (!resolved.address) return;

    tab.navigationId += 1;
    const navigationId = tab.navigationId;
    if (tab.timeout) clearTimeout(tab.timeout);
    if (resolved.type === "internal") {
      tab.internalRoute = resolved.route;
      tab.url = resolved.address;
      tab.loading = false;
      tab.message.textContent = "";
      tab.message.dataset.state = "";
      updateHistory(tab, resolved.address, historyMode);
      const title = ({
        home: "Home",
        settings: "Settings",
        about: "About",
        games: "Games",
        apps: "Apps",
        "not-found": "Page not found",
      })[resolved.route] || "Page not found";
      updateTabTitle(tab, title);
      renderInternalPage(tab, resolved.route, resolved.address);
      updateControls();
      return;
    }

    const target = resolved.address;
    tab.internalRoute = "";
    tab.loading = true;
    tab.message.dataset.state = "loading";
    tab.message.textContent = "Connecting through Scramjet…";
    tab.url = target;
    updateHistory(tab, target, historyMode);
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
      tab.internalRoute = "";
      updateControls();
    }
  }

  function goHistory(delta) {
    const tab = tabs.find((entry) => entry.id === activeId);
    if (!tab) return;
    const nextIndex = tab.historyIndex + delta;
    if (nextIndex < 0 || nextIndex >= tab.history.length) return;
    tab.historyIndex = nextIndex;
    navigate(tab, tab.history[nextIndex], { historyMode: "none" });
  }

  addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const tab = tabs.find((entry) => entry.id === activeId);
    if (tab) navigate(tab, address.value);
  });
  workspace.addEventListener("click", (event) => {
    const link = event.target.closest?.('a[href^="fdetk://"]');
    if (!link) return;
    event.preventDefault();
    const tab = tabs.find((entry) => entry.id === activeId);
    if (tab) navigate(tab, link.href);
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
          } else if (tab.internalRoute) {
            navigate(tab, tab.url, { historyMode: "none" });
          }
          break;
        case "home":
          navigate(tab, "fdetk://home");
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
