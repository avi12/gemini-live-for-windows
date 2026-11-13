export const Glyph = {
  CHECK: "",
  COPY: "",
  CHEVRON_DOWN: "",
  CLOSE: "",
  DISPLAY: "",
  GEAR: "",
  LINK: "",
  MIC: "",
  MIC_OFF: "",
  SEARCH: "",
  TEXT_SELECT: ""
} as const;
export type Glyph = (typeof Glyph)[keyof typeof Glyph];
