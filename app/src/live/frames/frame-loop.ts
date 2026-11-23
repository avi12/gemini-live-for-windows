import { FRAME_INTERVAL_MS } from "@/live/api/constants.ts";

import type { createFrameSender } from "./frame-sender.ts";

// Ticks the frame sender once a second. A tick still waiting on its screen grab makes the next one
// skip, so slow captures never pile up behind each other.
export function createFrameLoop(frames: ReturnType<typeof createFrameSender>) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let isInFlight = false;
  let isStopped = false;

  async function tick() {
    const isSkipped = isInFlight || isStopped;
    if (isSkipped) {
      return;
    }

    isInFlight = true;
    try {
      await frames.tick();
    } finally {
      isInFlight = false;
    }
  }

  return {
    start() {
      void tick();
      timer = setInterval(() => {
        void tick();
      }, FRAME_INTERVAL_MS);
    },
    stop() {
      isStopped = true;
      clearInterval(timer);
    }
  };
}
