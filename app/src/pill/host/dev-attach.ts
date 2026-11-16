import fileSystem from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { loadDevModule } from "@gemini-live/pill/dev-modules";
import { PILL_DEV_MARKER_FILE, pillDevMarkerPath, readPillDevMarker } from "@gemini-live/protocol/pill-dev";
import type { PillDevMarker } from "@gemini-live/protocol/pill-dev";
import { z } from "zod";

import type { startApp } from "@/wiring/main-thread/start-app.ts";
import type { startUi } from "@/wiring/ui-thread/start-ui.ts";

const DEV_MODULES_FILE = "dev-modules.ts";
// The app's two threads, by the module each starts from, in the module server's root (app/)
const START_UI_ENTRY = "/src/wiring/ui-thread/start-ui.ts";
const START_APP_ENTRY = "/src/wiring/main-thread/start-app.ts";
// Folders whose saved files restart the app: its own code and the protocol it shares with the pill.
// The pill's components are not here, since they update in place.
const WATCHED_FOLDERS = [path.join("app", "src"), path.join("protocol", "src")];
const RESTART_DELAY_MILLISECONDS = 400;

const devModulesSchema = z.object({
  loadDevModule: z.custom<typeof loadDevModule>(value => typeof value === "function")
});

// While `pnpm dev` runs (its marker), a thread's whole code, the pill's code with it, is loaded from the
// repo's module server so a saved file takes effect without installing; otherwise it is the bundled one.
// The pill's sidecar (PillSidecar.cs) makes the same choice.
async function loadFromSource<Exports>({ marker, entry }: { marker: PillDevMarker; entry: string }) {
  const devModulesUrl = pathToFileURL(path.join(path.dirname(marker.pillDevEntry), DEV_MODULES_FILE));
  const devModules = devModulesSchema.parse(await import(devModulesUrl.href));
  return devModules.loadDevModule<Exports>(entry);
}

export async function loadStartUi() {
  const marker = readPillDevMarker();
  if (!marker) {
    const module = await import("@/wiring/ui-thread/start-ui.ts");
    return module.startUi;
  }

  const { startUi: fromSource } = await loadFromSource<{ startUi: typeof startUi }>({
    marker,
    entry: START_UI_ENTRY
  });
  return fromSource;
}

export async function loadStartApp() {
  const marker = readPillDevMarker();
  if (!marker) {
    const module = await import("@/wiring/main-thread/start-app.ts");
    return module.startApp;
  }

  const { startApp: fromSource } = await loadFromSource<{ startApp: typeof startApp }>({
    marker,
    entry: START_APP_ENTRY
  });
  return fromSource;
}

// `pnpm dev` starting or stopping: the caller ends the window so it comes back from the other source
export function watchPillDevMarker({ onChanged }: { onChanged: () => void }) {
  const markerPath = pillDevMarkerPath();
  fileSystem.mkdirSync(path.dirname(markerPath), { recursive: true });
  const watcher = fileSystem.watch(path.dirname(markerPath), (_, fileName) => {
    const isMarker = fileName === PILL_DEV_MARKER_FILE;
    if (isMarker) {
      onChanged();
    }
  });
  return () => watcher.close();
}

// While `pnpm dev` runs, a saved file of the app's own code (not a test) calls for a restart: the
// caller ends the window, and the app starts again from the new source
export function watchDevSources({ onChanged }: { onChanged: () => void }) {
  const marker = readPillDevMarker();
  if (!marker) {
    return () => undefined;
  }

  const pending: { timer: NodeJS.Timeout | undefined } = { timer: undefined };
  const watchers = WATCHED_FOLDERS.map(folder =>
    fileSystem.watch(path.join(marker.repoRoot, folder), { recursive: true }, (_, fileName) => {
      const isSource = fileName !== null && !fileName.endsWith(".test.ts");
      if (!isSource) {
        return;
      }

      clearTimeout(pending.timer);
      pending.timer = setTimeout(onChanged, RESTART_DELAY_MILLISECONDS);
    })
  );
  return () => {
    clearTimeout(pending.timer);
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}
