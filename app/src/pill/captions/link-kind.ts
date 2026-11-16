// What a link in a caption is, for the icon its chip wears: a search results page gets the search
// icon, any other page its own site's icon

interface SearchEngine {
  readonly host: RegExp;
  readonly path: string;
  // The query parameter the search words travel in
  readonly parameter: string;
}

const SEARCH_ENGINES: readonly SearchEngine[] = [
  {
    host: /^(?:[a-z0-9-]+\.)*google\.[a-z.]+$/,
    path: "/search",
    parameter: "q"
  },
  {
    host: /^(?:[a-z0-9-]+\.)*bing\.com$/,
    path: "/search",
    parameter: "q"
  },
  {
    host: /^(?:[a-z0-9-]+\.)*yahoo\.com$/,
    path: "/search",
    parameter: "p"
  },
  {
    host: /^(?:[a-z0-9-]+\.)*duckduckgo\.com$/,
    path: "/",
    parameter: "q"
  },
  {
    host: /^search\.brave\.com$/,
    path: "/search",
    parameter: "q"
  },
  {
    host: /^(?:[a-z0-9-]+\.)*ecosia\.org$/,
    path: "/search",
    parameter: "q"
  },
  {
    host: /^(?:[a-z0-9-]+\.)*yandex\.[a-z]+$/,
    path: "/search",
    parameter: "text"
  },
  {
    host: /^(?:[a-z0-9-]+\.)*baidu\.com$/,
    path: "/s",
    parameter: "wd"
  },
  {
    host: /^(?:[a-z0-9-]+\.)*startpage\.com$/,
    path: "/sp/search",
    parameter: "query"
  }
];

const FAVICON_SERVICE = "https://www.google.com/s2/favicons";
const FAVICON_SIZE = "32";

// A results page of a search engine: its own address with the words searched for in it
export function isSearchPage(uri: string) {
  const address = URL.parse(uri);
  const isUnparsable = address === null;
  if (isUnparsable) {
    return false;
  }

  return SEARCH_ENGINES.some(
    engine =>
      engine.host.test(address.hostname) &&
      address.pathname.startsWith(engine.path) &&
      address.searchParams.has(engine.parameter)
  );
}

// Where the page's site keeps its icon, asked of the service that has them all: a site's own
// /favicon.ico is often missing, and the service gives one size and one format
export function faviconUri(uri: string) {
  const address = new URL(uri);
  const service = new URL(FAVICON_SERVICE);
  service.searchParams.set("domain", address.hostname);
  service.searchParams.set("sz", FAVICON_SIZE);
  return service.href;
}
