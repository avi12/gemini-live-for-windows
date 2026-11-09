import { claimInstance } from "@/core/instance/instance.ts";
import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { refreshInstalledExtension } from "@/core/link/extension-setup.ts";
import { packagedHostPath } from "@/core/link/native-host-registration.ts";
import { log } from "@/core/log/log.ts";
import { keepRunningOnUnhandledErrors } from "@/core/log/unhandled-errors.ts";
import { loadSettings } from "@/core/settings/settings.ts";
import { readInstalledVersion } from "@/core/updates/version/installed-version.ts";
import {
  ActivationKind,
  describeActivation,
  RECOVERED_ARGUMENT,
  userArguments
} from "@/entry/activation/activation.ts";
import type { Activation } from "@/entry/activation/activation.ts";
import { readPackagedKind } from "@/entry/activation/packaged-activation.ts";
import { serveKeyTriggers } from "@/entry/activation/protocol.ts";
import { ensureDpiAware } from "@/entry/dpi.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { launchDetached } from "@/lib/launch.ts";
import { buildController } from "@/wiring/main-thread/build-controller.ts";
import { openChannels } from "@/wiring/main-thread/channels.ts";
import type { ShippedFiles } from "@/wiring/main-thread/shipped-files.ts";
import { createTriggerRelay } from "@/wiring/main-thread/trigger-relay.ts";
import {
  RAPID_RESTARTS_VARIABLE,
  rapidRestartsOf,
  restartCommand,
  superviseUiWorker
} from "@/wiring/main-thread/worker-supervisor.ts";
import type { UiWorkerData } from "@/wiring/ui-thread/ui-worker-data.ts";
import { roInitialize } from "@microsoft/dynwinrt";
import path from "node:path";
import { isSea } from "node:sea";
import { Worker } from "node:worker_threads";
import { restartAfterCrash } from "winui-svelte/app";
import { initWindowsAppSdk } from "winui-svelte/bootstrap";

const WINDOWS_APP_SDK_MAJOR = 2;
const WINDOWS_APP_SDK_MINOR = 2;
const NOT_SUPPORTED_HRESULT = "0x80070032";
const HOST_EXECUTABLE = "GeminiLiveHost.exe";

function writeLog(message: string) {
  log.write(message);
}

// Inside a package the runtime comes from the package's dependency, and the bootstrap refuses
function startWindowsAppSdk({ isPackaged }: { isPackaged: boolean }) {
  try {
    initWindowsAppSdk({
      major: WINDOWS_APP_SDK_MAJOR,
      minor: WINDOWS_APP_SDK_MINOR
    });
  } catch (error) {
    const isRefusedByIdentity = error instanceof Error && error.message.includes(NOT_SUPPORTED_HRESULT);
    const isRuntimeFromPackage = isPackaged && isRefusedByIdentity;
    if (!isRuntimeFromPackage) {
      throw error;
    }
  }
}

// After a crash, a hang or an update, Windows offers to start the app again, as a recovered copy
// that comes up without a conversation. Failing to register only costs that offer.
function registerCrashRestart() {
  try {
    restartAfterCrash({ arguments: [RECOVERED_ARGUMENT] });
  } catch (error) {
    writeLog(`restart after a crash: ${errorMessage(error)}`);
  }
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

function startUiWorker({ files, data, onEnded }: {
  files: ShippedFiles;
  data: UiWorkerData;
  onEnded: (event: {
    exitCode: number;
    ranMilliseconds: number;
  }) => Promise<void>;
}) {
  const startedAt = Date.now();
  const worker = new Worker(files.uiWorker, {
    workerData: data,
    transferList: Object.values(data.ports)
  });
  worker.on("error", error => {
    writeLog(`ui worker: ${errorMessage(error)}`);
  });
  worker.on("exit", exitCode => {
    onEnded({
      exitCode,
      ranMilliseconds: Date.now() - startedAt
    }).catch((error: unknown) => {
      writeLog(`restarting the window: ${errorMessage(error)}`);
      process.exit(exitCode);
    });
  });
}

// Packaged, a browser can't start an exe inside the package folder, so the host goes through the
// package's app execution alias; unpackaged, it sits beside the app
function nativeHostPathOf({ isPackaged }: { isPackaged: boolean }) {
  return isPackaged ? packagedHostPath() : path.join(path.dirname(process.execPath), HOST_EXECUTABLE);
}

function triggerOf(activation: Activation) {
  return activation.kind === ActivationKind.key ? activation.trigger : KeyTrigger.tap;
}

// A launch at sign-in only readies the app; any other start is a press of the key
function firstTriggerOf(activation: Activation) {
  return activation.kind === ActivationKind.startup ? undefined : triggerOf(activation);
}

// The whole app: the first copy claims the single-instance pipe (a later copy hands over its press
// and leaves), the main thread builds the pill controller over the devices, and the UI worker is
// started with the other ends of its links
export async function startApp({ files }: { files: ShippedFiles }) {
  keepRunningOnUnhandledErrors();
  ensureDpiAware();
  const relay = createTriggerRelay();
  const claim = await claimInstance({
    trigger: triggerOf(describeActivation({ args: userArguments(process.argv) })),
    onTrigger: trigger => relay.send(trigger)
  });
  if (!claim.isPrimary) {
    process.exit(0);
  }

  registerCrashRestart();

  const installedVersion = await readInstalledVersion();
  const isPackaged = installedVersion !== undefined;
  startWindowsAppSdk({ isPackaged });
  roInitialize();

  const activation = describeActivation({
    args: userArguments(process.argv),
    packagedKind: isPackaged ? await readPackagedKind() : undefined
  });
  void refreshInstalledExtension({ shippedDir: files.extensionDirectory });
  const channels = openChannels();
  const controller = buildController({
    settings: await loadSettings(),
    installedVersion,
    files,
    channels,
    quit() {
      controller.dispose();
      process.exit(0);
    },
    log: writeLog
  });
  serveKeyTriggers({
    transport: channels.transports.entry,
    onTrigger: payload => relay.send(payload.trigger),
    log: writeLog
  });
  relay.attach(trigger => {
    controller.onTrigger(trigger).catch((error: unknown) => {
      writeLog(`trigger ${trigger}: ${errorMessage(error)}`);
    });
  });
  const firstTrigger = firstTriggerOf(activation);
  if (firstTrigger) {
    relay.send(firstTrigger);
  }

  startUiWorker({
    files,
    data: {
      ports: channels.workerPorts,
      bridgesDirectory: files.bridgesDirectory,
      nativeHostPath: nativeHostPathOf({ isPackaged }),
      audioWorkerUrl: files.audioWorkerUrl.href,
      isDebugging: log.isDebugging
    },
    async onEnded({ exitCode, ranMilliseconds }) {
      controller.dispose();
      const isRestarting = await superviseUiWorker({
        exitCode,
        ranMilliseconds,
        rapidRestarts: rapidRestartsOf(process.env),
        release: () => claim.close(),
        relaunch: startAgain,
        delay: milliseconds => new Promise(resolve => {
          setTimeout(resolve, milliseconds);
        }),
        log: writeLog
      });
      process.exit(isRestarting ? 0 : exitCode || 1);
    }
  });
}
