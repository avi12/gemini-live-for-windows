import { startDevWindow } from "./dev-window.ts";
import { startRelay } from "@gemini-live/pill/relay";
import { readPillDevMarker } from "@gemini-live/protocol/pill-dev";

const MARKER_POLL_MILLISECONDS = 1000;

function endWithMarker() {
  const timer = setInterval(() => {
    const isDevRunning = readPillDevMarker() !== undefined;
    if (!isDevRunning) {
      process.exit(0);
    }
  }, MARKER_POLL_MILLISECONDS);
  timer.unref();
}

await startRelay({
  async startWindow(port) {
    const { worker } = await startDevWindow({ port });
    return worker;
  }
});
endWithMarker();
