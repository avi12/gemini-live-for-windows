import type { GlicHost } from "@/google/glic/glic-host.ts";
import type { HomeHost } from "@/google/home-host.ts";
import type { LiveEventSink } from "@/google/live-event-sink.ts";
import type { Logger } from "@/google/ports.ts";
import type { SharedView } from "@/google/shared-view.ts";

import { createDetourRunner } from "./detour-runner.ts";
import { runLightsDetour } from "./lights-detour.ts";
import { webSearchPrompt } from "./screen-prompt.ts";
import { appName } from "./spoken-intent.ts";
import { runTextDetour } from "./text-turn.ts";

export interface SpeechRecord {
  lastUserUtterance: string;
  lastGeminiLine: string;
  lastGeminiCaptionAt: number;
}

export function createSpeechRecord() {
  return {
    lastUserUtterance: "",
    lastGeminiLine: "",
    lastGeminiCaptionAt: Number.NEGATIVE_INFINITY
  };
}

// The requests Live cannot serve, answered another way: the PC lights through the Home host,
// Google apps and web searches through Gemini's text path, whose links come back as chips.
export function createDetours({
  host,
  home,
  view,
  log,
  now,
  sink,
  speech
}: {
  host: Pick<GlicHost, "start" | "runAction">;
  home: Pick<HomeHost, "setLights">;
  view: SharedView;
  log: Logger;
  now: () => number;
  sink: LiveEventSink;
  speech: SpeechRecord;
}) {
  const runner = createDetourRunner(sink);
  const text = {
    runner,
    host,
    sink,
    log,
    now,
    speech
  };

  return {
    get isRunning() {
      return runner.isRunning;
    },
    get handledUtterance() {
      return runner.handledUtterance;
    },
    runLights: ({ request, isOn }: { request: string; isOn: boolean }) =>
      runLightsDetour({
        request,
        isOn,
        runner,
        home,
        sink,
        log
      }),
    runAppAction: (request: string) =>
      runTextDetour({
        ...text,
        request,
        statusText: `Checking ${appName(request)}…`,
        buildPrompt: async () => request
      }),
    runWebSearch: (request: string) =>
      runTextDetour({
        ...text,
        request,
        statusText: "Searching the web…",
        async buildPrompt() {
          const prompt = webSearchPrompt({
            request,
            screen: await view.read(),
            lastGeminiLine: speech.lastGeminiLine
          });
          log.write(`text turn asks: ${prompt}`);
          return prompt;
        }
      })
  };
}

export type Detours = ReturnType<typeof createDetours>;
