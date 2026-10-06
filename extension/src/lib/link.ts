import { ReconnectController } from '@/lib/reconnect';
import { refreshGoogleSession } from '@/lib/refresh';

// The loopback WebSocket the desktop app hosts. It accepts only this extension's pinned ID.
// Port = SessionLink.Port in src/GeminiLive/Glic/SessionLink.cs.
const LINK_URL = 'ws://127.0.0.1:8479/google-session';

// The app may not be running yet; retry quietly until it is.
const RECONNECT_MS = 5000;

// A sign-in or rotation changes several cookies at once; push them as one.
const ROTATION_DEBOUNCE_MS = 1500;

// Everything on google.com and its subdomains; the app picks the auth cookies it needs.
const GOOGLE_COOKIE_DOMAIN = 'google.com';

/**
 * Every message type on the link, both directions. The app's side is LinkMessageType in
 * src/GeminiLive/Glic/SessionLink.cs; the wire value is the lower-cased enum name.
 */
const MessageType = {
  /** Extension → app: the current Google cookies. */
  COOKIES: 'cookies',
  /** App → extension: send the current cookies now. */
  QUERY: 'query',
  /** App → extension: the session the app has stopped working; refresh it, then send it. */
  REFRESH: 'refresh',
  /** App → extension: keepalive, answered with PONG. */
  PING: 'ping',
  PONG: 'pong',
} as const;

type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Messages the app sends down the link. */
interface AppMessage {
  type?: MessageType;
}

const connection = new ReconnectController(connect, isSocketActive, RECONNECT_MS);

let pendingPush: ReturnType<typeof setTimeout> | undefined;

/** Whether a cookie belongs to the Google session the app mirrors. */
export function isGoogleCookie(cookie: Browser.cookies.Cookie): boolean {
  return cookie.domain.endsWith(GOOGLE_COOKIE_DOMAIN);
}

/**
 * Connects to the app unless already connected. Safe to call from the alarm and the
 * close-handler retry alike: never stacks sockets.
 */
export function ensureLinkConnected(): void {
  connection.ensure();
}

/** Pushes the session once a burst of cookie changes has settled. */
export function pushSessionSoon(): void {
  clearTimeout(pendingPush);
  pendingPush = setTimeout(() => void pushSession(), ROTATION_DEBOUNCE_MS);
}

function isSocketActive(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING;
}

async function collectCookies() {
  const cookies = await browser.cookies.getAll({ domain: GOOGLE_COOKIE_DOMAIN });
  return cookies.map(cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate ?? null,
  }));
}

async function pushSession(): Promise<void> {
  const socket = connection.current;
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  const cookies = await collectCookies();
  // The socket can drop during the async cookie read; never answer through a replacement.
  if (connection.current !== socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ type: MessageType.COOKIES, cookies }));
}

function parseMessage(data: unknown): AppMessage | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(data) as AppMessage;
  } catch {
    // Not ours to interpret; the app only sends JSON.
    return undefined;
  }
}

function connect(): WebSocket {
  const socket = new WebSocket(LINK_URL);

  socket.addEventListener('open', () => void pushSession());
  socket.addEventListener('message', ({ data }) => {
    if (connection.current !== socket) {
      return;
    }

    switch (parseMessage(data)?.type) {
      // The app wants the current session now (e.g. it has none yet).
      case MessageType.QUERY:
        void pushSession();
        return;
      // The app's copy stopped working (Gemini says signed out / unavailable). Send what we have,
      // and refresh it; the refreshed cookies follow through the cookie-change push.
      case MessageType.REFRESH:
        void pushSession();
        void refreshGoogleSession();
        return;
      // The app pings every ~20 s; answering keeps this service worker alive while it runs.
      case MessageType.PING:
        socket.send(JSON.stringify({ type: MessageType.PONG }));
        return;
      default:
        return;
    }
  });
  socket.addEventListener('close', () => connection.disconnected(socket));
  socket.addEventListener('error', () => socket.close());
  return socket;
}
