import type { PillGlow } from "@/pill/types.ts";
import { GlowMode } from "@gemini-live/protocol/view";

const QUIET_LEVEL = 0.02;
// Levels go to the hundredth, so a burst of them coalesces
const LEVEL_STEPS = 100;

export const REST_GLOW: PillGlow = {
  mode: GlowMode.rest,
  level: 0,
  isUser: false
};

// Gemini's page owns the audio, so there are no levels: breathe instead
export const BREATHING_GLOW: PillGlow = {
  mode: GlowMode.breathe,
  level: 0,
  isUser: false
};

// Follows a voice peak (0..1) from either side; a quiet user leaves Gemini's voice the glow
export function followGlow({ glow, level, isUser }: {
  glow: PillGlow;
  level: number;
  isUser: boolean;
}) {
  const isUserQuiet = isUser && level < QUIET_LEVEL;
  if (isUserQuiet) {
    return glow;
  }

  const clamped = Math.min(Math.max(level, 0), 1);
  return {
    mode: GlowMode.level,
    level: Math.round(clamped * LEVEL_STEPS) / LEVEL_STEPS,
    isUser
  };
}
