const CUSTOM_TITLE_STORAGE_KEY = "tabName";

export function resolvePortalTitle(savedTitle) {
  return typeof savedTitle === "string" && savedTitle.trim()
    ? savedTitle.trim()
    : "wld al3m";
}

export function applyPortalTitle() {
  if (location.pathname !== "/" && location.pathname !== "/portal") return;

  try {
    const savedTitle = localStorage.getItem(CUSTOM_TITLE_STORAGE_KEY);
    if (savedTitle?.trim()) document.title = resolvePortalTitle(savedTitle);
  } catch (error) {
    console.warn("Could not read the saved portal title:", error);
  }
}

if (typeof document !== "undefined") applyPortalTitle();
