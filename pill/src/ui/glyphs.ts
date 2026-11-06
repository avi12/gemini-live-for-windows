export const Glyph = {
  check: "",
  copy: "",
  chevronDown: "",
  close: "",
  display: "",
  gear: "",
  link: "",
  mic: "",
  micOff: "",
  search: "",
  textSelect: ""
} as const;
export type Glyph = typeof Glyph[keyof typeof Glyph];
