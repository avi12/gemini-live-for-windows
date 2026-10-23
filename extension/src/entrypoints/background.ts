// Gemini Live for Windows - Google session link.
//
// The desktop app runs the real Gemini web client in its own WebView2, signed in with THIS
// browser's Google session. The browser stays the only owner of that session: Google rotates
// its auth cookies here (e.g. __Secure-1PSIDTS), and every rotation is pushed straight to the
// app over a loopback WebSocket. The app never rotates the cookies itself, so the two can't
// invalidate each other.

import { ensureLinkConnected, isGoogleCookie, pushSessionSoon } from "@/lib/link";

// Wakes the suspendable MV3 worker so a link dropped while it slept (e.g. the app launched
// later) reconnects within 30 seconds, Chrome's floor for a periodic alarm (since Chrome 120).
const LINK_KEEPALIVE_MINUTES = 0.5;

/** Every alarm this worker creates; onAlarm dispatches on the name. */
const AlarmName = {
  /** Periodic keepalive that reconnects a dropped link. */
  LINK: "link"
} as const;

type AlarmName = (typeof AlarmName)[keyof typeof AlarmName];

// WXT discovers entrypoints by their default export, so this one file is exempt from the
// named-exports rule.
export default defineBackground(() => {
  // Every worker start (install, browser launch, dev reload, idle wake) reconnects, and the
  // link pushes the session the moment it opens.
  ensureLinkConnected();
  browser.runtime.onInstalled.addListener(() => ensureLinkConnected());
  browser.runtime.onStartup.addListener(() => ensureLinkConnected());

  void browser.alarms.create(AlarmName.LINK, { periodInMinutes: LINK_KEEPALIVE_MINUTES });
  browser.alarms.onAlarm.addListener(alarm => {
    switch (alarm.name as AlarmName) {
      case AlarmName.LINK:
        ensureLinkConnected();
        return;
      default:
        return;
    }
  });

  browser.cookies.onChanged.addListener(({ cookie }) => {
    if (!isGoogleCookie(cookie)) {
      return;
    }

    pushSessionSoon();
  });
});
