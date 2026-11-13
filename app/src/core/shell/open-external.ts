import { launchDetached } from "@/lib/launch.ts";
import type { Launch } from "@/lib/launch.ts";

const OPENER = "explorer.exe";
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

  launch({
    file: OPENER,
    args: [address.href]
  });
  return true;
}
