import type { Place } from "@/ui/window/places.svelte.ts";

// The window shows only what is there and takes clicks only there: the folded orb once it has
// settled; otherwise the band from the card's top (or the pill's, with no card) down, with room for
// the glow above it
const CLIP_MARGIN = 2;
const GLOW_ROOM = 16;

// A place's top in the window's physical pixels. Places are measured against the root, which sits on
// the window's bottom edge, so it is counted up from there: true whatever the root starts at
function windowTopOf({
  y,
  root,
  clientHeight,
  scale
}: {
  y: number;
  root: Place;
  clientHeight: number;
  scale: number;
}) {
  return clientHeight - (root.y + root.height - y) * scale;
}

/**
 * The part of the window to show, in its physical pixels.
 *
 * @param options - The pill's, card's and root's places, the window's scale and client size, and
 * whether the folded orb has settled.
 * @returns The region around the orb when it has settled; otherwise the full-width band from the top
 * of the card or pill down.
 */
export function regionOf({
  pill,
  card,
  root,
  scale,
  client,
  isOrb
}: {
  pill: Place;
  card: Place | undefined;
  root: Place;
  scale: number;
  client: {
    width: number;
    height: number;
  };
  isOrb: boolean;
}) {
  if (isOrb) {
    const top = windowTopOf({
      y: pill.y,
      root,
      clientHeight: client.height,
      scale
    });
    return {
      x: Math.max(0, Math.floor(pill.x * scale) - CLIP_MARGIN),
      y: Math.max(0, Math.floor(top) - CLIP_MARGIN),
      width: Math.ceil(pill.width * scale) + CLIP_MARGIN * 2,
      height: Math.ceil(pill.height * scale) + CLIP_MARGIN * 2
    };
  }

  const top = windowTopOf({
    y: Math.min(pill.y, card?.y ?? Infinity) - GLOW_ROOM,
    root,
    clientHeight: client.height,
    scale
  });
  const y = Math.max(0, Math.floor(top));
  return {
    x: 0,
    y,
    width: client.width,
    height: client.height - y
  };
}
