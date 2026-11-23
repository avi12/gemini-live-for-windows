import path from "node:path";
import { isSea } from "node:sea";
import { Worker } from "node:worker_threads";

import { packagedHostPath } from "@/core/link/native-host-registration.ts";
import { log } from "@/core/log/log.ts";
import { delay } from "@/google/web-host/timeout.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { launchDetached } from "@/lib/launch.ts";
import { restartOnDevChanges } from "@/wiring/dev/dev-restart.ts";
import type { Channels } from "@/wiring/main-thread/channels.ts";
import type { ShippedFiles } from "@/wiring/main-thread/shipped-files.ts";
import {
  RAPID_RESTARTS_VARIABLE,
  rapidRestartsOf,
  restartCommand,
  superviseUiWorker
} from "@/wiring/main-thread/worker-supervisor.ts";
import type { UiWorkerData } from "@/wiring/ui-thread/ui-worker-data.ts";

const HOST_EXECUTABLE = "GeminiLiveHost.exe";

function writeLog(message: string) {
  log.write(message);
}

// Packaged, a browser can't start an exe inside the package folder, so the host goes through the
// package's app execution alias; unpackaged, it sits beside the app
function nativeHostPathOf({ isPackaged }: { isPackaged: boolean }) {
  return isPackaged ? packagedHostPath() : path.join(path.dirname(process.execPath), HOST_EXECUTABLE);
}

// What the UI worker is started with: its ends of the links, and where the files it reads ship
function uiWorkerDataOf({
  files,
  workerPorts,
  isPackaged
}: {
  files: ShippedFiles;
  workerPorts: Channels["workerPorts"];
  isPackaged: boolean;
}) {
  return {
    ports: workerPorts,
    bridgesDirectory: files.bridgesDirectory,
    nativeHostPath: nativeHostPathOf({ isPackaged }),
    audioWorkerUrl: files.audioWorkerUrl.href,
    uiaWorkerUrl: files.uiaWorkerUrl.href,
    screenCaptureWorkerUrl: files.screenCaptureWorkerUrl.href,
    isDebugging: log.isDebugging
  } satisfies UiWorkerData;
}

// The UI worker owns every window, so when it ends the app has lost its pill: like PillHost.cs
// restarting a dead pill, start the app again (it comes back up without a conversation), unless
// the window keeps dying right after it starts
function startAgain(rapidRestarts: number) {
  launchDetached({
    ...restartCommand({
      isSingleExecutable: isSea(),
      execPath: process.execPath,
      execArgv: process.execArgv,
      script: process.argv[1]
    }),
    env: {
      ...process.env,
      [RAPID_RESTARTS_VARIABLE]: String(rapidRestarts)
    }
  });
}

// Lets the app go once the window has ended: back up as a new copy, or down when it keeps dying
async function endWithWindow({
  exitCode,
  ranMilliseconds,
  onEnded,
  release
}: {
  exitCode: number;
  ranMilliseconds: number;
  onEnded: () => void;
  release: () => Promise<void>;
}) {
  onEnded();
  const isRestarting = await superviseUiWorker({
    exitCode,
    ranMilliseconds,
    rapidRestarts: rapidRestartsOf(process.env),
    release,
    relaunch: startAgain,
    delay,
    log: writeLog
  });
  process.exit(isRestarting ? 0 : exitCode || 1);
}

// Starts the UI worker with the other ends of its links. When it ends, `onEnded` lets go of the
// main thread's side and `release` of the single-instance pipe, before the app starts again.
export function launchUiWorker({
  files,
  workerPorts,
  isPackaged,
  isInUse,
  onEnded,
  release
}: {
  files: ShippedFiles;
  workerPorts: Channels["workerPorts"];
  isPackaged: boolean;
  // The pill is up or a conversation runs
  isInUse: () => boolean;
  onEnded: () => void;
  release: () => Promise<void>;
}) {
  const startedAt = Date.now();
  const data = uiWorkerDataOf({
    files,
    workerPorts,
    isPackaged
  });
  const worker = new Worker(files.uiWorker, {
    workerData: data,
    transferList: Object.values(data.ports)
  });
  worker.on("error", error => {
    writeLog(`ui worker: ${errorMessage(error)}`);
  });
  restartOnDevChanges({
    endWindow() {
      void worker.terminate();
    },
    isInUse
  });
  worker.on("exit", exitCode => {
    endWithWindow({
      exitCode,
      ranMilliseconds: Date.now() - startedAt,
      onEnded,
      release
    }).catch((error: unknown) => {
      writeLog(`restarting the window: ${errorMessage(error)}`);
      process.exit(exitCode);
    });
  });
}
