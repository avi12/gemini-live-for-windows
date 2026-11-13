import { LiveStatus } from "@/contracts/live-engine.ts";
import type { HomeHost } from "@/google/home-host.ts";
import type { LiveEventSink } from "@/google/live-event-sink.ts";
import type { Logger } from "@/google/ports.ts";
import { errorMessage } from "@/lib/error-message.ts";

import type { createDetourRunner } from "./detour-runner.ts";

const COULD_NOT_REACH_LIGHTS = "I had trouble reaching the lights.";

// The PC lights live in Google Home, which Gemini's text path can't reach. Runs off the Live page,
// so Live keeps listening throughout.
export function runLightsDetour({
  request,
  isOn,
  runner,
  home,
  sink,
  log
}: {
  request: string;
  isOn: boolean;
  runner: ReturnType<typeof createDetourRunner>;
  home: Pick<HomeHost, "setLights">;
  sink: LiveEventSink;
  log: Logger;
}) {
  return runner.run({
    request,
    statusText: `Turning the lights ${isOn ? "on" : "off"}…`,
    async detour() {
      try {
        sink.transcript({
          text: await home.setLights(isOn),
          isUser: false
        });
      } catch (error) {
        log.write(`lights action failed: ${errorMessage(error)}`);
        sink.transcript({
          text: COULD_NOT_REACH_LIGHTS,
          isUser: false
        });
      } finally {
        sink.status(LiveStatus.LISTENING);
      }
    }
  });
}
