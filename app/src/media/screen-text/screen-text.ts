import { TextBlockKind } from "winui-svelte/automation";
import type { WindowText } from "winui-svelte/automation";

import type { Monitor, Region } from "@/contracts/monitor.ts";
import { BlockKind } from "@/google/protocols/glic.ts";
import type { ScreenView } from "@/google/protocols/glic.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";
import { clipToSurface, ScreenDetail } from "@/media/screen/capture-geometry.ts";
import type { EncodedFrame } from "@/media/screen/jpeg-encoder.ts";

import type { ForegroundWindow } from "./foreground-window.ts";
import { buildScreenView } from "./screen-text-blocks.ts";

// An exact text copy of the window the user is looking at. The real reader is UI Automation (Windows'
// accessibility tree: exact words, headings, no recognition errors), createUiaScreenTextReader;
// where it finds nothing (a window that exposes no tree, an elevated one, a timeout) it falls back to
interface GrabRequest {
  monitor: Monitor;
  region: Region;
  detail: ScreenDetail;
}

interface ReadTextRequest {
  hwnd: bigint;
  excludeProcessId: number;
}

// createOcrScreenTextReader, which answers with the same shape from a picture of the window.
export interface ScreenTextReader {
  // The text of the foreground window if it is on `monitor`; undefined when there is none, it is on
  // another display, it is this app's own, or nothing readable was found
  read(monitor: Monitor): Promise<ScreenView | undefined>;
}

export interface ForegroundDeps {
  foregroundWindow: () => ForegroundWindow | undefined;
  foregroundDisplayName: () => string | undefined;
  ownProcessId: number;
}

export interface ScreenTextDeps extends ForegroundDeps {
  grab: (request: GrabRequest) => Promise<EncodedFrame>;
  readLines: (request: { image: Uint8Array }) => Promise<OcrLine[]>;
}

export interface UiaScreenTextDeps extends ForegroundDeps {
  readText: (request: ReadTextRequest) => Promise<WindowText | null>;
  fallback: ScreenTextReader;
  log: (message: string) => void;
}

// The foreground window when it is the user's: not this app's own, and on `monitor`
function userWindowOn({ deps, monitor }: { deps: ForegroundDeps; monitor: Monitor }) {
  const window = deps.foregroundWindow();
  const isNoWindowOrOurs = window === undefined || window.processId === deps.ownProcessId;
  if (isNoWindowOrOurs) {
    return undefined;
  }

  const isOnAnotherDisplay = deps.foregroundDisplayName() !== monitor.deviceName;
  return isOnAnotherDisplay ? undefined : window;
}

// Degraded on purpose: lines of recognised text, no exact copy, headings guessed from line height
export function createOcrScreenTextReader(deps: ScreenTextDeps) {
  const { grab, readLines } = deps;
  return {
    async read(monitor) {
      const window = userWindowOn({
        deps,
        monitor
      });
      if (!window) {
        return undefined;
      }

      const region = clipToSurface({
        region: {
          x: window.bounds.x - monitor.x,
          y: window.bounds.y - monitor.y,
          width: window.bounds.width,
          height: window.bounds.height
        },
        size: monitor
      });
      const isRegionMissing = region === undefined;
      if (isRegionMissing) {
        return undefined;
      }

      const frame = await grab({
        monitor,
        region,
        detail: ScreenDetail.FROZEN
      });
      const lines = await readLines({ image: frame.jpeg });
      return buildScreenView({
        title: window.title,
        app: window.appName,
        lines
      });
    }
  } satisfies ScreenTextReader;
}

function screenViewOf({ text, window }: { text: WindowText; window: ForegroundWindow }) {
  const hasTitle = text.title.length > 0;
  return {
    title: hasTitle ? text.title : window.title,
    app: window.appName,
    blocks: text.blocks.map(block => ({
      kind: block.kind === TextBlockKind.heading ? BlockKind.HEADING : BlockKind.PARAGRAPH,
      text: block.text
    })),
    version: text.version
  } satisfies ScreenView;
}

// The exact text and headings of the foreground window from its accessibility tree; the picture-based
// reader answers when the tree gives no text or the read fails
export function createUiaScreenTextReader(deps: UiaScreenTextDeps) {
  const { readText, fallback, log, ownProcessId } = deps;
  return {
    async read(monitor) {
      const window = userWindowOn({
        deps,
        monitor
      });
      if (!window) {
        return undefined;
      }

      try {
        const text = await readText({
          hwnd: window.hwnd,
          excludeProcessId: ownProcessId
        });
        const isTextFound = text !== null && text.blocks.length > 0;
        if (isTextFound) {
          return screenViewOf({
            text,
            window
          });
        }
      } catch (error) {
        log(`screen text: UI Automation failed, reading the picture instead: ${errorMessage(error)}`);
      }

      return fallback.read(monitor);
    }
  } satisfies ScreenTextReader;
}
