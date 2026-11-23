import type { Logger } from "@/google/ports.ts";
import { HomeMessage, type HomeProtocolMap, pcLightsSchema } from "@/google/protocols/home.ts";
import { delay } from "@/google/web-host/timeout.ts";
import type { createWebHost } from "@/google/web-host/web-host.ts";
import { errorMessage } from "@/lib/error-message.ts";

const READY_POLL_MS = 400;
const READY_TIMEOUT_MS = 20_000;
// Long enough for a navigation to start, or for a tile to reflect its new state
export const SETTLE_MS = 1600;

export type HomeWebHost = ReturnType<typeof createWebHost<HomeProtocolMap>>;

// What the Home page's bridge answers: whether it listens yet, and the PC lights' tile
export function createHomePage({ webHost, now, log }: { webHost: HomeWebHost; now: () => number; log: Logger }) {
  const { messenger } = webHost;

  // While the page is still loading the bridge isn't listening yet (no listener) or the message is
  // lost to the navigation (timeout); either just means not ready yet
  async function isReady() {
    try {
      return (await messenger.sendMessage(HomeMessage.READY)) === true;
    } catch {
      return false;
    }
  }

  async function waitReady() {
    const deadline = now() + READY_TIMEOUT_MS;
    while (now() < deadline) {
      if (!webHost.core) {
        return false;
      }

      if (await isReady()) {
        return true;
      }

      await delay(READY_POLL_MS);
    }

    return false;
  }

  async function readLights() {
    try {
      const parsed = pcLightsSchema.safeParse(await messenger.sendMessage(HomeMessage.PC_LIGHTS));
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      log.write(`home: reading the lights: ${errorMessage(error)}`);
      return undefined;
    }
  }

  return {
    waitReady,
    readLights
  };
}

export type HomePage = ReturnType<typeof createHomePage>;
