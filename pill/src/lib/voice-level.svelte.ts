import { GlowMode } from "@gemini-live/protocol/view";

import { view } from "@/lib/view.svelte.ts";

const QUIET_LEVEL = 0.02;

const held = $state({
  level: 0,
  isUser: false
});

export const voice = {
  get level() {
    const isFollowing = view.glow.mode === GlowMode.LEVEL;
    if (!isFollowing) {
      return 0;
    }

    return held.level;
  },
  get isUser() {
    return held.isUser;
  }
};

export function holdVoiceLevel() {
  $effect(() => {
    const { mode, level, isUser } = view.glow;
    const isFollowing = mode === GlowMode.LEVEL;
    const isUserQuiet = isUser && level < QUIET_LEVEL;
    const isSkipped = !isFollowing || isUserQuiet;
    if (isSkipped) {
      return;
    }

    held.level = level;
    held.isUser = isUser;
  });
}
