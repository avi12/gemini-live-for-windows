export const GlyphButtonKind = {
  round: "round",
  share: "share"
} as const;
export type GlyphButtonKind = typeof GlyphButtonKind[keyof typeof GlyphButtonKind];
