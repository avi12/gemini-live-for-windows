import type { Settings } from "@/core/settings/settings-file.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { SearchAction } from "@/overlays/protocol.ts";

// The image search engine the circle offers first: the one the user searched with last, kept in
// the settings file. A failed save is logged and the choice still holds until the app exits
export function createSearchChoice({ settings, save, log }: {
  settings: Pick<Settings, "circleSearch">;
  save: () => Promise<void>;
  log: (message: string) => void;
}) {
  function remember(action: SearchAction) {
    const isChanged = settings.circleSearch !== action;
    if (!isChanged) {
      return;
    }

    settings.circleSearch = action;
    save().catch((error: unknown) => log(`circle: saving the search engine failed: ${errorMessage(error)}`));
  }

  return {
    current: () => settings.circleSearch,
    remember
  };
}

export type SearchChoice = ReturnType<typeof createSearchChoice>;
