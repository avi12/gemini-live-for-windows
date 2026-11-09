import { timerScheduler } from "./capture-scheduler.ts";
import { captureConfigSchema, framePeriodMilliseconds } from "./capture-schema.ts";
import type { CaptureBridge, CaptureConfig, CaptureScheduler, PreviewFrame } from "./capture-schema.ts";

export interface CaptureFeedOptions extends CaptureConfig {
  onFrame: (frame: PreviewFrame) => void;
  onError?: (error: unknown) => void;
  bridge: CaptureBridge;
  scheduler?: CaptureScheduler;
}

export type CaptureFeed = ReturnType<typeof createCaptureFeed>;

export function createCaptureFeed({
  onFrame,
  onError,
  bridge,
  scheduler = timerScheduler,
  ...rawConfig
}: CaptureFeedOptions) {
  const config = captureConfigSchema.parse(rawConfig);
  const source = bridge.openSource(config);
  let isStopped = false;

  function stop() {
    if (isStopped) {
      return;
    }

    isStopped = true;
    cancelTimer();
    source.close();
  }

  function tick() {
    if (isStopped) {
      return;
    }

    try {
      const frame = source.readNextFrame();
      if (frame) {
        onFrame(frame);
      }
    } catch (error) {
      stop();
      onError?.(error);
    }
  }

  const cancelTimer = scheduler.every({
    intervalMilliseconds: framePeriodMilliseconds(config.targetFramesPerSecond),
    run: tick
  });

  return { stop };
}
