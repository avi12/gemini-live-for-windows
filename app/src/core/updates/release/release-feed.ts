import { z } from "zod";

import type { AppRelease } from "@/core/updates/app-release.ts";
import { parseVersion } from "@/core/updates/version/version.ts";

export const DEFAULT_FEED_URL =
  "https://raw.githubusercontent.com/avi12/gemini-live-for-windows/main/docs/updates.json";
// Points the check somewhere else, such as a local stand-in for GitHub, to test it
export const FEED_URL_VARIABLE = "GEMINILIVE_UPDATE_FEED";
export const USER_AGENT = "GeminiLive/1";
const LOOKUP_TIMEOUT_MS = 20_000;
const NOT_FOUND = 404;

const manifestSchema = z.object({
  version: z.string(),
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/)
});

export type Fetch = typeof fetch;

function isTrustedAddress(url: string) {
  const address = URL.parse(url);
  return address?.protocol === "https:" || address?.hostname === "localhost";
}

// The release the manifest names, or undefined when there is none or it can't be trusted. Like a
// browser extension's update URL, the app polls a small file, and nothing is offered until that
// file names a release.
export async function latestRelease({
  fetchFeed = fetch,
  env = process.env
}: {
  fetchFeed?: Fetch;
  env?: NodeJS.ProcessEnv;
} = {}) {
  const url = env[FEED_URL_VARIABLE] || DEFAULT_FEED_URL;
  const response = await fetchFeed(url, {
    headers: {
      "User-Agent": USER_AGENT
    },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
  });
  const isAbsent = response.status === NOT_FOUND;
  if (isAbsent) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(`update feed answered ${response.status}`);
  }

  const parsed = manifestSchema.safeParse(await response.json());
  if (!parsed.success) {
    return undefined;
  }

  const isTrusted = Boolean(parseVersion(parsed.data.version)) && isTrustedAddress(parsed.data.url);
  if (!isTrusted) {
    return undefined;
  }

  const release: AppRelease = {
    version: parsed.data.version,
    msixUrl: parsed.data.url,
    sha256: parsed.data.sha256
  };
  return release;
}
