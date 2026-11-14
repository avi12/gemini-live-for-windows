import { imageSearchUrl } from "winui-svelte/image-search";
import type { ImageSearchEngine, ImageSearchOptions } from "winui-svelte/image-search";

import { errorMessage } from "@/lib/error-message.ts";
import { SEARCH_ENGINES } from "@/overlays/circle/search-engines.ts";
import type { CropFrame, OverlayLog } from "@/overlays/ports.ts";
import type { CircleAction } from "@/overlays/protocol.ts";
import { isSearchAction } from "@/overlays/protocol.ts";

const CROP_MIME_TYPE = "image/jpeg";

// The engine a circle action searches with, or undefined when the action is not a search
export function searchEngineOf(action: CircleAction) {
  if (!isSearchAction(action)) {
    return undefined;
  }

  return SEARCH_ENGINES[action].engine;
}

// Reverse image search on the crop: the engine takes the upload and answers with the address of its
// result page, which the results panel shows. A failure is logged here and gives no address; the
// caller decides what the user hears
export function createImageSearch({
  log,
  resolve = imageSearchUrl
}: {
  log: OverlayLog;
  resolve?: (options: ImageSearchOptions) => Promise<string>;
}) {
  async function search({ engine, crop }: { engine: ImageSearchEngine; crop: CropFrame }) {
    try {
      return await resolve({
        engine,
        image: {
          blob: new Blob([crop.jpeg.slice()], { type: CROP_MIME_TYPE })
        }
      });
    } catch (error) {
      log.write(`${engine} search failed: ${errorMessage(error)}`);
      return undefined;
    }
  }

  return { search };
}
