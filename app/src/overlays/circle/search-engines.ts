import { OverlayGlyph } from "@/overlays/glyphs.ts";
import { SearchAction } from "@/overlays/protocol.ts";
import { ImageSearchEngine } from "winui-svelte/image-search";

// Where a result page opens: the results panel beside the screen, or the user's own browser
export const SearchDestination = {
  panel: "panel",
  browser: "browser"
} as const;
export type SearchDestination = typeof SearchDestination[keyof typeof SearchDestination];

// Every engine the crop can be searched with, and what the action bar and the keys say about it.
// The circle searches with an uploaded image, and the library's Yandex and TinEye take only a
// hosted address, so they are not offered; an engine that learns to upload is one more row here
// and one more `SearchAction`
export const SEARCH_ENGINES = {
  [SearchAction.lens]: {
    engine: ImageSearchEngine.GOOGLE_LENS,
    label: "Google Lens",
    glyph: OverlayGlyph.search,
    keys: "l",
    destination: SearchDestination.panel
  },
  [SearchAction.lensInBrowser]: {
    engine: ImageSearchEngine.GOOGLE_LENS,
    label: "Google Lens in your browser",
    glyph: OverlayGlyph.search,
    keys: "o",
    destination: SearchDestination.browser
  },
  [SearchAction.bing]: {
    engine: ImageSearchEngine.BING,
    label: "Bing",
    glyph: OverlayGlyph.search,
    keys: "b",
    destination: SearchDestination.panel
  }
} as const satisfies Record<SearchAction, {
  engine: ImageSearchEngine;
  label: string;
  glyph: string;
  keys: string;
  destination: SearchDestination;
}>;

// The Google results page for a text the user picked out of the screen
export function textSearchUri(text: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

// Google Lens is the action with its own always-visible button; the others (Bing) are reached by
// their key only
export const CORE_SEARCH_ACTION = SearchAction.lens;
