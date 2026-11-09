import { createCaptureFeed } from "./capture-feed.ts";
import type { CaptureFeed } from "./capture-feed.ts";
import { captureTargetsSchema } from "./capture-schema.ts";
import type {
  CaptureBridge,
  CaptureScheduler,
  CaptureTarget,
  PreviewFrame,
  PreviewSize
} from "./capture-schema.ts";

export interface CaptureManagerOptions {
  bridge: CaptureBridge;
  size: PreviewSize;
  onFrame: (event: {
    displayId: string;
    frame: PreviewFrame;
  }) => void;
  onError?: (event: {
    displayId: string;
    error: unknown;
  }) => void;
  scheduler?: CaptureScheduler;
}

export type CaptureManager = ReturnType<typeof createCaptureManager>;

interface RunningFeed {
  targetFramesPerSecond: number;
  feed: CaptureFeed;
}

export function createCaptureManager({ bridge, size, onFrame, onError, scheduler }: CaptureManagerOptions) {
  const running = new Map<string, RunningFeed>();
  let wantedDisplays: CaptureTarget[] = [];
  let isOpen = false;

  function startFeed({ displayId, targetFramesPerSecond }: CaptureTarget) {
    try {
      const feed = createCaptureFeed({
        displayId,
        targetFramesPerSecond,
        size,
        bridge,
        ...scheduler && {
          scheduler
        },
        onFrame: frame => onFrame({
          displayId,
          frame
        }),
        onError(error) {
          running.delete(displayId);
          onError?.({
            displayId,
            error
          });
        }
      });
      running.set(displayId, {
        targetFramesPerSecond,
        feed
      });
    } catch (error) {
      onError?.({
        displayId,
        error
      });
    }
  }

  function stopFeed(displayId: string) {
    running.get(displayId)?.feed.stop();
    running.delete(displayId);
  }

  function reconcile() {
    const wanted = isOpen ? wantedDisplays : [];
    const wantedIds = new Set(wanted.map(target => target.displayId));
    for (const displayId of running.keys()) {
      if (!wantedIds.has(displayId)) {
        stopFeed(displayId);
      }
    }

    for (const target of wanted) {
      const current = running.get(target.displayId);
      const isUnchanged = current?.targetFramesPerSecond === target.targetFramesPerSecond;
      if (isUnchanged) {
        continue;
      }

      stopFeed(target.displayId);
      startFeed(target);
    }
  }

  function setOpen(isOpenNow: boolean) {
    isOpen = isOpenNow;
    reconcile();
  }

  function setDisplays(displays: readonly CaptureTarget[]) {
    wantedDisplays = captureTargetsSchema.parse(displays);
    reconcile();
  }

  function stop() {
    isOpen = false;
    wantedDisplays = [];
    reconcile();
  }

  return {
    setOpen,
    setDisplays,
    stop
  };
}
