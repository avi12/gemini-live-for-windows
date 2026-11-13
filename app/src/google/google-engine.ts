import { type LiveEvent, LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";

import { createDetours, createSpeechRecord } from "./detours/detours.ts";
import { createIntentTriggers } from "./detours/intent-triggers.ts";
import { createEmitter } from "./emitter.ts";
import { type GlicHostEvent, GlicHostEventKind } from "./glic/glic-events.ts";
import type { GlicHost } from "./glic/glic-host.ts";
import { createLiveEngine } from "./google-live-engine.ts";
import type { HomeHost } from "./home-host.ts";
import { createLiveEventSink, type LiveEventSink } from "./live-event-sink.ts";
import type { Logger } from "./ports.ts";
import type { SharedView } from "./shared-view.ts";

function routeHostEvent({
  event,
  sink,
  onCaption,
  onExtensionNeeded
}: {
  event: GlicHostEvent;
  sink: LiveEventSink;
  onCaption: (caption: Extract<GlicHostEvent, { kind: typeof GlicHostEventKind.CAPTION }>) => void;
  onExtensionNeeded: (isNeeded: boolean) => void;
}) {
  const isState = event.kind === GlicHostEventKind.STATE;
  if (isState) {
    sink.status(event.isListening ? LiveStatus.LISTENING : LiveStatus.RESUMING);
    return;
  }

  const isCaption = event.kind === GlicHostEventKind.CAPTION;
  if (isCaption) {
    onCaption(event);
    return;
  }

  const isNotice = event.kind === GlicHostEventKind.NOTICE;
  if (isNotice) {
    sink.status(event.notice);
    return;
  }

  const isFailure = event.kind === GlicHostEventKind.FAILED;
  if (isFailure) {
    sink.emit({
      kind: LiveEventKind.ENDED,
      reason: event.message
    });
    return;
  }

  onExtensionNeeded(event.isNeeded);
}

// The Google-account engine: one Live session on the long-lived glic host. Gemini's own client
// does the audio, so there are no levels to show; captions arrive as whole utterances.
export function createGoogleEngine({
  host,
  home,
  view,
  log,
  now
}: {
  host: Pick<GlicHost, "onEvent" | "start" | "stop" | "setMuted" | "runAction">;
  home: Pick<HomeHost, "setLights">;
  view: SharedView;
  log: Logger;
  now: () => number;
}) {
  const events = createEmitter<LiveEvent>();
  const extensionNeeded = createEmitter<boolean>();
  const sink = createLiveEventSink(events.emit);
  const speech = createSpeechRecord();
  const triggers = createIntentTriggers({
    detours: createDetours({
      host,
      home,
      view,
      log,
      now,
      sink,
      speech
    }),
    speech,
    sink,
    now
  });
  const unsubscribeHost = host.onEvent(event =>
    routeHostEvent({
      event,
      sink,
      onCaption: triggers.onCaption,
      onExtensionNeeded: extensionNeeded.emit
    })
  );
  return createLiveEngine({
    host,
    view,
    events,
    extensionNeeded,
    dispose() {
      triggers.dispose();
      unsubscribeHost();
    }
  });
}

export type GoogleEngine = ReturnType<typeof createGoogleEngine>;
