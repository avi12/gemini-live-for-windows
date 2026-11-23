import { z } from "zod";

// The pill's state, owned by the C# app and sent to the Svelte window as a `view` snapshot, then
// `patch` lines (winui-svelte/state). This file is the single source of truth: the window reads
// the inferred types, the relay validates with the schemas, and src/GeminiLive/Pill/PillProtocol.cs
// mirrors the names and shapes one for one.

export const GlowMode = {
  REST: "rest",
  BREATHE: "breathe",
  LEVEL: "level"
} as const;

export const EngineKind = {
  GOOGLE: "Google",
  API_KEY: "ApiKey"
} as const;

export type EngineKind = (typeof EngineKind)[keyof typeof EngineKind];

export const LiveStatus = {
  CONNECTING: "Connecting…",
  LISTENING: "Listening",
  RECONNECTING: "Reconnecting…",
  RESUMING: "Resuming…",
  STOPPED: "Gemini Live stopped",
  NEEDS_API_KEY: "Setup: Gemini needs an API key"
} as const;

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
  // A search results page wears the search icon; any other page its site's icon, from `faviconUri`
  isSearch: z.boolean(),
  faviconUri: z.url()
});

const namedSchema = z.object({
  id: z.string(),
  name: z.string()
});

export const DEFAULT_REFRESH_RATE_HERTZ = 60;
const LARGEST_UNKNOWN_REFRESH_RATE_HERTZ = 1;

export const refreshRateSchema = z.number().int().positive();

export function knownRefreshRate(reportedHertz: number) {
  const isUnknown = !Number.isFinite(reportedHertz) || reportedHertz <= LARGEST_UNKNOWN_REFRESH_RATE_HERTZ;
  return isUnknown ? DEFAULT_REFRESH_RATE_HERTZ : Math.round(reportedHertz);
}

export const regionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

const displaySchema = regionSchema.extend({
  id: z.string(),
  index: z.number().int().positive(),
  isPrimary: z.boolean(),
  refreshRateHertz: refreshRateSchema
});

export type PillDisplay = z.infer<typeof displaySchema>;

const updateSchema = z.object({
  readyVersion: z.string().nullable(),
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
  displays: z.array(displaySchema),
  pillDisplay: z.string().nullable(),
  sharedDisplay: z.string().nullable(),
  isExtensionNeeded: z.boolean(),
  isExtensionStepsShown: z.boolean(),
  isKeyPromptShown: z.boolean(),
  engine: z.enum(EngineKind),
  microphones: z.array(namedSchema),
  microphoneId: z.string().nullable(),
  isCameraShared: z.boolean(),
  update: updateSchema.nullable(),
  glow: glowSchema,
  isShown: z.boolean(),
  isFocusable: z.boolean()
});

export type PillView = z.infer<typeof pillViewSchema>;
export type PillLine = PillView["lines"][number];
export type PillLink = PillView["links"][number];

// A link that has no title of its own (Gemini gave only its URL) is titled by its short address
export function isUntitledLink(link: Pick<PillLink, "title" | "address">) {
  return link.title === link.address;
}
export type PillNamed = PillView["microphones"][number];
export type PillGlow = PillView["glow"];
// A rectangle in physical pixels
export type PillRegion = z.infer<typeof regionSchema>;
// Shows only `region` of a window and takes clicks only there; null, all of it
export type WindowClipper = (options: { hwnd: bigint; region: PillRegion | null }) => void;

export function previewFramesPerSecond({ displays, pillDisplay }: Pick<PillView, "displays" | "pillDisplay">) {
  const own = displays.find(display => display.id === pillDisplay);
  return own?.refreshRateHertz ?? DEFAULT_REFRESH_RATE_HERTZ;
}

export const PillActionKind = {
  MUTE: "mute",
  END: "end",
  SHARE: "share",
  SET_MICROPHONE: "setMicrophone",
  REFRESH_MICROPHONES: "refreshMicrophones",
  SET_CAMERA: "setCamera",
  SET_ENGINE: "setEngine",
  ASK_FOR_KEY: "askForKey",
  SUBMIT_KEY: "submitKey",
  CANCEL_KEY: "cancelKey",
  CONNECT_EXTENSION: "connectExtension",
  OPEN_LINK: "openLink",
  COPY_TEXT: "copyText",
  UPDATE: "update",
  CHECK_FOR_UPDATES: "checkForUpdates",
  SET_AUTO_UPDATE: "setAutoUpdate",
  QUIT: "quit",
  SET_FOCUSABLE: "setFocusable",
  MOVE_BY: "moveBy",
  CLIP_TO: "clipTo",
  RESTORE_PREVIOUS_APP: "restorePreviousApp"
} as const;

// The actions back to C#, one variant per kind. C# answers each with `null`, or an error text.
export const pillActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(PillActionKind.MUTE) }),
  z.object({ kind: z.literal(PillActionKind.END) }),
  z.object({
    kind: z.literal(PillActionKind.SHARE),
    displayId: z.string()
  }),
  z.object({
    kind: z.literal(PillActionKind.SET_MICROPHONE),
    microphoneId: z.string().nullable()
  }),
  z.object({ kind: z.literal(PillActionKind.REFRESH_MICROPHONES) }),
  z.object({
    kind: z.literal(PillActionKind.SET_CAMERA),
    isOn: z.boolean()
  }),
  z.object({
    kind: z.literal(PillActionKind.SET_ENGINE),
    engine: z.enum(EngineKind)
  }),
  z.object({ kind: z.literal(PillActionKind.ASK_FOR_KEY) }),
  z.object({
    kind: z.literal(PillActionKind.SUBMIT_KEY),
    key: z.string().trim().min(1)
  }),
  z.object({ kind: z.literal(PillActionKind.CANCEL_KEY) }),
  z.object({ kind: z.literal(PillActionKind.CONNECT_EXTENSION) }),
  z.object({
    kind: z.literal(PillActionKind.OPEN_LINK),
    uri: z.url()
  }),
  z.object({
    kind: z.literal(PillActionKind.COPY_TEXT),
    text: z.string()
  }),
  z.object({ kind: z.literal(PillActionKind.UPDATE) }),
  z.object({ kind: z.literal(PillActionKind.CHECK_FOR_UPDATES) }),
  z.object({
    kind: z.literal(PillActionKind.SET_AUTO_UPDATE),
    isOn: z.boolean()
  }),
  z.object({ kind: z.literal(PillActionKind.QUIT) }),
  z.object({
    kind: z.literal(PillActionKind.SET_FOCUSABLE),
    isFocusable: z.boolean()
  }),
  z.object({
    kind: z.literal(PillActionKind.MOVE_BY),
    dx: z.number(),
    dy: z.number()
  }),
  // The part of the window that is shown and takes clicks, in physical pixels from its top-left
  // corner; null is the whole window. The folded orb clips the window to itself, so the window never
  // has to resize (a resize blanks it for a frame) and the space beside the orb takes no clicks.
  z.object({
    kind: z.literal(PillActionKind.CLIP_TO),
    region: regionSchema.nullable()
  })
]);

export type PillAction = z.infer<typeof pillActionSchema>;

// The name of the view in `hostState({ name })` and in the snapshot frame
export const VIEW_NAME = "view";

export const WindowMessage = {
  BRING_TO_FRONT: "bringToFront",
  MOVE_BY: "moveBy",
  CLIP_TO: "clipTo",
  RESTORE_PREVIOUS_APP: "restorePreviousApp"
} as const;

export const moveByDataSchema = z.object({
  deltaX: z.number().int(),
  deltaY: z.number().int()
});

export type MoveByData = z.infer<typeof moveByDataSchema>;

export const clipToDataSchema = z.object({ region: regionSchema.nullable() });

export type ClipToData = z.infer<typeof clipToDataSchema>;

export interface WindowProtocol {
  [WindowMessage.BRING_TO_FRONT](): void;
  [WindowMessage.MOVE_BY](data: MoveByData): void;
  [WindowMessage.CLIP_TO](data: ClipToData): void;
  [WindowMessage.RESTORE_PREVIOUS_APP](): void;
}
