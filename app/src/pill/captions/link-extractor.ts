import type { FoundLink } from "@/contracts/live-engine.ts";

export interface ExtractedLink extends FoundLink {
  readonly isSearch: boolean;
}

const MIN_QUOTED_TITLE = 12;
const HEX_RADIX = 16;
const SEARCH_URL = "https://www.google.com/search?q=";
const TRAILING_PUNCTUATION = /[.,);:!?]+$/;
const TRAILING_SLASHES = /\/+$/;
const RESERVED_MARKS = /[!'()*]/g;
const MARKDOWN_LINK = /\[(?<title>[^\]]+)\]\((?<url>https?:\/\/[^)\s]+)\)/g;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const BARE_DOMAIN =
  /\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|dev|app|co|uk|il|edu|gov|news|tv|me|info)(?:\/[^\s<>"']*[^\s<>"'.,;:!?)])?\b/gi;
const QUOTED = /["“”](?<quoted>[^"“”]+)["“”]/g;

// A "host/path" for a URL that parses, the URL itself otherwise: a link's readable address
export function shortTitle(url: string) {
  const parsed = URL.parse(url);
  const isUnparsable = parsed === null;
  if (isUnparsable) {
    return url;
  }

  return parsed.hostname + parsed.pathname.replace(TRAILING_SLASHES, "");
}

// Like .NET's Uri.EscapeDataString, which escapes the marks encodeURIComponent keeps
function escapeDataString(value: string) {
  return encodeURIComponent(value).replace(
    RESERVED_MARKS,
    mark => `%${mark.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`
  );
}

function* candidates(text: string) {
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    yield {
      title: match.groups?.["title"] ?? "",
      uri: match.groups?.["url"] ?? "",
      isSearch: false
    };
  }

  const withoutMarkdown = text.replace(MARKDOWN_LINK, " ");
  for (const [found] of withoutMarkdown.matchAll(URL_PATTERN)) {
    const uri = found.replace(TRAILING_PUNCTUATION, "");
    yield {
      title: shortTitle(uri),
      uri,
      isSearch: false
    };
  }

  const withoutUrls = withoutMarkdown.replace(URL_PATTERN, " ");
  for (const [domain] of withoutUrls.matchAll(BARE_DOMAIN)) {
    yield {
      title: domain,
      uri: `https://${domain}`,
      isSearch: false
    };
  }

  for (const match of text.matchAll(QUOTED)) {
    const title = (match.groups?.["quoted"] ?? "").trim();
    const isLongEnough = title.length >= MIN_QUOTED_TITLE;
    if (!isLongEnough) {
      continue;
    }

    yield {
      title,
      uri: SEARCH_URL + escapeDataString(title),
      isSearch: true
    };
  }
}

// What Gemini is trying to hand over in a spoken answer: markdown links and URLs as they are, bare
// domains as https, quoted titles as a Google search. The first of each address wins, any casing.
export function findLinks(text: string) {
  const seen = new Set<string>();
  const found: ExtractedLink[] = [];
  for (const link of candidates(text)) {
    const key = link.uri.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    found.push(link);
  }

  return found;
}
