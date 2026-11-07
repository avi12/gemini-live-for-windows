// Material Symbols Rounded code points of the icons the overlays draw; the font is cut down to
// these and the pill's by scripts\subset-icons.py
const COPY_CODE_POINT = 0xE14D;
const CLOSE_CODE_POINT = 0xE5CD;
const SEARCH_CODE_POINT = 0xEF7A;
const TEXT_SELECT_CODE_POINT = 0xF735;

export const OverlayGlyph = {
  // content_copy
  copy: String.fromCodePoint(COPY_CODE_POINT),
  // close
  close: String.fromCodePoint(CLOSE_CODE_POINT),
  // search
  search: String.fromCodePoint(SEARCH_CODE_POINT),
  // text_select_start: Circle to Search's "Select text"
  textSelect: String.fromCodePoint(TEXT_SELECT_CODE_POINT)
} as const;
