import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

import { EngineKind, LiveEventKind } from "@/contracts/live-engine.ts";
import type { LiveEngine, LiveEvent } from "@/contracts/live-engine.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";
import { createEmitter } from "@/google/emitter.ts";
import type { Logger } from "@/google/ports.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { unwrapParsed } from "@/lib/unwrap-parsed.ts";

import { engineEventSchema, extensionNeededSchema, GoogleMessage, microphonesSchema } from "./protocol.ts";
import type { GoogleProtocol } from "./protocol.ts";

interface Route {
  readonly events: ReturnType<typeof createEmitter<LiveEvent>>;
  readonly extensionNeeded: ReturnType<typeof createEmitter<boolean>>;
}

type Messaging = ReturnType<typeof defineMessaging<GoogleProtocol>>;

interface EngineState {
  monitor: Monitor;
  region: Region | undefined;
  isMuted: boolean;
  isCameraShared: boolean;
}

async function useRemoteCamera({
  messaging,
  engineId,
  state,
  isOn
}: {
  messaging: Messaging;
  engineId: number;
  state: EngineState;
  isOn: boolean;
}) {
  const isAchieved = await messaging.sendMessage(GoogleMessage.USE_CAMERA, {
    engineId,
    isOn
  });
  if (isAchieved) {
    state.isCameraShared = isOn;
  }

  return isAchieved;
}

async function disposeRemote({
  messaging,
  engineId,
  onDisposed
}: {
  messaging: Messaging;
  engineId: number;
  onDisposed: () => void;
}) {
  try {
    await messaging.sendMessage(GoogleMessage.DISPOSE, { engineId });
  } finally {
    onDisposed();
  }
}

function initialState(monitor: Monitor) {
  const state: EngineState = {
    monitor,
    region: undefined,
    isMuted: false,
    isCameraShared: false
  };
  return state;
}

interface EngineLink {
  messaging: Messaging;
  engineId: number;
  route: Route;
  monitor: Monitor;
  onDisposed: () => void;
}

function remoteEngine({ messaging, engineId, route, monitor, onDisposed }: EngineLink) {
  const state = initialState(monitor);

  const engine: LiveEngine = {
    kind: EngineKind.GOOGLE,
    reportsLevels: false,
    get monitor() {
      return state.monitor;
    },
    get isMuted() {
      return state.isMuted;
    },
    set isMuted(isNowMuted: boolean) {
      state.isMuted = isNowMuted;
      messaging.notify(GoogleMessage.SET_MUTED, {
        engineId,
        isMuted: isNowMuted
      });
    },
    get region() {
      return state.region;
    },
    set region(region: Region | undefined) {
      state.region = region;
      messaging.notify(GoogleMessage.SET_REGION, {
        engineId,
        region: region ?? null
      });
    },
    get isCameraShared() {
      return state.isCameraShared;
    },
    onEvent: route.events.subscribe,
    onExtensionNeeded: route.extensionNeeded.subscribe,
    useCamera: isOn =>
      useRemoteCamera({
        messaging,
        engineId,
        state,
        isOn
      }),
    start: () => messaging.sendMessage(GoogleMessage.START, { engineId }),
    share(next: Monitor) {
      state.monitor = next;
      state.region = undefined;
      messaging.notify(GoogleMessage.SHARE, {
        engineId,
        monitor: next
      });
    },
    dispose: () =>
      disposeRemote({
        messaging,
        engineId,
        onDisposed
      })
  };
  return engine;
}

// The main thread's end of the Google link: engines that look like any other LiveEngine to the
// pill controller while the real ones run on the UI worker. What the controller reads at once
// (the shared display, the region, mute, the camera) is kept here; every change is sent over.
export function connectGoogle({ transport, log }: { transport: Transport; log: Logger }) {
  const messaging = defineMessaging<GoogleProtocol>({
    transport,
    onError: error => log.write(`google: ${error.message}`)
  });
  const routes = new Map<number, Route>();
  let lastEngineId = 0;

  messaging.onMessage(GoogleMessage.EVENT, message => {
    const { engineId, event } = unwrapParsed(engineEventSchema.safeParse(message.data));
    routes.get(engineId)?.events.emit(event);
  });
  messaging.onMessage(GoogleMessage.EXTENSION_NEEDED, message => {
    const { engineId, isNeeded } = unwrapParsed(extensionNeededSchema.safeParse(message.data));
    routes.get(engineId)?.extensionNeeded.emit(isNeeded);
  });

  function createEngine(monitor: Monitor) {
    lastEngineId += 1;
    const engineId = lastEngineId;
    const route: Route = {
      events: createEmitter<LiveEvent>(),
      extensionNeeded: createEmitter<boolean>()
    };
    routes.set(engineId, route);

    messaging
      .sendMessage(GoogleMessage.CREATE_ENGINE, {
        engineId,
        monitor
      })
      .catch((error: unknown) =>
        route.events.emit({
          kind: LiveEventKind.ENDED,
          reason: errorMessage(error)
        })
      );

    return remoteEngine({
      messaging,
      engineId,
      route,
      monitor,
      onDisposed: () => routes.delete(engineId)
    });
  }

  return {
    createEngine,
    microphones: {
      async list() {
        const listed = await messaging.sendMessage(GoogleMessage.LIST_MICROPHONES);
        return unwrapParsed(microphonesSchema.safeParse(listed));
      },
      select: (id: string | null) => messaging.notify(GoogleMessage.SELECT_MICROPHONE, { id })
    },
    close: () => messaging.close()
  };
}
