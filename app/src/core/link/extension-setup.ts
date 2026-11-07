import { defaultBrowser } from "./default-browser.ts";
import type { DefaultBrowser } from "./default-browser.ts";
import { log } from "@/core/log/log.ts";
import { copyTextWithPowerShell } from "@/lib/clipboard.ts";
import type { CopyText } from "@/lib/clipboard.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { launchDetached } from "@/lib/launch.ts";
import type { Launch } from "@/lib/launch.ts";
import { browserDir } from "@/lib/paths.ts";
import fs from "node:fs/promises";
import path from "node:path";

const EXTENSION_FOLDER = "extension";

function installedExtensionDir(dir = browserDir()) {
  return path.join(dir, EXTENSION_FOLDER);
}

// Puts the extension's files somewhere a browser can load them from
async function copyShippedExtension({ shippedDir, targetDir = installedExtensionDir() }: {
  shippedDir: string;
  targetDir?: string;
}) {
  await fs.cp(shippedDir, targetDir, {
    recursive: true,
    force: true
  });
}

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

// Keeps an installed copy current with the build this app ships, so an update reaches the browser
// the next time it reloads the extension. Does nothing before the first setup.
export async function refreshInstalledExtension({ shippedDir, targetDir = installedExtensionDir() }: {
  shippedDir: string;
  targetDir?: string;
}) {
  if (!await exists(targetDir)) {
    return;
  }

  try {
    await copyShippedExtension({
      shippedDir,
      targetDir
    });
  } catch (error) {
    log.write(`extension refresh failed: ${errorMessage(error)}`);
  }
}

// The start command resolves "chrome", "brave" and "msedge" through the App Paths registry key,
// the way Windows' Run box does; chrome:// pages open only through the browser itself
function openExtensionsPage({ browser, launch = launchDetached }: {
  browser: DefaultBrowser;
  launch?: Launch;
}) {
  launch({
    file: "cmd.exe",
    args: ["/c", "start", "", browser.executable, browser.extensionsPage]
  });
}

// One-click setup: loading an unpacked extension is the one step a browser won't let an app do for
// you, so copy it, put its folder on the clipboard and open the extensions page
export async function connectExtension({
  shippedDir,
  targetDir = installedExtensionDir(),
  copyText = copyTextWithPowerShell,
  launch = launchDetached,
  findBrowser = defaultBrowser
}: {
  shippedDir: string;
  targetDir?: string;
  copyText?: CopyText;
  launch?: Launch;
  findBrowser?: () => Promise<DefaultBrowser>;
}) {
  await copyShippedExtension({
    shippedDir,
    targetDir
  });
  await copyText(targetDir).catch(error => {
    log.write(`clipboard busy: ${errorMessage(error)}`);
  });
  openExtensionsPage({
    browser: await findBrowser(),
    launch
  });
}
