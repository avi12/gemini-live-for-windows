import type { Transport } from "winui-svelte/state/host";

import { copyTextWithPowerShell } from "@/lib/clipboard.ts";
import type { Media } from "@/media/media.ts";
import { createImageSearch, searchEngineOf } from "@/overlays/circle/image-search.ts";
import { createCircleSession } from "@/overlays/circle/session.ts";
import { connectOverlayWindows } from "@/overlays/controller-link.ts";
import { createScreenFocus } from "@/overlays/focus/screen-focus.ts";
import type { SearchCircle } from "@/overlays/protocol.ts";
import type { ScreenFocusOptions, ScreenFocusPort } from "@/pill/ports.ts";
import { createCircleEntry } from "@/wiring/main-thread/circle-entry.ts";
import type { CircleEntryController } from "@/wiring/main-thread/circle-entry.ts";

function toCircleText(lines: Awaited<ReturnType<ReturnType<typeof createCircleSession>["readText"]>>) {
  return lines.map(line => ({
    words: line.words.map(word => ({
      text: word.text,
      bounds: {
        ...word.bounds
      }
    }))
  }));
}

async function searchCircle({
  action,
  region,
  session,
  imageSearch
}: SearchCircle & {
  session: ReturnType<typeof createCircleSession>;
  imageSearch: ReturnType<typeof createImageSearch>;
}) {
  const engine = searchEngineOf(action);
  const crop = await session.crop(region);
  const isSearchable = engine !== undefined && crop !== undefined;
  if (!isSearchable) {
    return "";
  }

  return (
    (await imageSearch.search({
      engine,
      crop
    })) ?? ""
  );
}

// The main thread's side of Circle to Search and the share border: the windows and hotkeys run on
// the UI worker, so this turns what they report into the pill controller's calls and back
export function createOverlayControl({
  transport,
  media,
  controller,
  log
}: {
  transport: Transport;
  media: Pick<Media, "circleScreen" | "monitors">;
  // The controller is built over the focus this creates, so it is reached on demand
  controller: () => CircleEntryController;
  log: (message: string) => void;
}) {
  const overlayLog = { write: log };
  let focus: ReturnType<typeof createScreenFocus> | undefined;
  let currentEngine: ScreenFocusOptions["currentEngine"] | undefined;

  const link = connectOverlayWindows({
    transport,
    log: overlayLog,
    events: {
      focusEscapePressed: () => focus?.events.escapePressed(),
      chipDismissed: () => focus?.events.chipDismissed(),
      chipDragStarted: () => focus?.events.chipDragStarted(),
      chipDragged: travelled => focus?.events.chipDragged(travelled),
      async readChipText() {
        const engine = currentEngine?.();
        const region = engine?.region;
        const isNothingWatched = engine === undefined || region === undefined;
        if (isNothingWatched) {
          return false;
        }

        const lines = await session.readLive({
          monitor: engine.monitor,
          region
        });
        const text = lines.map(line => line.words.map(word => word.text).join(" ")).join("\n");
        const isEmpty = text.trim() === "";
        if (isEmpty) {
          return false;
        }

        await copyTextWithPowerShell(text);
        return true;
      },
      circleKeyPressed() {
        void circle();
      },
      readCircleText: async ({ region }) => toCircleText(await session.readText(region)),
      searchCircle: options =>
        searchCircle({
          ...options,
          session,
          imageSearch
        }),
      async searchRegion({ action, monitor, region }) {
        const engine = searchEngineOf(action);
        const crop = await session.cropLive({
          monitor,
          region
        });
        const isSearchable = engine !== undefined;
        if (!isSearchable) {
          return "";
        }

        return (
          (await imageSearch.search({
            engine,
            crop
          })) ?? ""
        );
      },
      scanCircleCodes: async ({ region }) => [...(await session.scanCodes(region))]
    }
  });
  const session = createCircleSession({
    screen: media.circleScreen,
    openOverlay: link.openCircle,
    closeOverlay: link.closeCircle,
    setCircling: isCircling => focus?.setCircling(isCircling),
    log: overlayLog
  });
  const imageSearch = createImageSearch({ log: overlayLog });

  const circle = createCircleEntry({
    media,
    controller,
    session,
    log
  });

  function createFocus(options: ScreenFocusOptions) {
    currentEngine = options.currentEngine;
    focus = createScreenFocus({
      windows: link.windows,
      currentEngine: options.currentEngine,
      log: overlayLog
    });
    const port: ScreenFocusPort = focus;
    return port;
  }

  return {
    circle,
    createFocus,
    close: () => link.close()
  };
}
