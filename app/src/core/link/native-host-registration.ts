import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { EXTENSION_ORIGIN, type LinkInfo, NATIVE_HOST_NAME } from "@gemini-live/protocol/link";

import { log } from "@/core/log/log.ts";
import { writeFileAtomic } from "@/lib/atomic-file.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { browserDir } from "@/lib/paths.ts";

import { writeLinkFile } from "./link-file.ts";

const execFileAsync = promisify(execFile);

// The browsers' manifest key, snake_case on the wire
export const ORIGINS_KEY = "allowed_origins";

interface SetDefaultValueCommand {
  key: string;
  value: string;
}

// Each Chromium browser looks for its hosts under its own key; the default value names the manifest
export const BROWSER_KEYS = [
  String.raw`Software\Google\Chrome`,
  String.raw`Software\Microsoft\Edge`,
  String.raw`Software\BraveSoftware\Brave-Browser`,
  String.raw`Software\Chromium`
] as const;

export type SetDefaultValue = (command: SetDefaultValueCommand) => Promise<void>;

async function setDefaultValueWithRegExe({ key, value }: Parameters<SetDefaultValue>[0]) {
  await execFileAsync("reg.exe", ["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"], { windowsHide: true });
}

// Packaged, a browser can't start an exe inside the package folder, so the host goes through the
// package's app execution alias
export function packagedHostPath({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  const base = env["LOCALAPPDATA"] ?? "";
  return path.join(base, "Microsoft", "WindowsApps", "GeminiLiveHost.exe");
}

export function hostKey(browserKey: string) {
  return ["HKCU", browserKey, "NativeMessagingHosts", NATIVE_HOST_NAME].join("\\");
}

function manifestPath(dir = browserDir()) {
  return path.join(dir, `${NATIVE_HOST_NAME}.json`);
}

function hostManifest(hostPath: string) {
  return {
    name: NATIVE_HOST_NAME,
    description: "Tells the Gemini Live extension where the running app listens",
    path: hostPath,
    type: "stdio",
    // Chrome matches the origin with its trailing slash
    [ORIGINS_KEY]: [`${EXTENSION_ORIGIN}/`]
  };
}

// Writes the host manifest and points every browser at it. Redone on each start, so the path
// follows wherever this build of the app lives.
export async function registerNativeHost({
  hostPath,
  dir = browserDir(),
  setDefaultValue = setDefaultValueWithRegExe
}: {
  hostPath: string;
  dir?: string;
  setDefaultValue?: SetDefaultValue;
}) {
  const filePath = manifestPath(dir);
  await writeFileAtomic({
    filePath,
    content: JSON.stringify(hostManifest(hostPath), null, 2)
  });
  await Promise.all(
    BROWSER_KEYS.map(browserKey =>
      setDefaultValue({
        key: hostKey(browserKey),
        value: filePath
      })
    )
  );
}

async function attempt({ what, work }: { what: string; work: () => Promise<void> }) {
  try {
    await work();
  } catch (error) {
    log.write(`native host: ${what}: ${errorMessage(error)}`);
  }
}

// Publishes where this run listens and (re)registers the host that hands it out
export async function publishNativeHost({ link, hostPath }: { link: LinkInfo; hostPath: string }) {
  await attempt({
    what: "link file",
    work: () => writeLinkFile({ link })
  });
  await attempt({
    what: "register",
    async work() {
      await registerNativeHost({ hostPath });
      log.write(`native host: registered ${hostPath}`);
    }
  });
}
