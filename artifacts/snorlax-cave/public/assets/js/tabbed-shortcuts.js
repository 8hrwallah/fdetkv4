export const SHORTCUT_STORAGE_KEY = "tabbedShortcuts";
export const MAX_SHORTCUTS = 6;
const MAX_NAME_LENGTH = 24;
const MAX_URL_LENGTH = 2048;

const DEFAULT_SHORTCUTS = [
  { name: "DuckDuckGo", url: "https://duckduckgo.com/" },
  { name: "Wikipedia", url: "https://www.wikipedia.org/" },
  { name: "YouTube", url: "https://www.youtube.com/" },
];

// Accepts only http(s) targets. A bare host such as "example.com" gets https://.
export function normalizeShortcutUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > MAX_URL_LENGTH || /\s/.test(text)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+(\/|$)/.test(text);
  const candidate = hasScheme ? text : `https://${text}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return url.href;
}

export function validateShortcut(input) {
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Enter a name." };
  if (name.length > MAX_NAME_LENGTH) return { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  const url = normalizeShortcutUrl(input?.url);
  if (!url) return { error: "Enter a valid http or https address." };
  return { value: { name, url } };
}

function sanitizeList(raw) {
  if (!Array.isArray(raw)) return null;
  const list = [];
  for (const item of raw) {
    const checked = validateShortcut(item);
    if (checked.value) list.push({ id: String(item.id || ""), ...checked.value });
    if (list.length === MAX_SHORTCUTS) break;
  }
  return list;
}

export function createShortcutId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function loadShortcuts(storage) {
  let stored = null;
  try {
    stored = storage.getItem(SHORTCUT_STORAGE_KEY);
  } catch {
    stored = null;
  }
  let list = null;
  if (stored !== null) {
    try {
      list = sanitizeList(JSON.parse(stored));
    } catch {
      list = null;
    }
  }
  // Missing storage seeds editable defaults; a stored empty list stays empty.
  if (list === null) list = DEFAULT_SHORTCUTS.map((item) => ({ ...item }));
  const seen = new Set();
  return list.map((item) => {
    let id = item.id;
    if (!id || seen.has(id)) id = createShortcutId();
    seen.add(id);
    return { ...item, id };
  });
}

export function saveShortcuts(storage, list) {
  storage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SHORTCUTS)));
}

export function shortcutHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function shortcutIconUrl(url) {
  const host = shortcutHost(url);
  return host ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico` : "";
}
