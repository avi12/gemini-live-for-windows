import { errorMessage } from "@/lib/error-message.ts";
import { SEARCH_ENGINES } from "@/overlays/circle/search-engines.ts";
import type { CropFrame, OverlayLog } from "@/overlays/ports.ts";
import type { CircleAction } from "@/overlays/protocol.ts";
import { isSearchAction } from "@/overlays/protocol.ts";
import { openImageSearch } from "winui-svelte/image-search";
import type { ImageSearchEngine, ImageSearchOptions } from "winui-svelte/image-search";

const CROP_MIME_TYPE = "image/jpeg";

// The engine a circle action searches with, or undefined when the action is not a search
export function searchEngineOf(action: CircleAction) {
  if (!isSearchAction(action)) {
    return undefined;
  }

  return SEARCH_ENGINES[action].engine;
}

// Reverse image search on the crop: the engine takes the upload, and the user's browser opens on
// the result page it answers with. It says whether the page opened: the overlay is long gone, so a
// failure is logged here and the caller decides what the user hears
export function createImageSearch({ log, open = openImageSearch }: {
  log: OverlayLog;
  open?: (options: ImageSearchOptions) => Promise<string>;
}) {
  async function search({ engine, crop }: {
    engine: ImageSearchEngine;
    crop: CropFrame;
  }) {
    try {
      await open({
        engine,
        image: {
          blob: new Blob([crop.jpeg.slice()], { type: CROP_MIME_TYPE })
        }
      });
      return true;
    } catch (error) {
      log.write(`${engine} search failed: ${errorMessage(error)}`);
      return false;
    }
  }

  return { search };
}
