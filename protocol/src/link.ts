import { z } from "zod";

export const NATIVE_HOST_NAME = "com.avi12.gemini_live";

export const EXTENSION_ORIGIN = "chrome-extension://bejbkccodipbnbjeagmihnhnfadnjgeh";

export const LinkMessage = {
  hello: "hello",
  query: "query",
  refresh: "refresh",
  ping: "ping",
  cookies: "cookies"
} as const;
export type LinkMessage = typeof LinkMessage[keyof typeof LinkMessage];

export const NativeMessage = { link: "link" } as const;
export type NativeMessage = typeof NativeMessage[keyof typeof NativeMessage];

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
  [LinkMessage.hello](token: string): void;
  [LinkMessage.query](): unknown;
  [LinkMessage.refresh](): void;
  [LinkMessage.ping](): void;
  [LinkMessage.cookies](cookies: unknown): void;
}

export interface NativeProtocolMap {
  [NativeMessage.link](): LinkInfo | null;
}
