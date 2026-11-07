import { LiveEventKind } from "@/contracts/live-engine.ts";
import type { LiveEvent } from "@/contracts/live-engine.ts";
import { monitorSchema, regionSchema } from "@/contracts/monitor.ts";
import type { ProtocolWithReturn } from "winui-svelte/messaging";
import { z } from "zod";

// The Google engine lives on the UI worker (its WebView2 pages are WinUI controls and need that
// thread); the pill controller on the main thread reaches it over this link. One engine runs at a
// time, but a stale one may still be winding down, so every message names its engine.
export const GoogleMessage = {
  // Main thread to the UI worker
  createEngine: "google/createEngine",
  start: "google/start",
  dispose: "google/dispose",
  setMuted: "google/setMuted",
  share: "google/share",
  setRegion: "google/setRegion",
  useCamera: "google/useCamera",
  listMicrophones: "google/listMicrophones",
  selectMicrophone: "google/selectMicrophone",
  // UI worker to the main thread
  event: "google/event",
  extensionNeeded: "google/extensionNeeded"
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
    kind: z.literal(LiveEventKind.status),
    status: z.string()
  }),
  z.object({
    kind: z.literal(LiveEventKind.transcript),
    text: z.string(),
    isUser: z.boolean()
  }),
  z.object({
    kind: z.literal(LiveEventKind.links),
    links: z.array(
      z.object({
        title: z.string(),
        uri: z.string()
      })
    )
  }),
  z.object({
    kind: z.literal(LiveEventKind.level),
    peak: z.number(),
    isUser: z.boolean()
  }),
  z.object({
    kind: z.literal(LiveEventKind.ended),
    reason: z.string()
  })
]) satisfies z.ZodType<LiveEvent>;

export const engineEventSchema = engineRefSchema.extend({ event: liveEventSchema });
export type EngineEvent = z.infer<typeof engineEventSchema>;

export const extensionNeededSchema = engineRefSchema.extend({ isNeeded: z.boolean() });
export type ExtensionNeeded = z.infer<typeof extensionNeededSchema>;

export interface GoogleProtocol {
  [GoogleMessage.createEngine]: ProtocolWithReturn<CreateEngine, void>;
  // Answered once Gemini is listening, or rejected with why it is not
  [GoogleMessage.start]: ProtocolWithReturn<EngineRef, void>;
  [GoogleMessage.dispose]: ProtocolWithReturn<EngineRef, void>;
  [GoogleMessage.setMuted]: ProtocolWithReturn<SetMuted, void>;
  [GoogleMessage.share]: ProtocolWithReturn<Share, void>;
  [GoogleMessage.setRegion]: ProtocolWithReturn<SetRegion, void>;
  // Whether the camera is now the source
  [GoogleMessage.useCamera]: ProtocolWithReturn<UseCamera, boolean>;
  [GoogleMessage.listMicrophones]: ProtocolWithReturn<void, Microphones>;
  [GoogleMessage.selectMicrophone]: ProtocolWithReturn<SelectMicrophone, void>;
  [GoogleMessage.event]: ProtocolWithReturn<EngineEvent, void>;
  [GoogleMessage.extensionNeeded]: ProtocolWithReturn<ExtensionNeeded, void>;
}
