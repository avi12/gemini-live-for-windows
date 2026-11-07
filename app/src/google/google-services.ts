import { createSessionStore } from "./cookies.ts";
import type { SessionStore } from "./cookies.ts";
import { createGlicHost } from "./glic-host.ts";
import { createGoogleEngine } from "./google-engine.ts";
import { createHomeHost } from "./home-host.ts";
import type { LinkPublisher, Logger, MediaPort, SecretSealer } from "./ports.ts";
import { createSessionLink } from "./session-link.ts";
import type { SessionSource } from "./session-link.ts";
import { createSharedView } from "./shared-view.ts";
import type { SharedView } from "./shared-view.ts";
import { BridgeName, readBridgeScript } from "./web-host/bridge-script.ts";
import { createWinUiWebViewFactory } from "./web-host/winui-web-view.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import path from "node:path";

const SESSION_FILE = "google-session.bin";
const GLIC_PROFILE = "WebView2";
const HOME_PROFILE = "WebView2Home";
const GLIC_WINDOW = {
  title: "Gemini Live - web client",
  width: 900,
  height: 720,
  logTag: "glic"
} as const;
// Wide enough that the device grid lays out, not the phone view
const HOME_WINDOW = {
  title: "Gemini Live - Home",
  width: 1100,
  height: 900,
  logTag: "home"
} as const;

function now() {
  return Date.now();
}

// What both hidden pages are built from
interface PageParts {
  dataDir: string;
  link: SessionSource;
  store: SessionStore;
  log: Logger;
  isDebugging: boolean;
}

function webViewFactory({ window, profile, parts }: {
  window: typeof GLIC_WINDOW | typeof HOME_WINDOW;
  profile: string;
  parts: PageParts;
}) {
  return createWinUiWebViewFactory({
    spec: {
      ...window,
      profileDir: path.join(parts.dataDir, profile)
    },
    log: parts.log
  });
}

async function readBridges(directory: string | undefined) {
  const options = directory === undefined ? {} : { directory };
  const [glic, home] = await Promise.all([
    readBridgeScript({
      name: BridgeName.glic,
      ...options
    }),
    readBridgeScript({
      name: BridgeName.home,
      ...options
    })
  ]);
  return {
    glic,
    home
  };
}

// The two long-lived hidden pages, each in a WebView2 of its own profile
async function createPages({ parts, view, bridgesDir }: {
  parts: PageParts;
  view: SharedView;
  bridgesDir: string | undefined;
}) {
  const bridges = await readBridges(bridgesDir);
  const { link, store, log, isDebugging } = parts;
  const glic = createGlicHost({
    factory: webViewFactory({
      window: GLIC_WINDOW,
      profile: GLIC_PROFILE,
      parts
    }),
    bridgeScript: bridges.glic,
    link,
    store,
    view,
    log,
    now,
    isDebugging
  });
  const home = createHomeHost({
    factory: webViewFactory({
      window: HOME_WINDOW,
      profile: HOME_PROFILE,
      parts
    }),
    bridgeScript: bridges.home,
    link,
    store,
    log,
    now,
    isDebugging
  });
  return {
    glic,
    home
  };
}

// The Google-account side of the app, wired once: the session link to the extension, the two
// long-lived hidden pages (Gemini's glic page and Google Home) and a factory for the engine the pill
// controller starts. Everything it needs from outside arrives as a port. Runs on the UI worker, the
// thread the pages' WebView2 controls belong to.
export async function createGoogleServices({
  dataDir,
  media,
  sealer,
  linkPublisher,
  monitor,
  log,
  isDebugging,
  bridgesDir
}: {
  // The app's data folder (%LOCALAPPDATA%\GeminiLive): profiles and the sealed session live here
  dataDir: string;
  media: MediaPort;
  sealer: SecretSealer;
  linkPublisher: LinkPublisher;
  monitor: Monitor;
  log: Logger;
  isDebugging: boolean;
  bridgesDir?: string;
}) {
  const link = createSessionLink({
    log,
    publisher: linkPublisher
  });
  const view = createSharedView({
    media,
    monitor,
    log
  });
  const { glic, home } = await createPages({
    parts: {
      dataDir,
      link: link.source,
      store: createSessionStore({
        filePath: path.join(dataDir, SESSION_FILE),
        sealer,
        log
      }),
      log,
      isDebugging
    },
    view,
    bridgesDir
  });

  return googleServices({
    link,
    view,
    glic,
    home,
    log
  });
}

function googleServices({ link, view, glic, home, log }: {
  link: ReturnType<typeof createSessionLink>;
  view: ReturnType<typeof createSharedView>;
  glic: Awaited<ReturnType<typeof createPages>>["glic"];
  home: Awaited<ReturnType<typeof createPages>>["home"];
  log: Logger;
}) {
  return {
    // Boots the link and both pages at app start, so the first use doesn't wait for Chromium
    async warmUp() {
      await link.start();
      await Promise.all([glic.warmUp(), home.warmUp()]);
    },
    stop: () => link.stop(),
    // One engine per Live session, on the shared long-lived pages, sharing `shared` to begin with
    createEngine(shared: Monitor) {
      view.monitor = shared;
      view.region = undefined;
      return createGoogleEngine({
        host: glic,
        home,
        view,
        log,
        now
      });
    },
    setMicrophone: glic.setMicrophone,
    listMicrophones: glic.listMicrophones
  };
}
