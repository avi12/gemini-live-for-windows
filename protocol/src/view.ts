import { z } from "zod";

// The pill's state, owned by the C# app and sent to the Svelte window as a `view` snapshot, then
// `patch` lines (winui-svelte/state). This file is the single source of truth: the window reads
// the inferred types, the relay validates with the schemas, and src/GeminiLive/Pill/PillProtocol.cs
// mirrors the names and shapes one for one.

export const GlowMode = {
  rest: "rest",
  breathe: "breathe",
  level: "level"
} as const;

export const EngineKind = {
  google: "Google",
  apiKey: "ApiKey"
} as const;

export type EngineKind = (typeof EngineKind)[keyof typeof EngineKind];

const lineSchema = z.object({
  id: z.string(),
  text: z.string(),
  isUser: z.boolean(),
  isNote: z.boolean()
});

const linkSchema = z.object({
  id: z.string(),
  title: z.string(),
  uri: z.url(),
  address: z.string(),
  isSearch: z.boolean()
});

const namedSchema = z.object({
  id: z.string(),
  name: z.string()
});

const updateSchema = z.object({
  text: z.string(),
  isAvailable: z.boolean(),
  isAutoUpdateOn: z.boolean()
});

const glowSchema = z.object({
  mode: z.enum(GlowMode),
  level: z.number().min(0).max(1),
  isUser: z.boolean()
});

export const pillViewSchema = z.object({
  status: z.string(),
  statusDetail: z.string(),
  isMuted: z.boolean(),
  lines: z.array(lineSchema),
  links: z.array(linkSchema),
  displays: z.array(namedSchema),
  sharedDisplay: z.string().nullable(),
  sharedDisplayName: z.string().nullable(),
  isExtensionNeeded: z.boolean(),
  isExtensionStepsShown: z.boolean(),
  isKeyPromptShown: z.boolean(),
  engine: z.enum(EngineKind),
  microphones: z.array(namedSchema),
  microphoneId: z.string().nullable(),
  isCameraAvailable: z.boolean(),
  isCameraShared: z.boolean(),
  update: updateSchema.nullable(),
  glow: glowSchema,
  isShown: z.boolean(),
  isFocusable: z.boolean()
});

export type PillView = z.infer<typeof pillViewSchema>;

export const PillActionKind = {
  mute: "mute",
  end: "end",
  share: "share",
  setMicrophone: "setMicrophone",
  refreshMicrophones: "refreshMicrophones",
  setCamera: "setCamera",
  setEngine: "setEngine",
  askForKey: "askForKey",
  submitKey: "submitKey",
  cancelKey: "cancelKey",
  connectExtension: "connectExtension",
  openLink: "openLink",
  update: "update",
  checkForUpdates: "checkForUpdates",
  setAutoUpdate: "setAutoUpdate",
  quit: "quit",
  setFocusable: "setFocusable",
  moveBy: "moveBy"
} as const;

// The actions back to C#, one variant per kind. C# answers each with `null`, or an error text.
export const pillActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(PillActionKind.mute) }),
  z.object({ kind: z.literal(PillActionKind.end) }),
  z.object({
    kind: z.literal(PillActionKind.share),
    displayId: z.string()
  }),
  z.object({
    kind: z.literal(PillActionKind.setMicrophone),
    microphoneId: z.string().nullable()
  }),
  z.object({ kind: z.literal(PillActionKind.refreshMicrophones) }),
  z.object({
    kind: z.literal(PillActionKind.setCamera),
    isOn: z.boolean()
  }),
  z.object({
    kind: z.literal(PillActionKind.setEngine),
    engine: z.enum(EngineKind)
  }),
  z.object({ kind: z.literal(PillActionKind.askForKey) }),
  z.object({
    kind: z.literal(PillActionKind.submitKey),
    key: z.string().trim().min(1)
  }),
  z.object({ kind: z.literal(PillActionKind.cancelKey) }),
  z.object({ kind: z.literal(PillActionKind.connectExtension) }),
  z.object({
    kind: z.literal(PillActionKind.openLink),
    uri: z.url()
  }),
  z.object({ kind: z.literal(PillActionKind.update) }),
  z.object({ kind: z.literal(PillActionKind.checkForUpdates) }),
  z.object({
    kind: z.literal(PillActionKind.setAutoUpdate),
    isOn: z.boolean()
  }),
  z.object({ kind: z.literal(PillActionKind.quit) }),
  z.object({
    kind: z.literal(PillActionKind.setFocusable),
    isFocusable: z.boolean()
  }),
  z.object({
    kind: z.literal(PillActionKind.moveBy),
    dx: z.number(),
    dy: z.number()
  })
]);

export type PillAction = z.infer<typeof pillActionSchema>;

// The name of the view in `hostState({ name })` and in the snapshot frame
export const VIEW_NAME = "view";

export const WindowMessage = {
  bringToFront: "bringToFront",
  moveBy: "moveBy"
} as const;

export const moveByDataSchema = z.object({
  deltaX: z.number().int(),
  deltaY: z.number().int()
});

export type MoveByData = z.infer<typeof moveByDataSchema>;

export interface WindowProtocol {
  [WindowMessage.bringToFront](): void;
  [WindowMessage.moveBy](data: MoveByData): void;
}
