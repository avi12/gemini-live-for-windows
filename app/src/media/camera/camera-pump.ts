import type { Clock } from "@/media/clock.ts";
import type { EncodedFrame } from "@/media/screen/jpeg-encoder.ts";

// About two stills a second: the pull asks for roughly one, so the slot is at most half a second stale,
// and the encode stays cheap. FrameArrived cannot be used (dynwinrt delivers no native-thread
// callbacks), so the latest frame is pulled by polling instead.
export const CAMERA_POLL_MILLISECONDS = 500;

// One frame off the reader, still the camera's: encode it, then release it
export interface CameraFrame {
  encode(): Promise<EncodedFrame>;
  release(): void;
}

export interface CameraFrameSource {
  acquireLatest(): CameraFrame | undefined;
}

// Polls the reader into a single latest-JPEG slot, one encode at a time, so `latest()` is an instant read
export function createCameraPump({ source, clock, onError, intervalMilliseconds = CAMERA_POLL_MILLISECONDS }: {
  source: CameraFrameSource;
  clock: Clock;
  onError: (error: unknown) => void;
  intervalMilliseconds?: number;
}) {
  let slot: EncodedFrame | undefined;
  let isBusy = false;

  async function tick() {
    if (isBusy) {
      return;
    }

    isBusy = true;
    let frame: CameraFrame | undefined;
    try {
      frame = source.acquireLatest();
      slot = (await frame?.encode()) ?? slot;
    } catch (error) {
      onError(error);
    } finally {
      frame?.release();
      isBusy = false;
    }
  }

  const stop = clock.setInterval(() => {
    void tick();
  }, intervalMilliseconds);

  return {
    latest: () => slot,
    tick,
    stop
  };
}
