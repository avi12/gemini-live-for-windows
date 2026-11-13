import { createHash } from "node:crypto";

import type { Monitor, Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { FRAME_REFRESH_MS } from "@/live/api/constants.ts";
import type { LogSink, ScreenSource, ScreenTarget } from "@/live/ports.ts";

export interface FrameSenderDeps {
  readonly source: ScreenSource;
  readonly monitor: Monitor;
  readonly send: (jpeg: Uint8Array) => void;
  readonly now: () => number;
  readonly log: LogSink;
}

function hashOf(jpeg: Uint8Array) {
  return createHash("sha256").update(jpeg).digest("hex");
}

// Pushes stills of one monitor on each tick, the shape of "video" Gemini Live uses on every
// platform. Unchanged frames are skipped, with a periodic refresh so the model's context never
// goes stale. The target is one immutable snapshot swapped whole, so a tick never pairs one
// display with another's region.
export function createFrameSender({ source, monitor, send, now, log }: FrameSenderDeps) {
  let target: ScreenTarget = {
    monitor,
    region: undefined
  };
  let lastHash: string | undefined;
  let lastSentAt = Number.NEGATIVE_INFINITY;

  async function capture(snapshot: ScreenTarget) {
    try {
      return await source.capture(snapshot);
    } catch (error) {
      log(`screen capture failed: ${errorMessage(error)}`);
      return undefined;
    }
  }

  async function tick() {
    const jpeg = await capture(target);
    if (!jpeg) {
      return;
    }

    const hash = hashOf(jpeg);
    const isUnchanged = hash === lastHash;
    const isFresh = isUnchanged && now() - lastSentAt < FRAME_REFRESH_MS;
    if (isFresh) {
      return;
    }

    lastHash = hash;
    lastSentAt = now();
    send(jpeg);
  }

  return {
    tick,
    get monitor() {
      return target.monitor;
    },
    get region() {
      return target.region;
    },
    set region(region: Region | undefined) {
      target = {
        ...target,
        region
      };
    },
    share(next: Monitor) {
      target = {
        monitor: next,
        region: undefined
      };
      lastHash = undefined;
    }
  };
}
