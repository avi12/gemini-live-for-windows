import type { PillDisplay } from "@gemini-live/protocol/view";

type DisplayFacts = Pick<PillDisplay, "height" | "id" | "index" | "isPrimary" | "width">;

export function nameDisplay(display: DisplayFacts) {
  return `Display ${display.index}`;
}

export function describeDisplay(display: DisplayFacts) {
  const primary = display.isPrimary ? " (primary)" : "";
  return `${nameDisplay(display)}${primary} · ${display.width}×${display.height}`;
}

export function findSharedDisplayName({
  displays,
  sharedDisplayId
}: {
  displays: readonly DisplayFacts[];
  sharedDisplayId: string | null;
}) {
  const shared = displays.find(display => display.id === sharedDisplayId);
  const isMissing = shared === undefined;
  if (isMissing) {
    return null;
  }

  return nameDisplay(shared);
}
