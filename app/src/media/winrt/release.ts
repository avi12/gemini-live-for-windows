import { nativeOf } from "./native-object.ts";

// Drops a WinRT object's reference now instead of whenever the garbage collector gets to it. The
// collector knows nothing of native memory, so a 33 MB bitmap or an encoder holding one would
// otherwise pile up by the hundred between collections.
export function releaseNative(projected: object) {
  nativeOf(projected)?.release();
}
