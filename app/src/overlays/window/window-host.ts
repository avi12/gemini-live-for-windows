import type { ComponentProps } from "svelte";
import { mountControl } from "winui-svelte";

import ShareBorder from "@/overlays/share-border/share-border.svelte";
import type { OverlayWindowHost } from "@/overlays/window/window-link.ts";

function mountShareBorder() {
  const props: ComponentProps<typeof ShareBorder> = { bounds: undefined };
  return mountControl({
    component: ShareBorder,
    props
  });
}

// The windows themselves, on the UI worker after the message pump started: the share border round
// the display Gemini sees. The controller reaches it over the overlay link (window-link.ts)
export function createOverlayWindowHost() {
  const border = mountShareBorder();

  return {
    coverBorder: ({ monitor }) => border.set({ bounds: monitor }),
    hideBorder: () => border.set({ bounds: undefined })
  } satisfies OverlayWindowHost;
}
