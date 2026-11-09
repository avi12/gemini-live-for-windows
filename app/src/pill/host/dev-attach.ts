import type { loadDevMountPill } from "@gemini-live/pill/dev-mount";
import { PILL_DEV_MARKER_FILE, pillDevMarkerPath, readPillDevMarker } from "@gemini-live/protocol/pill-dev";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const DEV_MOUNT_FILE = "dev-mount.ts";

const devMountSchema = z.object({
  loadDevMountPill: z.custom<typeof loadDevMountPill>(value => typeof value === "function")
});

// While `pnpm dev` runs (its marker), the pill is mounted from the repo's module server; otherwise
// it is the bundled one. Mirrors PillSidecar.cs, which makes the same choice for the sidecar.
export async function loadMountPill() {
  const marker = readPillDevMarker();
  if (!marker) {
    const { mountPill } = await import("@gemini-live/pill/mount");
    return mountPill;
  }

  const devMountUrl = pathToFileURL(path.join(path.dirname(marker.pillDevEntry), DEV_MOUNT_FILE));
  const devMount = devMountSchema.parse(await import(devMountUrl.href));
  return devMount.loadDevMountPill();
}

// `pnpm dev` starting or stopping: the caller ends the window so it comes back from the other source
export function watchPillDevMarker({ onChanged }: { onChanged: () => void }) {
  const markerPath = pillDevMarkerPath();
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const watcher = fs.watch(path.dirname(markerPath), (_, fileName) => {
    const isMarker = fileName === PILL_DEV_MARKER_FILE;
    if (isMarker) {
      onChanged();
    }
  });
  return () => watcher.close();
}
