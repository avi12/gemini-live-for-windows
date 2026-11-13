import fileSystem from "node:fs";
import operatingSystem from "node:os";
import path from "node:path";

import { z } from "zod";

// The dev marker: `pnpm dev` writes it while it runs, and the installed app reads it each time it
// starts the pill, so the pill's code comes from the repo's module server instead of the bundle.
// This file is the single source of truth: src/GeminiLive/Pill/Sidecar/PillDevMarker.cs mirrors
// the file's name and shape one for one.

export const PILL_DEV_MARKER_FILE = "dev.json";
export const APP_DATA_FOLDER = "GeminiLive";

const PROCESS_DENIED_CODE = "EPERM";

export const pillDevMarkerSchema = z.object({
  pillDevEntry: z.string().min(1),
  repoRoot: z.string().min(1),
  pid: z.number().int().positive()
});

export type PillDevMarker = z.infer<typeof pillDevMarkerSchema>;

export function isProcessRunning(processId: number) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    const isDenied = error instanceof Error && "code" in error && error.code === PROCESS_DENIED_CODE;
    return isDenied;
  }
}

export function pillDevMarkerPath({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  const base = env["LOCALAPPDATA"] ?? path.join(operatingSystem.homedir(), "AppData", "Local");
  return path.join(base, APP_DATA_FOLDER, PILL_DEV_MARKER_FILE);
}

function parseMarker(text: string) {
  try {
    return pillDevMarkerSchema.safeParse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

// The marker only when it is well formed, its process is alive and its entry exists
export function readPillDevMarker({ markerPath = pillDevMarkerPath() }: { markerPath?: string } = {}) {
  if (!fileSystem.existsSync(markerPath)) {
    return undefined;
  }

  const parsed = parseMarker(fileSystem.readFileSync(markerPath, "utf8"));
  if (!parsed?.success) {
    return undefined;
  }

  const isUsable = isProcessRunning(parsed.data.pid) && fileSystem.existsSync(parsed.data.pillDevEntry);
  return isUsable ? parsed.data : undefined;
}

export function writePillDevMarker({
  marker,
  markerPath = pillDevMarkerPath()
}: {
  marker: PillDevMarker;
  markerPath?: string;
}) {
  fileSystem.mkdirSync(path.dirname(markerPath), { recursive: true });
  fileSystem.writeFileSync(markerPath, JSON.stringify(pillDevMarkerSchema.parse(marker)));
}

export function removePillDevMarker({ markerPath = pillDevMarkerPath() }: { markerPath?: string } = {}) {
  fileSystem.rmSync(markerPath, { force: true });
}
