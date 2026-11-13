import path from "node:path";

import { removePillDevMarker, writePillDevMarker } from "@gemini-live/protocol/pill-dev";

import { PILL_ROOT } from "./module-server.ts";

const ATTACH_MODULE = path.join(import.meta.dirname, "attach.ts");
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGBREAK"] as const;
const KEEP_ALIVE_MILLISECONDS = 60_000;

function report(message: string) {
  process.stderr.write(`dev: ${message}\n`);
}

// While this runs, the installed app starts its pill from this repo's module server: the marker
// is what it looks for, and it is gone again the moment this ends
export function runWatchApp() {
  writePillDevMarker({
    marker: {
      pillDevEntry: ATTACH_MODULE,
      repoRoot: path.resolve(PILL_ROOT, ".."),
      pid: process.pid
    }
  });
  process.on("exit", () => removePillDevMarker());
  for (const signal of STOP_SIGNALS) {
    process.on(signal, () => process.exit(0));
  }

  report(`the installed app now loads the pill from ${path.join(PILL_ROOT, "src")}; press Win+C to open it`);
  return new Promise<number>(() => setInterval(() => undefined, KEEP_ALIVE_MILLISECONDS));
}
