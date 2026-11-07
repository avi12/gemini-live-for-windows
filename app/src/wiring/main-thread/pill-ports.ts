import { EngineKind } from "@/contracts/live-engine.ts";
import { connectExtension } from "@/core/link/extension-setup.ts";
import type { Settings } from "@/core/settings/settings-file.ts";
import { apiKey } from "@/core/settings/settings.ts";
import type { UpdateChecker } from "@/core/updates/update-checker.ts";
import { UpdateMessage } from "@/core/updates/update-protocol.ts";
import type { connectGoogle } from "@/google/remote/google-client.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { createApiKeyEngine } from "@/live/api-key-engine.ts";
import type { Media } from "@/media/media.ts";
import { createPreviousApp } from "@/overlays/focus/previous-app.ts";
import { createForegroundApi } from "@/overlays/window/win32-api.ts";
import type {
  DisplaysPort,
  EnginesPort,
  GooglePort,
  MicrophonesPort,
  PreviousAppPort,
  UpdatesPort
} from "@/pill/ports.ts";

type GoogleLink = ReturnType<typeof connectGoogle>;

// Both kinds of conversation behind the pill's one factory: the Google engine runs on the UI
// worker and is reached over the link, the API-key engine runs here on its own devices
export function createEnginesPort({ settings, media, google, log }: {
  settings: Settings;
  media: Pick<Media, "createAudioDuplex" | "screenSource">;
  google: Pick<GoogleLink, "createEngine">;
  log: (message: string) => void;
}) {
  const port: EnginesPort = {
    create({ kind, monitor }) {
      const isGoogle = kind === EngineKind.google;
      if (isGoogle) {
        return google.createEngine(monitor);
      }

      return createApiKeyEngine({
        config: {
          apiKey: () => apiKey(settings),
          model: settings.model,
          voice: settings.voice
        },
        monitor,
        audio: media.createAudioDuplex(),
        screen: media.screenSource,
        log
      });
    }
  };
  return port;
}

export function createDisplaysPort(media: Pick<Media, "monitors" | "onDisplaysChanged">) {
  const port: DisplaysPort = {
    all: () => media.monitors.all(),
    active: () => media.monitors.active(),
    reconcile: ({ all, display }) => media.monitors.reconcile({
      current: all,
      display
    }),
    onChanged: listener => media.onDisplaysChanged(() => listener())
  };
  return port;
}

export function createMicrophonesPort(google: Pick<GoogleLink, "microphones">) {
  const port: MicrophonesPort = {
    list: () => google.microphones.list(),
    select: id => google.microphones.select(id)
  };
  return port;
}

// The extension's one-click setup: copy it out, put its folder on the clipboard, open the browser
export function createGooglePort({ extensionDirectory, log }: {
  extensionDirectory: string;
  log: (message: string) => void;
}) {
  const port: GooglePort = {
    beginExtensionSetup() {
      connectExtension({ shippedDir: extensionDirectory }).catch((error: unknown) => {
        log(`extension setup: ${errorMessage(error)}`);
      });
    }
  };
  return port;
}

export function createUpdatesPort({ checker, installed }: {
  checker: UpdateChecker;
  installed: string | undefined;
}) {
  const port: UpdatesPort = {
    installed,
    get ready() {
      return checker.ready;
    },
    check: options => checker.check(options),
    install: () => checker.install(),
    onReadyChanged: listener => checker.events.onMessage(UpdateMessage.readyChanged, () => listener()),
    watch: () => checker.watch()
  };
  return port;
}

// Polls the foreground here on the main thread; the pill's window is ours like every other, so
// the process id alone tells which windows are not the user's app
export function createPreviousAppPort({ delay, log }: {
  delay: (milliseconds: number) => Promise<void>;
  log: (message: string) => void;
}) {
  const port: PreviousAppPort = createPreviousApp({
    api: createForegroundApi(),
    startPolling({ onTick, milliseconds }) {
      const timer = setInterval(onTick, milliseconds);
      return () => clearInterval(timer);
    },
    delay,
    ownProcessId: process.pid,
    ownWindows: () => [],
    log: {
      write: log
    }
  });
  return port;
}
