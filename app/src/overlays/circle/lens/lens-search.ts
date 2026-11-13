import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import operatingSystem from "node:os";
import path from "node:path";

import { errorMessage } from "@/lib/error-message.ts";
import { lensUploadPage } from "@/overlays/circle/lens/lens-page.ts";
import type { CropFrame, FileOpener, OverlayLog } from "@/overlays/ports.ts";

// Where the one-shot upload pages go, so stale ones can be swept
export const LENS_PAGE_FOLDER = "GeminiLive-lens";

const LENS_PAGE_LIFETIME_MINUTES = 5;
const MILLISECONDS_PER_MINUTE = 60_000;

// How long an upload page is kept: the browser reads it once on open, so anything older is done
export const LENS_PAGE_LIFETIME_MS = LENS_PAGE_LIFETIME_MINUTES * MILLISECONDS_PER_MINUTE;

const LENS_PAGE_EXTENSION = ".html";

export function lensPageDirectory() {
  return path.join(operatingSystem.tmpdir(), LENS_PAGE_FOLDER);
}

// Deletes upload pages from earlier searches, which each hold a screenshot. One stuck page
// mustn't stop the search, so a failed delete is only logged
async function sweepOldPages({ directory, now, log }: { directory: string; now: () => number; log: OverlayLog }) {
  const names = await readdir(directory).catch(() => []);
  for (const name of names) {
    const isPage = name.endsWith(LENS_PAGE_EXTENSION);
    if (!isPage) {
      continue;
    }

    const page = path.join(directory, name);
    const info = await stat(page).catch(() => undefined);
    const isStale = info !== undefined && now() - info.mtimeMs > LENS_PAGE_LIFETIME_MS;
    if (!isStale) {
      continue;
    }

    await rm(page).catch((error: unknown) => {
      log.write(`sweep Lens page failed: ${errorMessage(error)}`);
    });
  }
}

// Opens Google Lens results for the crop in the default browser. A page that can't be written or
// opened is only logged; never throws, since a search is best-effort
export function createLensSearch({
  opener,
  log,
  now = Date.now,
  directory = lensPageDirectory()
}: {
  opener: FileOpener;
  log: OverlayLog;
  now?: () => number;
  directory?: string;
}) {
  async function search(crop: CropFrame) {
    try {
      await sweepOldPages({
        directory,
        now,
        log
      });
      await mkdir(directory, { recursive: true });
      const page = path.join(directory, `${randomUUID().replaceAll("-", "")}${LENS_PAGE_EXTENSION}`);
      await writeFile(
        page,
        lensUploadPage({
          crop,
          sentAtMs: now()
        }),
        "utf8"
      );
      opener.openFile({ filePath: page });
    } catch (error) {
      log.write(`Lens search failed: ${errorMessage(error)}`);
    }
  }

  return { search };
}
