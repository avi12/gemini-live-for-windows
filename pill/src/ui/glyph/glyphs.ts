export const Glyph = {
  CHECK: "",
  COPY: "",
  CHEVRON_DOWN: "",
  CLOSE: "",
  DISPLAY: "",
  GEAR: "",
  LAUNCH: "",
  LINK: "",
  SEARCH: ""
} as const;
export type Glyph = (typeof Glyph)[keyof typeof Glyph];
