// The Google session the app mirrors: which cookies belong to it, and reading all of them.

// Everything on google.com and its subdomains; the app picks the auth cookies it needs.
const GOOGLE_COOKIE_DOMAIN = "google.com";

// Everything the browser would send to these pages. A domain query can miss cookies the browser
// still sends (the non-Secure SID, HSID and APISID in particular), which signs the app out.
const GOOGLE_COOKIE_URLS = [
  "https://gemini.google.com/",
  "https://accounts.google.com/",
  "https://www.google.com/",
  "http://www.google.com/"
];

/** Whether a cookie belongs to the Google session the app mirrors. */
export function isGoogleCookie(cookie: Browser.cookies.Cookie) {
  // google.com itself or a subdomain (".google.com", "accounts.google.com"), never "notgoogle.com"
  const domain = cookie.domain.replace(/^\./, "");
  return domain === GOOGLE_COOKIE_DOMAIN || domain.endsWith(`.${GOOGLE_COOKIE_DOMAIN}`);
}

function cookieKey(cookie: Browser.cookies.Cookie) {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`;
}

/** Every Google session cookie, each once, in the shape the app reads. */
export async function collectCookies() {
  const batches = await Promise.all([
    browser.cookies.getAll({ domain: GOOGLE_COOKIE_DOMAIN }),
    ...GOOGLE_COOKIE_URLS.map(url => browser.cookies.getAll({ url }))
  ]);
  const unique = new Map(batches.flat().map(cookie => [cookieKey(cookie), cookie]));
  return [...unique.values()].map(cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate ?? null
  }));
}
