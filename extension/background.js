// Gemini Live for Windows - Google session link.
//
// The desktop app runs the real Gemini web client in its own WebView2, signed in with THIS
// browser's Google session. The browser stays the only owner of that session: Google rotates
// its auth cookies here (e.g. __Secure-1PSIDTS), and every rotation is pushed straight to the
// app over a loopback WebSocket. The app never rotates the cookies itself, so the two can't
// invalidate each other.
//
// The app accepts this socket only from this extension's pinned ID (manifest "key").

const LINK_URL = "ws://127.0.0.1:8479/google-session"; // = SessionLink.Port in the app
const RECONNECT_ALARM = "reconnect";
const PUSH_DEBOUNCE_MS = 1500; // a sign-in or rotation changes several cookies at once

let socket = null;
let pushTimer = null;

async function collectCookies() {
  // Everything on google.com and its subdomains; the app picks the auth cookies it needs.
  const cookies = await chrome.cookies.getAll({ domain: "google.com" });
  return cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate ?? null,
  }));
}

async function push() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "cookies", cookies: await collectCookies() }));
}

function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return; // connecting or open
  try {
    socket = new WebSocket(LINK_URL);
  } catch {
    socket = null;
    return;
  }
  socket.onopen = () => void push();
  socket.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    // "query": the app wants the current session now (e.g. Gemini said it's signed out).
    if (message.type === "query") void push();
    // "ping" every ~20 s keeps this service worker alive while the app is running.
    if (message.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
  };
  socket.onclose = () => { socket = null; };
  socket.onerror = () => { /* app not running; the alarm retries */ };
}

chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (!cookie.domain.endsWith("google.com")) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), PUSH_DEBOUNCE_MS);
});

chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === RECONNECT_ALARM) connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
