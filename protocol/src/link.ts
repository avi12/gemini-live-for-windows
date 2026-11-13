import { z } from "zod";

export const NATIVE_HOST_NAME = "com.avi12.gemini_live";

export const EXTENSION_ORIGIN = "chrome-extension://bejbkccodipbnbjeagmihnhnfadnjgeh";

export const LinkMessage = {
  HELLO: "hello",
  QUERY: "query",
  REFRESH: "refresh",
  PING: "ping",
  COOKIES: "cookies"
} as const;
export type LinkMessage = (typeof LinkMessage)[keyof typeof LinkMessage];

export const NativeMessage = { LINK: "link" } as const;
export type NativeMessage = (typeof NativeMessage)[keyof typeof NativeMessage];

export const browserCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.string().nullish(),
  expirationDate: z.number().nullish()
});

export type BrowserCookie = z.infer<typeof browserCookieSchema>;

export const browserCookiesSchema = z.array(browserCookieSchema);

export const linkInfoSchema = z.object({
  port: z.number().int().positive(),
  token: z.string().min(1)
});

export type LinkInfo = z.infer<typeof linkInfoSchema>;

export interface LinkProtocolMap {
  [LinkMessage.HELLO](token: string): void;
  [LinkMessage.QUERY](): unknown;
  [LinkMessage.REFRESH](): void;
  [LinkMessage.PING](): void;
  [LinkMessage.COOKIES](cookies: unknown): void;
}

export interface NativeProtocolMap {
  [NativeMessage.LINK](): LinkInfo | null;
}
