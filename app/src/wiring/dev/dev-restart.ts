import fileSystem from "node:fs";
import path from "node:path";

import { PILL_DEV_MARKER_FILE, pillDevMarkerPath, readPillDevMarker } from "@gemini-live/protocol/pill-dev";

// Folders whose saved files restart the app: its own code and the protocol it shares with the pill.
// The pill's components are not here, since they update in place.
const WATCHED_FOLDERS = [path.join("app", "src"), path.join("protocol", "src")];
const RESTART_DELAY_MILLISECONDS = 400;
// How often a restart waiting for the pill to be put away looks again
const IDLE_POLL_MILLISECONDS = 2000;

// `pnpm dev` starting or stopping: the caller ends the window so it comes back from the other source
function watchPillDevMarker({ onChanged }: { onChanged: () => void }) {
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
function watchDevSources({ onChanged }: { onChanged: () => void }) {
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

// How `pnpm dev` applies a change: ending the window makes the app start again (worker-supervisor.ts).
// `pnpm dev` starting or stopping ends it at once; a saved file waits for the pill to be put away, so
// it never closes on someone using it.
export function restartOnDevChanges({ endWindow, isInUse }: { endWindow: () => void; isInUse: () => boolean }) {
  const restart = { isWaiting: false };
  function endWindowWhenIdle() {
    if (isInUse()) {
      setTimeout(endWindowWhenIdle, IDLE_POLL_MILLISECONDS);
      return;
    }

    restart.isWaiting = false;
    endWindow();
  }

  watchPillDevMarker({ onChanged: endWindow });
  watchDevSources({
    onChanged() {
      if (restart.isWaiting) {
        return;
      }

      restart.isWaiting = true;
      endWindowWhenIdle();
    }
  });
}
