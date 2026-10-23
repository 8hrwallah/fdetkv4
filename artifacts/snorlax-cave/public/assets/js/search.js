const searchUrls = {
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  brave: "https://search.brave.com/search?q=",
};

export function buildSearchUrl(engine, query) {
  const baseUrl = searchUrls[engine] || searchUrls.google;
  return baseUrl + encodeURIComponent(query);
}
