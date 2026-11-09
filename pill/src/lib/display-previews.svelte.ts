import { createCaptureManager } from "@/lib/capture/capture-manager.ts";
import type { CaptureManager } from "@/lib/capture/capture-manager.ts";
import type { PreviewFrame, PreviewSource } from "@/lib/capture/capture-schema.ts";
import type { PillView } from "@gemini-live/protocol/view";
import { untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { setBitmapPixels, writeableBitmapOf } from "winui-svelte/media";

type PreviewImage = ReturnType<typeof writeableBitmapOf>;

const PREVIEW_SIZE = {
  width: 192,
  height: 108
} as const;
const STATS_VARIABLE = "GEMINI_LIVE_PREVIEW_STATS";
const STATS_ENABLED_VALUE = "1";
const STATS_INTERVAL_MILLISECONDS = 1000;

const images = new SvelteMap<string, PreviewImage>();
const displayIdOfCapture = new SvelteMap<string, string>();
const frameCounts = new SvelteMap<string, number>();
let source: PreviewSource | undefined;
let manager: CaptureManager | undefined;
let statsTimer: NodeJS.Timeout | undefined;

function reportProblem(message: string) {
  process.stderr.write(`pill: ${message}\n`);
}

function countFrame(displayId: string) {
  frameCounts.set(displayId, (frameCounts.get(displayId) ?? 0) + 1);
}

function startStats() {
  const isWanted = process.env[STATS_VARIABLE] === STATS_ENABLED_VALUE;
  const isRunning = statsTimer !== undefined;
  const isSkipped = !isWanted || isRunning;
  if (isSkipped) {
    return;
  }

  statsTimer = setInterval(() => {
    for (const [displayId, count] of frameCounts) {
      reportProblem(`preview ${displayId} delivered ${count} fps`);
    }

    frameCounts.clear();
  }, STATS_INTERVAL_MILLISECONDS);
}

function stopStats() {
  clearInterval(statsTimer);
  statsTimer = undefined;
  frameCounts.clear();
}

function showFrame({ displayId, frame }: {
  displayId: string;
  frame: PreviewFrame;
}) {
  const current = images.get(displayId);
  countFrame(displayId);

  const isFirstFrame = current === undefined;
  if (isFirstFrame) {
    images.set(displayId, writeableBitmapOf(frame));
    return;
  }

  setBitmapPixels({
    source: current,
    ...frame
  });
}

function managerOf(previewSource: PreviewSource) {
  manager ??= createCaptureManager({
    bridge: previewSource.bridge,
    size: PREVIEW_SIZE,
    onFrame({ displayId, frame }) {
      const viewId = displayIdOfCapture.get(displayId);
      const isUnknownDisplay = viewId === undefined;
      if (isUnknownDisplay) {
        return;
      }

      showFrame({
        displayId: viewId,
        frame
      });
    },
    onError: ({ displayId, error }) => reportProblem(`preview of display ${displayId} stopped: ${String(error)}`)
  });
  return manager;
}

export function installPreviewSource(installed: PreviewSource) {
  source = installed;
}

export function previewOf(displayId: string) {
  return images.get(displayId);
}

export function setPreviewsOpen(isOpen: boolean) {
  const installed = source;
  const isInstalled = installed !== undefined;
  if (!isInstalled) {
    return;
  }

  managerOf(installed).setOpen(isOpen);

  if (isOpen) {
    startStats();
    return;
  }

  stopStats();
  images.clear();
}

function captureIdOf({ source: previewSource, display }: {
  source: PreviewSource;
  display: PillView["displays"][number];
}) {
  try {
    return previewSource.captureIdOf(display);
  } catch (error) {
    reportProblem(`display ${display.id} cannot be previewed: ${String(error)}`);
    return undefined;
  }
}

function targetsOf({ source: previewSource, displays, framesPerSecond }: {
  source: PreviewSource;
  displays: PillView["displays"];
  framesPerSecond: number;
}) {
  return displays.flatMap(display => {
    const captureId = captureIdOf({
      source: previewSource,
      display
    });
    const isUncapturable = captureId === undefined;
    if (isUncapturable) {
      return [];
    }

    return [{
      captureId,
      displayId: display.id,
      targetFramesPerSecond: Math.min(framesPerSecond, display.refreshRateHertz)
    }];
  });
}

function dropImagesOutside(displays: PillView["displays"]) {
  const shownIds = new SvelteSet(displays.map(display => display.id));
  untrack(() => {
    for (const displayId of images.keys()) {
      if (!shownIds.has(displayId)) {
        images.delete(displayId);
      }
    }
  });
}

export function syncPreviews({ displays, framesPerSecond }: {
  displays: PillView["displays"];
  framesPerSecond: number;
}) {
  const installed = source;
  const isInstalled = installed !== undefined;
  if (!isInstalled) {
    return;
  }

  const wanted = targetsOf({
    source: installed,
    displays,
    framesPerSecond
  });
  displayIdOfCapture.clear();
  for (const { captureId, displayId } of wanted) {
    displayIdOfCapture.set(captureId, displayId);
  }

  dropImagesOutside(displays);
  managerOf(installed).setDisplays(
    wanted.map(({ captureId, targetFramesPerSecond }) => ({
      displayId: captureId,
      targetFramesPerSecond
    }))
  );
}
