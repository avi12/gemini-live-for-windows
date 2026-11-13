import type { AppRelease } from "./app-release.ts";

// Every message the update checker sends its listeners
export const UpdateMessage = { READY_CHANGED: "readyChanged" } as const;

export interface UpdateProtocolMap {
  // A newer release is downloaded and checked, or null once none is
  [UpdateMessage.READY_CHANGED](release: AppRelease | null): void;
}
