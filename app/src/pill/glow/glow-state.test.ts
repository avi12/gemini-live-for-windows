import { BREATHING_GLOW, followGlow, REST_GLOW } from "@/pill/glow/glow-state.ts";
import { GlowMode } from "@gemini-live/protocol/view";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("glow", () => {
  it("rests and breathes with no level", () => {
    assert.deepEqual(REST_GLOW, {
      mode: GlowMode.rest,
      level: 0,
      isUser: false
    });
    assert.deepEqual(BREATHING_GLOW, {
      mode: GlowMode.breathe,
      level: 0,
      isUser: false
    });
  });

  it("follows Gemini's voice to the hundredth", () => {
    assert.deepEqual(
      followGlow({
        glow: REST_GLOW,
        level: 0.4349,
        isUser: false
      }), {
        mode: GlowMode.level,
        level: 0.43,
        isUser: false
      }
    );
  });

  it("clamps to 0..1", () => {
    assert.equal(
      followGlow({
        glow: REST_GLOW,
        level: 3,
        isUser: false
      }).level, 1
    );
    assert.equal(
      followGlow({
        glow: REST_GLOW,
        level: -1,
        isUser: false
      }).level, 0
    );
  });

  it("lets Gemini's voice keep the glow while the user is quiet", () => {
    const gemini = followGlow({
      glow: REST_GLOW,
      level: 0.5,
      isUser: false
    });
    assert.equal(
      followGlow({
        glow: gemini,
        level: 0.01,
        isUser: true
      }), gemini
    );
  });

  it("follows a user who speaks up", () => {
    assert.deepEqual(
      followGlow({
        glow: REST_GLOW,
        level: 0.02,
        isUser: true
      }), {
        mode: GlowMode.level,
        level: 0.02,
        isUser: true
      }
    );
  });

  it("follows Gemini even when very quiet", () => {
    assert.equal(
      followGlow({
        glow: REST_GLOW,
        level: 0.001,
        isUser: false
      }).mode, GlowMode.level
    );
  });
});
