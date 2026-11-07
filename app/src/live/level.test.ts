import { micLevel, speakerLevel } from "@/live/level.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const LOUD = 0.8;
const QUIET = 0.4;
const TOO_LOUD = 1.7;
const TOO_QUIET = -0.2;

describe("levels", () => {
  it("reads a muted mic as silent", () => {
    assert.equal(
      micLevel({
        peak: LOUD,
        isMuted: true
      }), 0
    );
  });

  it("passes an unmuted peak through", () => {
    assert.equal(
      micLevel({
        peak: QUIET,
        isMuted: false
      }), QUIET
    );
  });

  it("clamps to 0..1", () => {
    assert.equal(speakerLevel(TOO_LOUD), 1);
    assert.equal(speakerLevel(TOO_QUIET), 0);
  });
});
