import { GoogleMessage } from "./protocol.ts";
import type { GoogleProtocol, Microphones } from "./protocol.ts";
import {
  createEngineSchema,
  engineRefSchema,
  liveEventSchema,
  selectMicrophoneSchema,
  setMutedSchema,
  setRegionSchema,
  shareSchema,
  useCameraSchema
} from "./protocol.ts";
import type { LiveEngine } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import type { Logger } from "@/google/ports.ts";
import { unwrapParsed } from "@/lib/unwrap-parsed.ts";
import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

// What the server needs of the Google services: createGoogleServices satisfies it
export interface GoogleHostServices {
  createEngine(monitor: Monitor): LiveEngine;
  setMicrophone(id: string | null): unknown;
  listMicrophones(): Promise<ReadonlyArray<{
    id: string;
    label: string;
  }>>;
}

// The UI worker's end of the Google link: runs the engines the controller asks for and sends back
// what they raise
export function serveGoogle({ transport, services, log }: {
  transport: Transport;
  services: GoogleHostServices;
  log: Logger;
}) {
  const messaging = defineMessaging<GoogleProtocol>({
    transport,
    onError: error => log.write(`google: ${error.message}`)
  });
  const engines = new Map<number, LiveEngine>();
  serveEngineLifecycle({
    messaging,
    services,
    engines
  });
  serveEngineControls({
    messaging,
    engines
  });
  serveMicrophones({
    messaging,
    services
  });

  return () => messaging.close();
}

type Messaging = ReturnType<typeof defineMessaging<GoogleProtocol>>;

function find({ engines, data }: {
  engines: Map<number, LiveEngine>;
  data: unknown;
}) {
  const { engineId } = unwrapParsed(engineRefSchema.safeParse(data));
  const engine = engines.get(engineId);
  if (!engine) {
    throw new Error(`There is no engine ${engineId}`);
  }

  return {
    engineId,
    engine
  };
}

function serveEngineLifecycle({ messaging, services, engines }: {
  messaging: Messaging;
  services: GoogleHostServices;
  engines: Map<number, LiveEngine>;
}) {
  messaging.onMessage(GoogleMessage.createEngine, message => {
    const { engineId, monitor } = unwrapParsed(createEngineSchema.safeParse(message.data));
    const engine = services.createEngine(monitor);
    engines.set(engineId, engine);
    engine.onEvent(event => messaging.notify(GoogleMessage.event, {
      engineId,
      event: liveEventSchema.parse(event)
    }));
    engine.onExtensionNeeded(isNeeded => messaging.notify(GoogleMessage.extensionNeeded, {
      engineId,
      isNeeded
    }));
  });
  messaging.onMessage(GoogleMessage.dispose, async message => {
    const { engineId, engine } = find({
      engines,
      data: message.data
    });
    engines.delete(engineId);
    await engine.dispose();
  });
}

function serveEngineControls({ messaging, engines }: {
  messaging: Messaging;
  engines: Map<number, LiveEngine>;
}) {
  function engineOf(data: unknown) {
    return find({
      engines,
      data
    }).engine;
  }

  messaging.onMessage(GoogleMessage.start, message => engineOf(message.data).start());
  messaging.onMessage(GoogleMessage.setMuted, message => {
    const { isMuted } = unwrapParsed(setMutedSchema.safeParse(message.data));
    engineOf(message.data).isMuted = isMuted;
  });
  messaging.onMessage(GoogleMessage.share, message => {
    const { monitor } = unwrapParsed(shareSchema.safeParse(message.data));
    engineOf(message.data).share(monitor);
  });
  messaging.onMessage(GoogleMessage.setRegion, message => {
    const { region } = unwrapParsed(setRegionSchema.safeParse(message.data));
    engineOf(message.data).region = region ?? undefined;
  });
  messaging.onMessage(GoogleMessage.useCamera, message => {
    const { isOn } = unwrapParsed(useCameraSchema.safeParse(message.data));
    return engineOf(message.data).useCamera(isOn);
  });
}

function serveMicrophones({ messaging, services }: {
  messaging: Messaging;
  services: GoogleHostServices;
}) {
  messaging.onMessage(GoogleMessage.selectMicrophone, message => {
    const { id } = unwrapParsed(selectMicrophoneSchema.safeParse(message.data));
    services.setMicrophone(id);
  });
  messaging.onMessage(GoogleMessage.listMicrophones, async () => {
    const listed = await services.listMicrophones();
    const microphones: Microphones = listed.map(({ id, label }) => ({
      id,
      name: label
    }));
    return microphones;
  });
}
