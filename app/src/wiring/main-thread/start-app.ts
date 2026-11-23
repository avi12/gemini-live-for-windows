import { roInitialize } from "@microsoft/dynwinrt";

import { claimInstance } from "@/core/instance/instance.ts";
import { refreshInstalledExtension } from "@/core/link/extension-setup.ts";
import { log } from "@/core/log/log.ts";
import { keepRunningOnUnhandledErrors } from "@/core/log/unhandled-errors.ts";
import { loadSettings } from "@/core/settings/settings.ts";
import { readInstalledVersion } from "@/core/updates/version/installed-version.ts";
import { describeActivation, userArguments } from "@/entry/activation/activation.ts";
import { readPackagedKind } from "@/entry/activation/packaged-activation.ts";
import { KeySource, serveKeyTriggers } from "@/entry/activation/protocol.ts";
import { ensureDpiAware } from "@/entry/dpi.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { buildController } from "@/wiring/main-thread/controller/build-controller.ts";
import type { ShippedFiles } from "@/wiring/main-thread/shipped-files.ts";
import { firstTriggerOf, triggerOf } from "@/wiring/main-thread/triggers/first-trigger.ts";
import { createTriggerRelay } from "@/wiring/main-thread/triggers/trigger-relay.ts";
import { openChannels } from "@/wiring/main-thread/ui-worker/channels.ts";
import { launchUiWorker } from "@/wiring/main-thread/ui-worker/launch-ui-worker.ts";
import { registerCrashRestart, startWindowsAppSdk } from "@/wiring/main-thread/windows-runtime.ts";

function writeLog(message: string) {
  log.write(message);
}

// The whole app: the first copy claims the single-instance pipe (a later copy hands over its press
// and leaves), the main thread builds the pill controller over the devices, and the UI worker is
// started with the other ends of its links
export async function startApp({ files }: { files: ShippedFiles }) {
  keepRunningOnUnhandledErrors();
  ensureDpiAware();
  const relay = createTriggerRelay({ log: writeLog });
  const claim = await claimInstance({
    trigger: triggerOf(describeActivation({ args: userArguments(process.argv) })),
    onTrigger: trigger =>
      relay.send({
        trigger,
        source: KeySource.FORWARDED
      })
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
  writeLog(`activation: ${activation.kind} (packaged: ${isPackaged}, args: ${userArguments(process.argv).join(" ")})`);
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
    onTrigger: payload => relay.send(payload),
    log: writeLog
  });
  relay.attach(trigger => {
    controller.onTrigger(trigger).catch((error: unknown) => {
      writeLog(`trigger ${trigger}: ${errorMessage(error)}`);
    });
  });
  const firstTrigger = firstTriggerOf(activation);
  if (firstTrigger) {
    relay.send({
      trigger: firstTrigger,
      source: KeySource.COLD_START
    });
  }

  launchUiWorker({
    files,
    workerPorts: channels.workerPorts,
    isPackaged,
    isInUse: () => controller.isRunning || controller.view()?.isShown === true,
    onEnded: () => controller.dispose(),
    release: () => claim.close()
  });
}
