const searchUrls = {
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  brave: "https://search.brave.com/search?q=",
};

export function buildSearchUrl(engine, query) {
  const baseUrl = Object.hasOwn(searchUrls, engine) ? searchUrls[engine] : searchUrls.duckduckgo;
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) throw new Error("Enter a search query");
  return baseUrl + encodeURIComponent(normalizedQuery);
}

export function resolveAddressInput(value, engine) {
  const input = String(value ?? "").trim();
  if (!input) return null;

  const explicitScheme = input.match(/^([a-z][a-z\d+.-]*):/i);
  if (/^https?:\/\//i.test(input)) {
    return normalizeHttpUrl(input);
  }

  if (explicitScheme && !looksLikeWebAddress(input)) {
    throw new Error("Only HTTP and HTTPS websites can be opened");
  }

  if (looksLikeWebAddress(input)) {
    return normalizeHttpUrl(`https://${input}`);
  }

  if (explicitScheme) {
    throw new Error("Only HTTP and HTTPS websites can be opened");
  }

  return buildSearchUrl(engine, input);
}

export function isDuckDuckGoSearchUrl(value) {
  try {
    const target = new URL(value);
    return target.hostname === "duckduckgo.com"
      && target.pathname === "/"
      && target.searchParams.has("q");
  } catch {
    return false;
  }
}

function normalizeHttpUrl(value) {
  const target = new URL(value);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS websites can be opened");
  }
  if (target.username || target.password) {
    throw new Error("URLs containing credentials cannot be opened");
  }
  return target.href;
}

function looksLikeWebAddress(value) {
  if (/\s/.test(value)) return false;

  try {
    const target = new URL(`https://${value}`);
    if (target.username || target.password) return false;

    const hostname = target.hostname.toLowerCase();
    if (hostname === "localhost") {
      return true;
    }

    if (/^\d+(?:\.\d+){3}$/.test(hostname)) {
      return hostname.split(".").every((octet) => Number(octet) <= 255);
    }

    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      return hostname.includes(":");
    }

    const labels = hostname.split(".");
    if (
      labels.length < 2
      || labels.some((label) => !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))
    ) {
      return false;
    }

    const topLevelDomain = labels.at(-1);
    return /^[a-z]{2,}$/i.test(topLevelDomain)
      || /^xn--[a-z\d-]+$/i.test(topLevelDomain);
  } catch {
    return false;
  }
}
