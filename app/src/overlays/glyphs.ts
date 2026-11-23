// Material Symbols Rounded code points of the icons the overlays draw; the font is cut down to
// these and the pill's by scripts\subset-icons.py
const CLOSE_CODE_POINT = 0xe5cd;

export const OverlayGlyph = {
  // close
  close: String.fromCodePoint(CLOSE_CODE_POINT)
} as const;
