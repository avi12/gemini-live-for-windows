import type { PillDisplay } from "@gemini-live/protocol/view";

export function nameDisplay(display: PillDisplay) {
  return `Display ${display.index}`;
}

export function describeDisplay(display: PillDisplay) {
  const primary = display.isPrimary ? " (primary)" : "";
  return `${nameDisplay(display)}${primary} · ${display.width}×${display.height}`;
}

export function findSharedDisplayName({ displays, sharedDisplayId }: {
  displays: readonly PillDisplay[];
  sharedDisplayId: string | null;
}) {
  const shared = displays.find(display => display.id === sharedDisplayId);
  const isMissing = shared === undefined;
  if (isMissing) {
    return null;
  }

  return nameDisplay(shared);
}
