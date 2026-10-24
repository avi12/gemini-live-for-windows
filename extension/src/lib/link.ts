import { type BrowserCookie, LinkMessage, type LinkProtocolMap } from "@/lib/link-protocol";
import { readLinkInfo } from "@/lib/native-host";
import type { LinkInfo } from "@/lib/native-protocol";
import { ReconnectController } from "@/lib/reconnect";
import { refreshGoogleSession } from "@/lib/refresh";
import { defineMessaging, type Messenger, type Transport } from "@gemini-live/messaging";

// The loopback WebSocket the desktop app hosts. It accepts only this extension's pinned ID. Its
// port is free-picked per run, so the extension asks the app's native messaging host for it, with
// a token, on every attempt: that works wherever the browser installed the extension from.
const LINK_PATH = "/google-session";

// The app may not be running yet; retry quietly until it is.
const RECONNECT_MS = 5000;

// The app says Hello the moment the socket opens. Whatever is on a stale port without saying it,
// with the right token, is not the app and never gets the session.
const HELLO_TIMEOUT_MS = 5000;

// The app answers from its own process at once; a slower reply means the link is gone.
const MESSAGE_TIMEOUT_MS = 10000;

// A sign-in or rotation changes several cookies at once; push them as one.
const ROTATION_DEBOUNCE_MS = 1500;

// Everything on google.com and its subdomains; the app picks the auth cookies it needs.
const GOOGLE_COOKIE_DOMAIN = "google.com";

/**
 * One attempt at the link: asking the native host for it, then the socket and its messenger (from
 * the moment the socket opens). `trusted` once the app's Hello carried the host's token; nothing
 * is sent or answered before that.
 */
interface Link {
  socket?: WebSocket;
  messenger?: Messenger<LinkProtocolMap>;
  trusted: boolean;
  closed: boolean;
}

const connection = new ReconnectController(connect, isLinkActive, RECONNECT_MS);

let pendingPush: ReturnType<typeof setTimeout> | undefined;

/** Whether a cookie belongs to the Google session the app mirrors. */
export function isGoogleCookie(cookie: Browser.cookies.Cookie): boolean {
  // google.com itself or a subdomain (".google.com", "accounts.google.com"), never "notgoogle.com"
  const domain = cookie.domain.replace(/^\./, "");
  return domain === GOOGLE_COOKIE_DOMAIN || domain.endsWith(`.${GOOGLE_COOKIE_DOMAIN}`);
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

/** The messenger of the trusted, open link to the app, if there is one. */
function trustedMessenger(): Messenger<LinkProtocolMap> | undefined {
  const link = connection.current;
  return link?.trusted && link.socket?.readyState === WebSocket.OPEN ? link.messenger : undefined;
}

/** The link's socket as a messaging transport: JSON text frames both ways. */
function socketTransport(socket: WebSocket): Transport {
  return {
    post(envelope) {
      // A closing socket drops the frame; its sender's timeout reports it.
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(envelope));
      }
    },
    listen(receive) {
      socket.addEventListener("message", ({ data }) => {
        if (typeof data !== "string") {
          return;
        }

        try {
          receive(JSON.parse(data));
        } catch {
          // Not ours to interpret; the app only sends JSON.
        }
      });
    }
  };
}

async function collectCookies(): Promise<BrowserCookie[]> {
  const cookies = await browser.cookies.getAll({ domain: GOOGLE_COOKIE_DOMAIN });
  return cookies.map(cookie => ({
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

async function pushSession(): Promise<void> {
  const messenger = trustedMessenger();
  if (!messenger) {
    return;
  }

  const cookies = await collectCookies();
  // The link can drop during the async cookie read; never answer through a replacement.
  if (trustedMessenger() !== messenger) {
    return;
  }

  // The link may drop before the app's receipt arrives; the next connect pushes again.
  messenger.sendMessage(LinkMessage.Cookies, cookies).catch(() => undefined);
}

/** Ends this attempt once, and lets the controller schedule the next. */
function closeLink(link: Link): void {
  if (link.closed) {
    return;
  }

  link.closed = true;
  link.messenger?.removeAllListeners();
  link.socket?.close();
  connection.disconnected(link);
}

/** Refuses anything but a Hello before the app has proven itself, ending the link as before. */
function requireTrusted(link: Link): void {
  if (connection.current === link && link.trusted) {
    return;
  }

  closeLink(link);
  throw new Error("Not trusted: Hello first");
}

function connect(): Link {
  const link: Link = {
    trusted: false,
    closed: false
  };
  void readLinkInfo().then(info => {
    if (link.closed) {
      return;
    }

    if (!info) {
      closeLink(link);
      return;
    }

    open(link, info);
  });
  return link;
}

function open(link: Link, info: LinkInfo): void {
  const socket = new WebSocket(`ws://127.0.0.1:${info.port}${LINK_PATH}`);
  link.socket = socket;
  const helloTimer = setTimeout(() => closeLink(link), HELLO_TIMEOUT_MS);

  socket.addEventListener("open", () => {
    const messenger = defineMessaging<LinkProtocolMap>(socketTransport(socket), {
      timeoutMs: MESSAGE_TIMEOUT_MS
    });
    link.messenger = messenger;

    messenger.onMessage(LinkMessage.Hello, ({ data: token }) => {
      if (connection.current !== link || token !== info.token) {
        closeLink(link);
        throw new Error("Wrong token");
      }

      clearTimeout(helloTimer);
      link.trusted = true;
      void pushSession();
    });
    // The app wants the current session now (e.g. it has none yet).
    messenger.onMessage(LinkMessage.Query, () => {
      requireTrusted(link);
      return collectCookies();
    });
    // The app's copy stopped working (Gemini says signed out / unavailable). Send what we have,
    // and refresh it; the refreshed cookies follow through the cookie-change push.
    messenger.onMessage(LinkMessage.Refresh, () => {
      requireTrusted(link);
      void pushSession();
      void refreshGoogleSession();
    });
    // The app pings every ~20 s; the reply is the keepalive that holds this service worker awake.
    messenger.onMessage(LinkMessage.Ping, () => requireTrusted(link));
  });
  socket.addEventListener("close", () => {
    clearTimeout(helloTimer);
    closeLink(link);
  });
  socket.addEventListener("error", () => closeLink(link));
}
