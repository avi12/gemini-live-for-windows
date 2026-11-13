import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OverlayMotion } from "@/overlays/motion/motion.ts";
import { riseIn, settleIn, sheenIn, TransformOrigin } from "@/overlays/motion/transitions.ts";

const MIDDLE = 0.5;
const RISE = 24;
const SCALE_FROM = 0.94;
const SHEEN = 0.45;

function configOf(
  transition: (node: unknown) => {
    duration: number;
    css(progress: number): string;
  }
) {
  return transition(undefined);
}

describe("riseIn", () => {
  const transition = riseIn({
    rise: RISE,
    scaleFrom: SCALE_FROM,
    isReduced: false
  });

  it("lasts the enter duration", () => {
    assert.equal(configOf(transition).duration, OverlayMotion.ENTER_MILLISECONDS);
  });

  it("starts transparent, low and small", () => {
    const css = configOf(transition).css(0);
    assert.ok(css.includes("opacity: 0;"));
    assert.ok(css.includes(`translate: 0 ${RISE}px`));
    assert.ok(css.includes(`scale: ${SCALE_FROM}`));
  });

  it("ends opaque, in place and full size", () => {
    const css = configOf(transition).css(1);
    assert.ok(css.includes("opacity: 1;"));
    assert.ok(css.includes("translate: 0 0px"));
    assert.ok(css.includes("scale: 1;"));
  });

  it("scales about the bottom unless told otherwise", () => {
    assert.ok(configOf(transition).css(MIDDLE).endsWith(TransformOrigin.BOTTOM));
  });

  it("takes no time with reduced motion", () => {
    assert.equal(
      configOf(
        riseIn({
          rise: RISE,
          isReduced: true
        })
      ).duration,
      0
    );
  });

  it("never uses the transform shorthand", () => {
    assert.equal(/(^|[^-])transform:/.test(configOf(transition).css(MIDDLE)), false);
  });
});

describe("settleIn", () => {
  it("settles about the centre without moving", () => {
    const css = configOf(
      settleIn({
        scaleFrom: SCALE_FROM,
        isReduced: false
      })
    ).css(0);
    assert.ok(css.includes("translate: 0 0px"));
    assert.ok(css.endsWith(TransformOrigin.CENTER));
  });
});

describe("sheenIn", () => {
  const transition = sheenIn({
    from: SHEEN,
    isReduced: false
  });

  it("starts at its opacity and fades to nothing", () => {
    assert.equal(configOf(transition).css(0), `opacity: ${SHEEN}`);
    assert.equal(configOf(transition).css(1), "opacity: 0");
  });
});
