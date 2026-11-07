import { USER_AGENT } from "./release-feed.ts";
import type { Fetch } from "./release-feed.ts";
import { log } from "@/core/log/log.ts";
import { openFile } from "@/core/shell/open-external.ts";
import type { AppRelease } from "@/core/updates/app-release.ts";
import { sha256OfFile } from "@/lib/sha256.ts";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

function defaultDownloadFolder() {
  return path.join(os.tmpdir(), "GeminiLive-update");
}

async function matches({ filePath, release }: {
  filePath: string;
  release: AppRelease;
}) {
  try {
    const actual = await sha256OfFile(filePath);
    return actual.toLowerCase() === release.sha256.toLowerCase();
  } catch {
    return false;
  }
}

async function fetchPackage({ release, filePath, fetchPackage: request }: {
  release: AppRelease;
  filePath: string;
  fetchPackage: Fetch;
}) {
  const response = await request(release.msixUrl, {
    headers: {
      "User-Agent": USER_AGENT
    }
  });
  if (!response.ok) {
    throw new Error(`download answered ${response.status}`);
  }

  if (!response.body) {
    throw new Error("download had no body");
  }

  await pipeline(response.body, createWriteStream(filePath));
}

// Downloads the release into the folder, checked against its hash: the file's path, or undefined
// when it fails the hash. A copy that already matches is reused.
export async function downloadRelease({
  release,
  folder = defaultDownloadFolder(),
  fetchPackage: request = fetch
}: {
  release: AppRelease;
  folder?: string;
  fetchPackage?: Fetch;
}) {
  await fs.mkdir(folder, { recursive: true });
  const filePath = path.join(folder, `GeminiLive-${release.version}.msix`);
  const isCached = await matches({
    filePath,
    release
  });
  if (!isCached) {
    await fetchPackage({
      release,
      filePath,
      fetchPackage: request
    });
  }

  if (await matches({
    filePath,
    release
  })) {
    return filePath;
  }

  await fs.rm(filePath, { force: true });
  log.write("update: the download didn't match its hash");
  return undefined;
}

// Opens the package in App Installer, where the user chooses Update. Windows checks the package's
// signature and publisher itself.
export function installRelease(filePath: string) {
  openFile({ filePath });
}
