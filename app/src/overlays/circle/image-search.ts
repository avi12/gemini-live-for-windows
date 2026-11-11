import { errorMessage } from "@/lib/error-message.ts";
import type { CropFrame, OverlayLog } from "@/overlays/ports.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import { ImageSearchEngine, imageSearchUrl } from "winui-svelte/image-search";
import type { ImageSearchOptions } from "winui-svelte/image-search";

const CROP_MIME_TYPE = "image/jpeg";

// The circle actions that search the web for the crop, and the engine each one asks
const SEARCH_ENGINES = new Map<CircleAction, ImageSearchEngine>([
  [CircleAction.lens, ImageSearchEngine.GOOGLE_LENS],
  [CircleAction.bing, ImageSearchEngine.BING]
]);

// The engine a circle action searches with, or undefined when the action is not a search
export function searchEngineOf(action: CircleAction) {
  return SEARCH_ENGINES.get(action);
}

// Reverse image search on the crop: the engine takes the upload, and the user's browser opens on
// the result page it answers with. A failure is only logged, as the overlay is long gone
export function createImageSearch({ openUrl, log, findUrl = imageSearchUrl }: {
  openUrl: (uri: string) => void;
  log: OverlayLog;
  findUrl?: (options: ImageSearchOptions) => Promise<string>;
}) {
  async function search({ engine, crop }: {
    engine: ImageSearchEngine;
    crop: CropFrame;
  }) {
    try {
      const url = await findUrl({
        engine,
        image: {
          blob: new Blob([crop.jpeg.slice()], { type: CROP_MIME_TYPE })
        }
      });
      openUrl(url);
    } catch (error) {
      log.write(`${engine} search failed: ${errorMessage(error)}`);
    }
  }

  return { search };
}
