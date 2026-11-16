import { launchDetached } from "@/lib/launch.ts";
import type { Launch } from "@/lib/launch.ts";

const OPENER = "explorer.exe";
const URL_OPENER = "rundll32.exe";
const URL_HANDLER = "url.dll,FileProtocolHandler";
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// What a double-click would do with a file (a package opens in App Installer)
export function openFile({ filePath, launch = launchDetached }: { filePath: string; launch?: Launch }) {
  launch({
    file: OPENER,
    args: [filePath]
  });
}

// Only web addresses: a link in a caption must never start a program
export function openExternal({ uri, launch = launchDetached }: { uri: string; launch?: Launch }) {
  const address = URL.parse(uri);
  const isWebAddress = address !== null && ALLOWED_PROTOCOLS.has(address.protocol);
  if (!isWebAddress) {
    return false;
  }

  // Not through Explorer: it passes our hidden-window start on to the browser it opens
  launch({
    file: URL_OPENER,
    args: [URL_HANDLER, address.href]
  });
  return true;
}
