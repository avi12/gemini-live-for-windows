import { OverlayGlyph } from "@/overlays/glyphs.ts";
import { SearchAction } from "@/overlays/protocol.ts";
import { ImageSearchEngine } from "winui-svelte/image-search";

// Every engine the crop can be searched with, and what the action bar and the keys say about it.
// The circle searches with an uploaded image, and the library's Yandex and TinEye take only a
// hosted address, so they are not offered; an engine that learns to upload is one more row here
// and one more `SearchAction`
export const SEARCH_ENGINES = {
  [SearchAction.lens]: {
    engine: ImageSearchEngine.GOOGLE_LENS,
    label: "Google Lens",
    glyph: OverlayGlyph.search,
    keys: "l"
  },
  [SearchAction.bing]: {
    engine: ImageSearchEngine.BING,
    label: "Bing",
    glyph: OverlayGlyph.search,
    keys: "b"
  }
} as const satisfies Record<SearchAction, {
  engine: ImageSearchEngine;
  label: string;
  glyph: string;
  keys: string;
}>;

// Google Lens is a core action with its own always-visible button and stays the default; every other
// engine sits behind the bar's small chooser
export const CORE_SEARCH_ACTION = SearchAction.lens;

// The other engines in the order the chooser lists them: the one chosen last first
export function extraSearchActions(preferred: SearchAction) {
  const extras = Object.values(SearchAction).filter(action => action !== CORE_SEARCH_ACTION);
  const lastChosen = extras.filter(action => action === preferred);
  const rest = extras.filter(action => action !== preferred);
  return [...lastChosen, ...rest];
}
