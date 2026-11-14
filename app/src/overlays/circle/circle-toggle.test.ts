import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { circlePhase, CirclePhase, circleToggle, CircleToggleAction } from "@/overlays/circle/circle-toggle.ts";

describe("circlePhase", () => {
  it("is overlayOpen whenever the overlay is up, even with a region focused", () => {
    assert.equal(
      circlePhase({
        isOverlayOpen: true,
        isRegionFocused: true
      }),
      CirclePhase.OVERLAY_OPEN
    );
    assert.equal(
      circlePhase({
        isOverlayOpen: true,
        isRegionFocused: false
      }),
      CirclePhase.OVERLAY_OPEN
    );
  });

  it("is regionFocused when only Gemini is restricted to a region", () => {
    assert.equal(
      circlePhase({
        isOverlayOpen: false,
        isRegionFocused: true
      }),
      CirclePhase.REGION_FOCUSED
    );
  });

  it("is idle otherwise", () => {
    assert.equal(
      circlePhase({
        isOverlayOpen: false,
        isRegionFocused: false
      }),
      CirclePhase.IDLE
    );
  });
});

describe("circleToggle", () => {
  it("cancels an open overlay", () => {
    assert.equal(circleToggle(CirclePhase.OVERLAY_OPEN), CircleToggleAction.CANCEL_OVERLAY);
  });

  it("hands Gemini the whole display back while a region is focused", () => {
    assert.equal(circleToggle(CirclePhase.REGION_FOCUSED), CircleToggleAction.FOCUS_WHOLE_DISPLAY);
  });

  it("starts Circle to Search when idle", () => {
    assert.equal(circleToggle(CirclePhase.IDLE), CircleToggleAction.START_CIRCLE);
  });
});
