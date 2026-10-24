// Every message between this extension and the desktop app's SessionLink, as a protocol map keyed
// by an enum. The app's side is src/GeminiLive/Glic/LinkProtocol.cs.

export enum LinkMessage {
  // app → extension
  Hello = "hello",
  Query = "query",
  Refresh = "refresh",
  Ping = "ping",
  // extension → app
  Cookies = "cookies"
}

/** One cookie as chrome.cookies reports it (GoogleCookie in C#). */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expirationDate: number | null;
}

export interface LinkProtocolMap {
  /**
   * First on every connection: this run's token, proving it is the app whose native host gave out
   * the link. Nothing else is answered until it matches.
   */
  [LinkMessage.Hello](token: string): void;
  /** The browser's current Google cookies. */
  [LinkMessage.Query](): BrowserCookie[];
  /** The app's copy stopped working: refresh the browser's session; it follows as Cookies. */
  [LinkMessage.Refresh](): void;
  /** Keepalive; answering it keeps this service worker awake. */
  [LinkMessage.Ping](): void;
  /** The cookies after a sign-in or a rotation. */
  [LinkMessage.Cookies](cookies: BrowserCookie[]): void;
}
