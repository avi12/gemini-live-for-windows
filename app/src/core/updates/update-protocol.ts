import type { AppRelease } from "./app-release.ts";

// Every message the update checker sends its listeners
export const UpdateMessage = { readyChanged: "readyChanged" } as const;

export interface UpdateProtocolMap {
  // A newer release is downloaded and checked, or null once none is
  [UpdateMessage.readyChanged](release: AppRelease | null): void;
}
