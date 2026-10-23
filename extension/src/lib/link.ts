import { ReconnectController } from '@/lib/reconnect';
import { refreshGoogleSession } from '@/lib/refresh';

// The loopback WebSocket the desktop app hosts. It accepts only this extension's pinned ID. Its
// port is free-picked per run, so the app writes it, with a token, into this extension's own folder
// (ExtensionSetup.PublishLink in src/GeminiLive/Glic/ExtensionSetup.cs).
const LINK_FILE = 'link.json';
const LINK_PATH = '/google-session';

// The app may not be running yet; retry quietly until it is.
const RECONNECT_MS = 5000;

// The app says Hello the moment the socket opens. Whatever is on a stale port without saying it,
// with the right token, is not the app and never gets the session.
const HELLO_TIMEOUT_MS = 5000;

// A sign-in or rotation changes several cookies at once; push them as one.
const ROTATION_DEBOUNCE_MS = 1500;

// Everything on google.com and its subdomains; the app picks the auth cookies it needs.
const GOOGLE_COOKIE_DOMAIN = 'google.com';

/**
 * Every message type on the link, both directions. The app's side is LinkMessageType in
 * src/GeminiLive/Glic/SessionLink.cs; the wire value is the lower-cased enum name.
 */
const MessageType = {
  /** App → extension, first: this run's token, proving it is the app that wrote the link file. */
  HELLO: 'hello',
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
  token?: string;
}

/** Where this run of the app listens (the link file). */
interface LinkInfo {
  port: number;
  token: string;
}

/**
 * One attempt at the link: reading the link file, then the socket. `trusted` once the app's Hello
 * carried the file's token; nothing is sent before that.
 */
interface Link {
  socket?: WebSocket;
  trusted: boolean;
  closed: boolean;
}

const connection = new ReconnectController(connect, isLinkActive, RECONNECT_MS);

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

function isLinkActive(link: Link): boolean {
  return !link.closed;
}

/** The trusted, open socket to the app, if there is one. */
function trustedSocket(): WebSocket | undefined {
  const link = connection.current;
  const socket = link?.socket;
  return link?.trusted && socket?.readyState === WebSocket.OPEN ? socket : undefined;
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
  const socket = trustedSocket();
  if (!socket) {
    return;
  }

  const cookies = await collectCookies();
  // The socket can drop during the async cookie read; never answer through a replacement.
  if (trustedSocket() !== socket) {
    return;
  }

  socket.send(JSON.stringify({ type: MessageType.COOKIES, cookies }));
}

/** The link file as the app last wrote it, or undefined before the app has ever run. */
async function readLinkInfo(): Promise<LinkInfo | undefined> {
  try {
    const response = await fetch(new URL(LINK_FILE, location.origin), { cache: 'no-store' });
    const info = (await response.json()) as Partial<LinkInfo>;
    return typeof info.port === 'number' && typeof info.token === 'string'
      ? { port: info.port, token: info.token }
      : undefined;
  } catch {
    return undefined;
  }
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

function close(link: Link): void {
  if (link.closed) {
    return;
  }

  link.closed = true;
  link.socket?.close();
  connection.disconnected(link);
}

function connect(): Link {
  const link: Link = { trusted: false, closed: false };
  void readLinkInfo().then(info => {
    if (link.closed) {
      return;
    }

    if (!info) {
      close(link);
      return;
    }

    open(link, info);
  });
  return link;
}

function open(link: Link, info: LinkInfo): void {
  const socket = new WebSocket(`ws://127.0.0.1:${info.port}${LINK_PATH}`);
  link.socket = socket;
  const helloTimer = setTimeout(() => close(link), HELLO_TIMEOUT_MS);

  socket.addEventListener('message', ({ data }) => {
    if (connection.current !== link) {
      return;
    }

    const message = parseMessage(data);
    if (!link.trusted) {
      if (message?.type !== MessageType.HELLO || message.token !== info.token) {
        close(link);
        return;
      }

      clearTimeout(helloTimer);
      link.trusted = true;
      void pushSession();
      return;
    }

    switch (message?.type) {
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
  socket.addEventListener('close', () => {
    clearTimeout(helloTimer);
    close(link);
  });
  socket.addEventListener('error', () => close(link));
}
