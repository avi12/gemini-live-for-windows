import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const THEME = readFileSync(new URL("../../../../pill/src/ui/theme.css", import.meta.url), "utf8");
const AA_RATIO = 4.5;
const HEX_RADIX = 16;
const LINEAR_THRESHOLD = 0.03928;
const LINEAR_DIVISOR = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_DIVISOR = 1.055;
const GAMMA_EXPONENT = 2.4;
const FLARE = 0.05;
const CHANNEL_MAX = 255;
const CHANNELS = [
  {
    start: 1,
    weight: 0.2126
  },
  {
    start: 3,
    weight: 0.7152
  },
  {
    start: 5,
    weight: 0.0722
  }
];

// The token block of a theme: the base `:root`, or the one inside the dark media query
function tokens(block: string) {
  const values = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--(?:live|circle)-[a-z-]+):\s*(#[0-9a-f]{6}|var\(--[a-z-]+\))\s*;/g)) {
    values.set(name ?? "", value ?? "");
  }

  return values;
}

function luminance(hex: string) {
  let sum = 0;
  for (const { start, weight } of CHANNELS) {
    const channel = Number.parseInt(hex.slice(start, start + 2), HEX_RADIX) / CHANNEL_MAX;
    const isDark = channel <= LINEAR_THRESHOLD;
    const linear = isDark ? channel / LINEAR_DIVISOR : ((channel + GAMMA_OFFSET) / GAMMA_DIVISOR) ** GAMMA_EXPONENT;
    sum += linear * weight;
  }

  return sum;
}

function contrast({ foreground, background }: { foreground: string; background: string }) {
  const [light = 0, dark = 0] = [luminance(foreground), luminance(background)].sort((first, second) => second - first);
  return (light + FLARE) / (dark + FLARE);
}

const [LIGHT_BLOCK = "", DARK_BLOCK = ""] = THEME.split("@media (prefers-color-scheme: dark)");
const THEMES = new Map([
  ["light", tokens(LIGHT_BLOCK)],
  ["dark", new Map([...tokens(LIGHT_BLOCK), ...tokens(DARK_BLOCK)])]
]);
const ROLE_PAIRS = [
  ["--circle-on-primary", "--circle-primary"],
  ["--circle-on-primary", "--circle-primary-hover"],
  ["--circle-on-primary", "--circle-primary-pressed"],
  ["--circle-on-secondary", "--circle-secondary"],
  ["--circle-on-secondary", "--circle-secondary-hover"],
  ["--circle-on-secondary", "--circle-secondary-pressed"],
  ["--live-inverse-text", "--live-inverse-surface"],
  ["--live-text", "--live-menu-surface"]
] as const;

function resolve({ values, name }: { values: ReadonlyMap<string, string>; name: string }) {
  const value = values.get(name) ?? "";
  const reference = /^var\((--[a-z-]+)\)$/.exec(value);
  const isReference = reference !== null;
  if (isReference) {
    return resolve({
      values,
      name: reference[1] ?? ""
    });
  }

  return value;
}

describe("the circle action roles", () => {
  for (const [themeName, values] of THEMES) {
    for (const [on, fill] of ROLE_PAIRS) {
      it(`${on} on ${fill} meets WCAG AA in ${themeName}`, () => {
        const ratio = contrast({
          foreground: resolve({
            values,
            name: on
          }),
          background: resolve({
            values,
            name: fill
          })
        });
        assert.ok(ratio >= AA_RATIO, `${ratio.toFixed(2)}:1`);
      });
    }
  }
});
