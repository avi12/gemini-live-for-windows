import type { Settings } from "@/core/settings/settings-file.ts";
import { openExternal } from "@/core/shell/open-external.ts";
import { createUpdateChecker } from "@/core/updates/update-checker.ts";
import { connectGoogle } from "@/google/remote/google-client.ts";
import { delay } from "@/google/web-host/timeout.ts";
import { copyTextWithPowerShell } from "@/lib/clipboard.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { createMedia } from "@/media/media.ts";
import { connectOverlayWindows } from "@/overlays/controller-link.ts";
import { fetchPageTitle } from "@/pill/captions/page-title.ts";
import { createPillController } from "@/pill/controller.ts";
import { openPillLink } from "@/pill/host/host-link.ts";
import { createPreviousApp } from "@/pill/host/previous-app.ts";
import { createSettingsPort } from "@/pill/host/settings-port.ts";
import type { PillDeps } from "@/pill/ports.ts";
import {
  createDisplaysPort,
  createEnginesPort,
  createGooglePort,
  createMicrophonesPort,
  createUpdatesPort
} from "@/wiring/main-thread/controller/pill-ports.ts";
import type { ShippedFiles } from "@/wiring/main-thread/shipped-files.ts";
import type { Channels } from "@/wiring/main-thread/ui-worker/channels.ts";

// The pill controller over the real devices, engines and windows. The UI worker's ends of the
// links it uses are in `channels`; the pill's window answers on the first of them.
export function buildController({
  settings,
  installedVersion,
  files,
  channels,
  quit,
  log
}: {
  settings: Settings;
  installedVersion: string | undefined;
  files: ShippedFiles;
  channels: Channels;
  quit: () => void;
  log: (message: string) => void;
}) {
  const media = createMedia({
    log,
    microphoneId: () => settings.microphoneId,
    audioWorkerUrl: files.audioWorkerUrl,
    uiaWorkerUrl: files.uiaWorkerUrl,
    screenCaptureWorkerUrl: files.screenCaptureWorkerUrl
  });
  const google = connectGoogle({
    transport: channels.transports.google,
    log: {
      write: log
    }
  });
  const pillLink = openPillLink({
    transport: channels.transports.pill,
    log
  });
  const overlays = connectOverlayWindows({
    transport: channels.transports.overlays,
    log: {
      write: log
    }
  });
  const checker = createUpdateChecker({
    installed: installedVersion,
    isCheckEnabled: () => settings.checkForUpdates
  });

  const controller = createPillController(
    buildPillDeps({
      settings,
      installedVersion,
      files,
      media,
      google,
      overlays,
      pillLink,
      checker,
      quit,
      log
    })
  );
  pillLink.serve(controller);

  return controller;
}

function buildPillDeps({
  settings,
  installedVersion,
  files,
  media,
  google,
  overlays,
  pillLink,
  checker,
  quit,
  log
}: {
  settings: Settings;
  installedVersion: string | undefined;
  files: ShippedFiles;
  media: ReturnType<typeof createMedia>;
  google: ReturnType<typeof connectGoogle>;
  overlays: ReturnType<typeof connectOverlayWindows>;
  pillLink: ReturnType<typeof openPillLink>;
  checker: ReturnType<typeof createUpdateChecker>;
  quit: () => void;
  log: (message: string) => void;
}) {
  return {
    settings: createSettingsPort(settings),
    engines: createEnginesPort({
      settings,
      media,
      google,
      log
    }),
    google: createGooglePort({
      extensionDirectory: files.extensionDirectory,
      log
    }),
    displays: createDisplaysPort(media),
    microphones: createMicrophonesPort(google),
    shareBorder: overlays.shareBorder,
    previousApp: createPreviousApp({
      window: pillLink.windowPort,
      delay
    }),
    window: pillLink.windowPort,
    updates: createUpdatesPort({
      checker,
      installed: installedVersion
    }),
    openExternal: uri => openExternal({ uri }),
    pageTitle: url => fetchPageTitle({ url }),
    copyText: text =>
      copyTextWithPowerShell(text).catch((error: unknown) => {
        log(`clipboard busy: ${errorMessage(error)}`);
      }),
    quit,
    log,
    delay
  } satisfies PillDeps;
}
