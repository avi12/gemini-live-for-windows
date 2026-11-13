import { PillActionKind } from "@gemini-live/protocol/view";
import type { PillView } from "@gemini-live/protocol/view";

const CHECK_TEXT = "Check for updates";

// The gear menu's update entry: restart into a ready release, or look again
export function describeUpdateEntry(update: NonNullable<PillView["update"]>) {
  const isNothingReady = update.readyVersion === null;
  if (isNothingReady) {
    return {
      kind: PillActionKind.CHECK_FOR_UPDATES,
      text: CHECK_TEXT
    };
  }

  return {
    kind: PillActionKind.UPDATE,
    text: `Restart to update to ${update.readyVersion}`
  };
}
