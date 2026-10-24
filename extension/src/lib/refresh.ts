// Refreshes this browser's Google session when the app reports that its copy stopped working.
//
// The browser is the only owner of the session; Google's own pages keep it fresh as they run (they
// rotate the short-lived auth cookies). If no Google page has run for hours, the cookies the app
// holds go stale and Gemini there says it's unavailable or signed out. Loading Gemini briefly, in a
// minimized window that never takes focus, lets Google's page do exactly what it does in a tab;
// the cookie changes then reach the app through the normal push.

const REFRESH_URL = "https://gemini.google.com/app";

// Long enough for the page to load and rotate its cookies.
const REFRESH_PAGE_MS = 15_000;

// The app asks again after every failed start; one refresh per window is plenty.
const REFRESH_COOLDOWN_MS = 2 * 60_000;

let lastRefreshAt = 0;

/** Loads Gemini out of sight so Google refreshes the session, then closes it. */
export async function refreshGoogleSession(): Promise<void> {
  if (Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS) {
    return;
  }

  lastRefreshAt = Date.now();

  const opened = await browser.windows.create({
    url: REFRESH_URL,
    state: "minimized",
    focused: false
  });
  setTimeout(() => {
    if (opened?.id !== undefined) {
      void browser.windows.remove(opened.id).catch(() => undefined); // the user may have closed it
    }
  }, REFRESH_PAGE_MS);
}
