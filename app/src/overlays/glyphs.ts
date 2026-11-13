// Material Symbols Rounded code points of the icons the overlays draw; the font is cut down to
// these and the pill's by scripts\subset-icons.py
const COPY_CODE_POINT = 0xe14d;
const CLOSE_CODE_POINT = 0xe5cd;
const SEARCH_CODE_POINT = 0xef7a;
const TEXT_SELECT_CODE_POINT = 0xf735;

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
