import type { MessagePort } from "node:worker_threads";

import { createMessagePortTransport } from "winui-svelte/state/host";

import { publishNativeHost } from "@/core/link/native-host-registration.ts";
import { userSecret } from "@/core/secret/user-secret.ts";
import { createGoogleServices } from "@/google/google-services.ts";
import type { LinkPublisher, SecretSealer } from "@/google/ports.ts";
import { serveGoogle } from "@/google/remote/google-server.ts";
import { dataDir } from "@/lib/paths.ts";
import { createMedia } from "@/media/media.ts";

const sealer: SecretSealer = {
  seal: plain => Promise.resolve(userSecret.seal({ plain })),
  unseal: sealed => Promise.resolve(userSecret.unseal({ sealed }))
};

// The Google account's side: its hidden Gemini and Google Home pages are WebView2 controls, so they
// are built here, on the UI thread; the main thread reaches the engine over the link. Resolves once
// the link is served, and boots the pages and the extension link in the background.
export async function startGoogle({
  port,
  bridgesDirectory,
  audioWorkerUrl,
  uiaWorkerUrl,
  nativeHostPath,
  isDebugging,
  log
}: {
  port: MessagePort;
  bridgesDirectory: string;
  audioWorkerUrl: URL;
  uiaWorkerUrl: URL;
  nativeHostPath: string;
  isDebugging: boolean;
  log: (message: string) => void;
}) {
  const logger = { write: log };
  const publisher: LinkPublisher = {
    publish: link =>
      publishNativeHost({
        link,
        hostPath: nativeHostPath
      })
  };
  const media = createMedia({
    log,
    microphoneId: () => null,
    audioWorkerUrl,
    uiaWorkerUrl
  });
  const services = await createGoogleServices({
    dataDir: dataDir(),
    media: media.mediaPort,
    sealer,
    linkPublisher: publisher,
    monitor: media.monitors.active(),
    log: logger,
    isDebugging,
    bridgesDir: bridgesDirectory
  });
  serveGoogle({
    transport: createMessagePortTransport({ port }),
    services,
    log: logger
  });
  services.warmUp().catch((error: unknown) => log(`google warm-up: ${String(error)}`));
}
