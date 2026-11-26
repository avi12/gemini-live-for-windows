import path from "node:path";
import { pathToFileURL } from "node:url";

import type { loadDevModule } from "@gemini-live/pill/dev-modules";
import { readPillDevMarker } from "@gemini-live/protocol/pill-dev";
import type { PillDevMarker } from "@gemini-live/protocol/pill-dev";
import { z } from "zod";

import type { startApp } from "@/wiring/main-thread/start-app.ts";
import type { startUi } from "@/wiring/ui-thread/start-ui.ts";

const DEV_MODULES_FILE = "dev-modules.ts";
// The app's two threads, by the module each starts from, in the module server's root (app/)
const START_UI_ENTRY = "/src/wiring/ui-thread/start-ui.ts";
const START_APP_ENTRY = "/src/wiring/main-thread/start-app.ts";

const devModulesSchema = z.object({
  loadDevModule: z.custom<typeof loadDevModule>(value => typeof value === "function")
});

async function loadFromSource<Exports>({ marker, entry }: { marker: PillDevMarker; entry: string }) {
  const devModulesUrl = pathToFileURL(path.join(path.dirname(marker.pillDevEntry), DEV_MODULES_FILE));
  const devModules = devModulesSchema.parse(await import(devModulesUrl.href));
  return devModules.loadDevModule<Exports>({
    root: path.join(marker.repoRoot, "app"),
    entry
  });
}

// While `bun run dev` runs (its marker), a thread's whole code, the pill's code with it, is loaded from the
// repo's module server so a saved file takes effect without installing; otherwise it is the bundled one.
// The pill's sidecar (PillSidecar.cs) makes the same choice.
function loadThreadModule<Exports>({ entry, bundled }: { entry: string; bundled: () => Promise<Exports> }) {
  const marker = readPillDevMarker();
  if (!marker) {
    return bundled();
  }

  return loadFromSource<Exports>({
    marker,
    entry
  });
}

export async function loadStartUi() {
  const module = await loadThreadModule<{ startUi: typeof startUi }>({
    entry: START_UI_ENTRY,
    bundled: () => import("@/wiring/ui-thread/start-ui.ts")
  });
  return module.startUi;
}

export async function loadStartApp() {
  const module = await loadThreadModule<{ startApp: typeof startApp }>({
    entry: START_APP_ENTRY,
    bundled: () => import("@/wiring/main-thread/start-app.ts")
  });
  return module.startApp;
}
