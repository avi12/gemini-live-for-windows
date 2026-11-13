export const GlyphButtonKind = {
  ROUND: "round",
  ACCENT: "accent"
} as const;
export type GlyphButtonKind = (typeof GlyphButtonKind)[keyof typeof GlyphButtonKind];
