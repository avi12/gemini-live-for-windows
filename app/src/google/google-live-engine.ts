import { EngineKind, type LiveEngine, type LiveEvent } from "@/contracts/live-engine.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";

import type { createEmitter } from "./emitter.ts";
import type { GlicHost } from "./glic/glic-host.ts";
import type { SharedView } from "./shared-view.ts";

// The LiveEngine contract over the glic host and the shared view
export function createLiveEngine({
  host,
  view,
  events,
  extensionNeeded,
  dispose
}: {
  host: Pick<GlicHost, "start" | "stop" | "setMuted">;
  view: SharedView;
  events: ReturnType<typeof createEmitter<LiveEvent>>;
  extensionNeeded: ReturnType<typeof createEmitter<boolean>>;
  dispose: () => void;
}) {
  let isMuted = false;

  const engine: LiveEngine = {
    kind: EngineKind.GOOGLE,
    reportsLevels: false,
    get monitor() {
      return view.monitor;
    },
    get isMuted() {
      return isMuted;
    },
    set isMuted(isNowMuted: boolean) {
      isMuted = isNowMuted;
      void host.setMuted(isNowMuted);
    },
    get region() {
      return view.region;
    },
    set region(value: Region | undefined) {
      view.region = value;
    },
    get isCameraShared() {
      return view.isUsingCamera;
    },
    onEvent: events.subscribe,
    onExtensionNeeded: extensionNeeded.subscribe,
    useCamera: isOn => view.useCamera(isOn),
    // No timeout here: the page reports its own start failure, and waiting for the browser's
    // Google session (extension not yet connected, user signing in) can legitimately take a while
    start: () => host.start(),
    share(monitor: Monitor) {
      view.monitor = monitor;
      view.region = undefined;
    },
    async dispose() {
      dispose();
      await host.stop();
    }
  };

  return engine;
}
