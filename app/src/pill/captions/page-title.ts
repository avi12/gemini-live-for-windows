// A web page's own title, read from the page itself, for links Gemini mentions as a bare URL. The
// rules are metascraper's (metascraper-title): the title a page gives for sharing first (Open
// Graph's `og:title`, then Twitter's card), then a structured-data headline (JSON-LD), then the
// document's `<title>`. Only the head is needed, so at most the first part of the page is read.

const FETCH_TIMEOUT_MILLISECONDS = 6000;
const MAX_BYTES = 512 * 1024;
const MAX_TITLE_LENGTH = 300;
const HTML_TYPES = ["text/html", "application/xhtml+xml"];
const DEFAULT_CHARSET = "utf-8";
// Sites serve their full head (with its titles) to a browser, and some refuse unknown clients
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const JSON_LD = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
const CHARSET_IN_TYPE = /charset\s*=\s*["']?([\w-]+)/i;
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i;
// HTML requires a <meta charset> within the first 1024 bytes; twice that allows for sloppy pages
const CHARSET_SCAN_BYTES = 2048;
const WHITESPACE = /\s+/g;
const ENTITY = /&(#x[\da-f]+|#\d+|[a-z]+);/gi;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

// The named entities titles use; any other is left as written
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  // The long dash, by code point: the house style keeps the character itself out of source
  mdash: String.fromCodePoint(0x2014),
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  bull: "•",
  laquo: "«",
  raquo: "»"
};

// The meta tags that carry a title, by the attribute naming them, best first
const META_TITLE_KEYS = ["og:title", "twitter:title"] as const;

function decodeEntities(text: string) {
  return text.replace(ENTITY, (whole, body: string) => {
    const isHex = body.startsWith("#x") || body.startsWith("#X");
    if (isHex) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), HEX_RADIX));
    }

    const isDecimal = body.startsWith("#");
    if (isDecimal) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), DECIMAL_RADIX));
    }

    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// One line, entities decoded, of a sensible length; nothing when that leaves no text
function cleanTitle(raw: string | undefined) {
  if (raw === undefined) {
    return undefined;
  }

  const text = decodeEntities(raw).replace(WHITESPACE, " ").trim();
  const isEmpty = text === "";
  if (isEmpty) {
    return undefined;
  }

  return text.slice(0, MAX_TITLE_LENGTH);
}

function attributesOf(tag: string) {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const [, name = "", doubleQuoted, singleQuoted, bare] = match;
    attributes.set(name.toLowerCase(), doubleQuoted ?? singleQuoted ?? bare ?? "");
  }

  return attributes;
}

function metaTitles(html: string) {
  const found = new Map<string, string>();
  for (const [tag] of html.matchAll(META_TAG)) {
    const attributes = attributesOf(tag);
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
    const content = attributes.get("content");
    const isTitleKey = META_TITLE_KEYS.some(titleKey => titleKey === key);
    const isFirstOfItsKind = isTitleKey && content !== undefined && !found.has(key);
    if (isFirstOfItsKind) {
      found.set(key, content);
    }
  }

  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Structured data's headline (an article's) anywhere in it, @graph lists included; failing that,
// the first name it gives
function headlineOf(root: unknown) {
  const pending: unknown[] = [root];
  let firstName: string | undefined;
  while (pending.length > 0) {
    const data = pending.shift();
    if (Array.isArray(data)) {
      pending.push(...data);
      continue;
    }

    if (!isRecord(data)) {
      continue;
    }

    const { headline, name } = data;
    const hasHeadline = typeof headline === "string";
    if (hasHeadline) {
      return headline;
    }

    pending.push(data["@graph"]);
    const isFirstName = firstName === undefined && typeof name === "string";
    if (isFirstName) {
      firstName = name;
    }
  }

  return firstName;
}

function jsonLdHeadline(html: string) {
  for (const [, body = ""] of html.matchAll(JSON_LD)) {
    try {
      const headline = headlineOf(JSON.parse(body));
      if (headline !== undefined) {
        return headline;
      }
    } catch {
      // A page's broken structured data is skipped, not fatal
    }
  }

  return undefined;
}

/** The page's title by metascraper's rules, or undefined when the HTML names none. */
export function titleFromHtml(html: string) {
  const metas = metaTitles(html);
  const candidates = [...META_TITLE_KEYS.map(key => metas.get(key)), jsonLdHeadline(html), TITLE_TAG.exec(html)?.[1]];
  return candidates.map(cleanTitle).find(title => title !== undefined);
}

function charsetOf({ contentType, head }: { contentType: string; head: Uint8Array }) {
  const fromHeader = CHARSET_IN_TYPE.exec(contentType)?.[1];
  if (fromHeader !== undefined) {
    return fromHeader;
  }

  // The page's own <meta charset>, read as ASCII from the start of the page
  const start = new TextDecoder("latin1").decode(head.subarray(0, CHARSET_SCAN_BYTES));
  return META_CHARSET.exec(start)?.[1] ?? DEFAULT_CHARSET;
}

function decode({ bytes, charset }: { bytes: Uint8Array; charset: string }) {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder(DEFAULT_CHARSET).decode(bytes);
  }
}

// Reads at most MAX_BYTES of the body: a title sits in the head, and a page can be huge
async function readStart(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    total += value.byteLength;
  }

  await reader.cancel();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

/**
 * Fetches `url` and reads its title; undefined when the page cannot be reached in time, is not a
 * web page, or names no title. Never throws.
 */
export async function fetchPageTitle({ url, fetchPage = fetch }: { url: string; fetchPage?: typeof fetch }) {
  try {
    const response = await fetchPage(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MILLISECONDS),
      headers: {
        "user-agent": BROWSER_USER_AGENT,
        accept: "text/html,application/xhtml+xml"
      }
    });
    const contentType = response.headers.get("content-type") ?? "";
    const isPage = HTML_TYPES.some(type => contentType.includes(type));
    if (!response.ok || !isPage) {
      await response.body?.cancel();
      return undefined;
    }

    const bytes = await readStart(response);
    const html = decode({
      bytes,
      charset: charsetOf({
        contentType,
        head: bytes
      })
    });
    return titleFromHtml(html);
  } catch {
    return undefined;
  }
}
