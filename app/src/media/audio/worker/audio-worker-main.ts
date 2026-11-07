import { serveAudio } from "./audio-worker-host.ts";
import type { AudioPort, OpenGraphRequest } from "./audio-worker-host.ts";
import { createDuplexGraph, createLoopbackGraph } from "@/media/audio/session/audio-graph.ts";
import { requestFineTimers } from "@/media/audio/timer-resolution.ts";
import { systemClock } from "@/media/clock.ts";
import { roInitialize } from "@microsoft/dynwinrt";

function createGraph({ deviceId, isLoopback }: OpenGraphRequest) {
  return isLoopback
    ? createLoopbackGraph({ isClockedBySilentSpeaker: true })
    : createDuplexGraph({ deviceId });
}

// Finer timer ticks (a 10 ms poll otherwise lands every 15.6 ms) for as long as the graph is open
async function openGraph(request: OpenGraphRequest) {
  const releaseTimers = requestFineTimers();
  try {
    const graph = await createGraph(request);
    return {
      ...graph,
      close() {
        graph.close();
        releaseTimers();
      }
    };
  } catch (error) {
    releaseTimers();
    throw error;
  }
}

// The worker thread's whole job: its own WinRT apartment, then serve the port until it is terminated
export function startAudioWorker({ port }: { port: AudioPort | null }) {
  const isPortMissing = port === null;
  if (isPortMissing) {
    throw new Error("The audio worker runs in a worker thread");
  }

  roInitialize();
  serveAudio({
    port,
    clock: systemClock,
    openGraph
  });
}
