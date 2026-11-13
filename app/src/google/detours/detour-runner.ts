import type { LiveEventSink } from "@/google/live-event-sink.ts";

// Runs one detour at a time. The request is marked handled up front, so neither trigger re-fires
// for it.
export function createDetourRunner(sink: LiveEventSink) {
  let handledUtterance = "";
  let isRunning = false;

  async function run({
    request,
    statusText,
    detour
  }: {
    request: string;
    statusText: string;
    detour: () => Promise<void>;
  }) {
    if (isRunning) {
      return;
    }

    isRunning = true;
    handledUtterance = request;
    sink.status(statusText);
    try {
      await detour();
    } finally {
      isRunning = false;
    }
  }

  return {
    run,
    get isRunning() {
      return isRunning;
    },
    get handledUtterance() {
      return handledUtterance;
    }
  };
}
