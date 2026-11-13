import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type BrowserCookie, browserCookiesSchema } from "@gemini-live/protocol/link";

import type { Logger, SecretSealer } from "@/google/ports.ts";

// The Google login/session family; the rest of a jar is analytics noise
const AUTH_COOKIE_PREFIXES = ["__Secure-", "__Host-"];
const AUTH_COOKIE_NAMES = new Set([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LSID",
  "OSID",
  "NID",
  "SIDCC",
  "ACCOUNT_CHOOSER",
  "LSOLH",
  "GAPS"
]);
const SESSION_COOKIE_NAMES = new Set(["SID", "__Secure-1PSID"]);

export const SameSite = {
  STRICT: "strict",
  LAX: "lax",
  NONE: "none"
} as const;

export function isAuthCookie(name: string) {
  const hasAuthPrefix = AUTH_COOKIE_PREFIXES.some(prefix => name.startsWith(prefix));
  return hasAuthPrefix || AUTH_COOKIE_NAMES.has(name);
}

export function authCookies(cookies: readonly BrowserCookie[]) {
  return cookies.filter(cookie => isAuthCookie(cookie.name));
}

// True when the jar has a Google login at all
export function hasSession(cookies: readonly BrowserCookie[]) {
  return cookies.some(cookie => SESSION_COOKIE_NAMES.has(cookie.name));
}

// Stable fingerprint, to skip re-injecting an unchanged session
export function fingerprint(cookies: readonly BrowserCookie[]) {
  const lines = cookies.map(cookie => `${cookie.domain}|${cookie.name}|${cookie.value}`).toSorted();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function sameSiteOf(value: string | null | undefined) {
  const isRestrictive = value === SameSite.STRICT || value === SameSite.LAX;
  if (isRestrictive) {
    return value;
  }

  return SameSite.NONE;
}

export function encodeSession(cookies: readonly BrowserCookie[]) {
  return new TextEncoder().encode(JSON.stringify(cookies));
}

// Throws when the bytes are not a cookie list, so the caller can say why the session was dropped
export function decodeSession(plain: Uint8Array) {
  const parsed = browserCookiesSchema.safeParse(JSON.parse(new TextDecoder().decode(plain)));
  if (!parsed.success) {
    throw new Error(`the cookie list has an unexpected shape: ${parsed.error.message}`);
  }

  return parsed.data;
}

// The sealed copy of the browser's session, so a restart is signed in before the extension
// reconnects. The same file and format the C# app wrote: sealed JSON of the cookie list.
export function createSessionStore({ filePath, sealer, log }: { filePath: string; sealer: SecretSealer; log: Logger }) {
  async function save(cookies: readonly BrowserCookie[]) {
    const sealed = await sealer.seal(encodeSession(cookies));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, sealed);
  }

  async function load() {
    try {
      const sealed = await readFile(filePath);
      return decodeSession(await sealer.unseal(sealed));
    } catch (error) {
      const isMissing = error instanceof Error && "code" in error && error.code === "ENOENT";
      if (!isMissing) {
        log.write(`saved Google session unreadable: ${error instanceof Error ? error.message : String(error)}`);
      }

      return [];
    }
  }

  return {
    save,
    load
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
