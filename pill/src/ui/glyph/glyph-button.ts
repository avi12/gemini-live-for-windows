export const GlyphButtonKind = {
  round: "round",
  accent: "accent"
} as const;
export type GlyphButtonKind = typeof GlyphButtonKind[keyof typeof GlyphButtonKind];
