import type { PillView } from "@gemini-live/protocol/view";

export type PillLine = PillView["lines"][number];
export type PillLink = PillView["links"][number];
export type PillNamed = PillView["microphones"][number];
export type PillGlow = PillView["glow"];
