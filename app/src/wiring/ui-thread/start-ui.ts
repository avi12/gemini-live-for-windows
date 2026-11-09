import { log } from "@/core/log/log.ts";
import { keepRunningOnUnhandledErrors } from "@/core/log/unhandled-errors.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { createForegroundApi } from "@/overlays/window/win32-api.ts";
import { loadMountPill } from "@/pill/host/dev-attach.ts";
import { serveWindowAbilities } from "@/pill/host/window-abilities.ts";
import type { PillWindowSurface } from "@/pill/host/window-abilities.ts";
import { startKeyTriggers } from "@/wiring/ui-thread/ui-entry.ts";
import { startGoogle } from "@/wiring/ui-thread/ui-google.ts";
import { startOverlayWindows } from "@/wiring/ui-thread/ui-overlays.ts";
import type { UiWorkerData } from "@/wiring/ui-thread/ui-worker-data.ts";
import type { MountedPill } from "@gemini-live/pill/mount";
import { bringWindowToFront, trackForeground } from "winui-svelte/window/foreground";

function writeLog(message: string) {
  log.write(message);
}

// The pill's window in physical pixels, for the abilities the controller asks of it
function surfaceOf(window: ReturnType<MountedPill["window"]>) {
  if (!window) {
    return undefined;
  }

  const { appWindow } = window;
  return {
    hwnd: appWindow.id.value,
    position: () => appWindow.position,
    moveTo: position => appWindow.move(position)
  } satisfies PillWindowSurface;
}

async function attempt({ name, work }: {
  name: string;
  work: () => Promise<void>;
}) {
  try {
    await work();
  } catch (error) {
    writeLog(`${name} failed to start: ${errorMessage(error)}`);
  }
}

// Everything that has to live on the thread of the windows, started once the pump runs. One part
// failing to start is logged and leaves the others up.
function startUiServices({ pill, data }: {
  pill: MountedPill;
  data: UiWorkerData;
}) {
  serveWindowAbilities({
    link: pill.messaging,
    surface: () => surfaceOf(pill.window()),
    foreground: createForegroundApi(),
    memory: trackForeground(),
    bringToFrontOf: bringWindowToFront,
    log: writeLog
  });
  void attempt({
    name: "the Copilot key",
    work: () => Promise.resolve(startKeyTriggers({ port: data.ports.entry }))
  });
  void attempt({
    name: "the overlays",
    work: () => startOverlayWindows({
      port: data.ports.overlays,
      isDebugging: data.isDebugging,
      log: writeLog
    })
  });
  void attempt({
    name: "the Google pages",
    work: () => startGoogle({
      port: data.ports.google,
      bridgesDirectory: data.bridgesDirectory,
      audioWorkerUrl: new URL(data.audioWorkerUrl),
      uiaWorkerUrl: new URL(data.uiaWorkerUrl),
      nativeHostPath: data.nativeHostPath,
      isDebugging: data.isDebugging,
      log: writeLog
    })
  });
}

// The UI-thread worker's whole job: the pill window, and what else needs this thread
export async function startUi(data: UiWorkerData) {
  keepRunningOnUnhandledErrors();
  const mountPill = await loadMountPill();
  await mountPill({
    port: data.ports.pill,
    onStart: pill => startUiServices({
      pill,
      data
    })
  });
}
