import { createAudioDuplex } from "./audio/audio-duplex.ts";
import { createAudioWorkerLink } from "./audio/worker/audio-worker-link.ts";
import { openCamera } from "./camera/camera.ts";
import { systemClock } from "./clock.ts";
import { createDisplayNative } from "./display/display-native.ts";
import { createMonitors, watchDisplays } from "./display/monitors.ts";
import { createMediaPort } from "./media-port.ts";
import { readLines } from "./ocr/ocr.ts";
import { readForegroundWindow } from "./screen-text/foreground-window.ts";
import { createOcrScreenTextReader, createUiaScreenTextReader } from "./screen-text/screen-text.ts";
import { createCircleScreen } from "./screen/circle/circle-screen.ts";
import { createScreenCapture } from "./screen/screen-capture.ts";
import { createScreenSource } from "./screen/screen-source.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import { Worker } from "node:worker_threads";
import { createUiaWorker } from "winui-svelte/automation";

// The real devices behind every consumer's port, built once. The process must already be per-monitor DPI
// aware (ensureDpiAware, first thing on the main thread) and the WinRT runtime initialised on this thread.
export function createMedia({ log, microphoneId, audioWorkerUrl, uiaWorkerUrl, ownProcessId = process.pid }: {
  log: (message: string) => void;
  // The Windows device id the pill's microphone picker chose, or null for the default microphone
  microphoneId: () => string | null;
  // The bundled audio worker's file; each conversation's audio thread starts from it
  audioWorkerUrl: URL;
  // The bundled UI Automation worker's file; screen text is read on its thread
  uiaWorkerUrl: URL;
  ownProcessId?: number;
}) {
  const native = createDisplayNative();
  const monitors = createMonitors({ native });
  const screenCapture = createScreenCapture();
  const foreground = {
    foregroundWindow: readForegroundWindow,
    foregroundDisplayName: native.foregroundDisplayName,
    ownProcessId
  };
  const uiaWorker = createUiaWorker({ spawn: () => new Worker(uiaWorkerUrl) });
  const screenText = createUiaScreenTextReader({
    ...foreground,
    readText: ({ hwnd, excludeProcessId }) => uiaWorker.readText({
      target: {
        hwnd
      },
      excludeProcessId
    }),
    fallback: createOcrScreenTextReader({
      ...foreground,
      grab: request => screenCapture.grab(request),
      readLines
    }),
    log
  });

  return {
    monitors,
    screenSource: createScreenSource({ screenCapture }),
    circleScreen: createCircleScreen({
      screenCapture,
      readLines,
      log
    }),
    mediaPort: createMediaPort({
      screenCapture,
      screenText,
      openCamera: () => openCamera({
        onError: error => log(`camera: ${error instanceof Error ? error.message : String(error)}`)
      })
    }),
    // One per conversation: it owns a worker thread, which `dispose()` ends
    createAudioDuplex: () => createAudioDuplex({
      link: createAudioWorkerLink({ workerUrl: audioWorkerUrl }),
      microphoneId
    }),
    onDisplaysChanged: (listener: (current: Monitor[]) => void) => watchDisplays({
      monitors,
      clock: systemClock,
      onChange: listener
    }),
    dispose() {
      uiaWorker.close();
      screenCapture.dispose();
    }
  };
}

export type Media = ReturnType<typeof createMedia>;
