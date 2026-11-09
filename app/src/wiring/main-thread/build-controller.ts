import type { Settings } from "@/core/settings/settings-file.ts";
import { openExternal } from "@/core/shell/open-external.ts";
import { createUpdateChecker } from "@/core/updates/update-checker.ts";
import { connectGoogle } from "@/google/remote/google-client.ts";
import { delay } from "@/google/web-host/timeout.ts";
import { createMedia } from "@/media/media.ts";
import { createPillController } from "@/pill/controller.ts";
import { openPillLink } from "@/pill/host/host-link.ts";
import { createSettingsPort } from "@/pill/host/settings-port.ts";
import type { PillDeps } from "@/pill/ports.ts";
import type { Channels } from "@/wiring/main-thread/channels.ts";
import { createOverlayControl } from "@/wiring/main-thread/overlay-control.ts";
import {
  createDisplaysPort,
  createEnginesPort,
  createGooglePort,
  createMicrophonesPort,
  createPreviousAppPort,
  createUpdatesPort
} from "@/wiring/main-thread/pill-ports.ts";
import type { ShippedFiles } from "@/wiring/main-thread/shipped-files.ts";

// The pill controller over the real devices, engines and windows. The UI worker's ends of the
// links it uses are in `channels`; the pill's window answers on the first of them.
export function buildController({ settings, installedVersion, files, channels, quit, log }: {
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
    uiaWorkerUrl: files.uiaWorkerUrl
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
  const overlays = createOverlayControl({
    transport: channels.transports.overlays,
    media,
    controller: () => controller,
    log
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

function buildPillDeps({ settings, installedVersion, files, media, google, overlays, pillLink, checker, quit, log }: {
  settings: Settings;
  installedVersion: string | undefined;
  files: ShippedFiles;
  media: ReturnType<typeof createMedia>;
  google: ReturnType<typeof connectGoogle>;
  overlays: ReturnType<typeof createOverlayControl>;
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
    createFocus: overlays.createFocus,
    previousApp: createPreviousAppPort({
      window: pillLink.windowPort,
      delay
    }),
    window: pillLink.windowPort,
    updates: createUpdatesPort({
      checker,
      installed: installedVersion
    }),
    openExternal: uri => openExternal({ uri }),
    quit,
    log,
    delay
  } satisfies PillDeps;
}
