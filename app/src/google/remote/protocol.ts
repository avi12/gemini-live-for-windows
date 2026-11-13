import { regionSchema } from "@gemini-live/protocol/view";
import type { ProtocolWithReturn } from "winui-svelte/messaging";
import { z } from "zod";

import { LiveEventKind } from "@/contracts/live-engine.ts";
import type { LiveEvent } from "@/contracts/live-engine.ts";
import { monitorSchema } from "@/contracts/monitor.ts";

// The Google engine lives on the UI worker (its WebView2 pages are WinUI controls and need that
// thread); the pill controller on the main thread reaches it over this link. One engine runs at a
// time, but a stale one may still be winding down, so every message names its engine.
export const GoogleMessage = {
  // Main thread to the UI worker
  CREATE_ENGINE: "google/createEngine",
  START: "google/start",
  DISPOSE: "google/dispose",
  SET_MUTED: "google/setMuted",
  SHARE: "google/share",
  SET_REGION: "google/setRegion",
  USE_CAMERA: "google/useCamera",
  LIST_MICROPHONES: "google/listMicrophones",
  SELECT_MICROPHONE: "google/selectMicrophone",
  // UI worker to the main thread
  EVENT: "google/event",
  EXTENSION_NEEDED: "google/extensionNeeded"
} as const;

export const engineRefSchema = z.object({ engineId: z.number().int() });
export type EngineRef = z.infer<typeof engineRefSchema>;

export const createEngineSchema = engineRefSchema.extend({ monitor: monitorSchema });
export type CreateEngine = z.infer<typeof createEngineSchema>;

export const setMutedSchema = engineRefSchema.extend({ isMuted: z.boolean() });
export type SetMuted = z.infer<typeof setMutedSchema>;

export const shareSchema = engineRefSchema.extend({ monitor: monitorSchema });
export type Share = z.infer<typeof shareSchema>;

export const setRegionSchema = engineRefSchema.extend({ region: regionSchema.nullable() });
export type SetRegion = z.infer<typeof setRegionSchema>;

export const useCameraSchema = engineRefSchema.extend({ isOn: z.boolean() });
export type UseCamera = z.infer<typeof useCameraSchema>;

export const selectMicrophoneSchema = z.object({ id: z.string().nullable() });
export type SelectMicrophone = z.infer<typeof selectMicrophoneSchema>;

export const microphonesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string()
  })
);
export type Microphones = z.infer<typeof microphonesSchema>;

export const liveEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(LiveEventKind.STATUS),
    status: z.string()
  }),
  z.object({
    kind: z.literal(LiveEventKind.TRANSCRIPT),
    text: z.string(),
    isUser: z.boolean()
  }),
  z.object({
    kind: z.literal(LiveEventKind.LINKS),
    links: z.array(
      z.object({
        title: z.string(),
        uri: z.string()
      })
    )
  }),
  z.object({
    kind: z.literal(LiveEventKind.LEVEL),
    peak: z.number(),
    isUser: z.boolean()
  }),
  z.object({
    kind: z.literal(LiveEventKind.ENDED),
    reason: z.string()
  })
]) satisfies z.ZodType<LiveEvent>;

export const engineEventSchema = engineRefSchema.extend({ event: liveEventSchema });
export type EngineEvent = z.infer<typeof engineEventSchema>;

export const extensionNeededSchema = engineRefSchema.extend({ isNeeded: z.boolean() });
export type ExtensionNeeded = z.infer<typeof extensionNeededSchema>;

export interface GoogleProtocol {
  [GoogleMessage.CREATE_ENGINE]: ProtocolWithReturn<CreateEngine, void>;
  // Answered once Gemini is listening, or rejected with why it is not
  [GoogleMessage.START]: ProtocolWithReturn<EngineRef, void>;
  [GoogleMessage.DISPOSE]: ProtocolWithReturn<EngineRef, void>;
  [GoogleMessage.SET_MUTED]: ProtocolWithReturn<SetMuted, void>;
  [GoogleMessage.SHARE]: ProtocolWithReturn<Share, void>;
  [GoogleMessage.SET_REGION]: ProtocolWithReturn<SetRegion, void>;
  // Whether the camera is now the source
  [GoogleMessage.USE_CAMERA]: ProtocolWithReturn<UseCamera, boolean>;
  [GoogleMessage.LIST_MICROPHONES]: ProtocolWithReturn<void, Microphones>;
  [GoogleMessage.SELECT_MICROPHONE]: ProtocolWithReturn<SelectMicrophone, void>;
  [GoogleMessage.EVENT]: ProtocolWithReturn<EngineEvent, void>;
  [GoogleMessage.EXTENSION_NEEDED]: ProtocolWithReturn<ExtensionNeeded, void>;
}
