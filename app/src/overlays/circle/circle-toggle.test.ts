import { circlePhase, CirclePhase, circleToggle, CircleToggleAction } from "@/overlays/circle/circle-toggle.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("circlePhase", () => {
  it("is overlayOpen whenever the overlay is up, even with a region focused", () => {
    assert.equal(
      circlePhase({
        isOverlayOpen: true,
        isRegionFocused: true
      }), CirclePhase.overlayOpen
    );
    assert.equal(
      circlePhase({
        isOverlayOpen: true,
        isRegionFocused: false
      }), CirclePhase.overlayOpen
    );
  });

  it("is regionFocused when only Gemini is restricted to a region", () => {
    assert.equal(
      circlePhase({
        isOverlayOpen: false,
        isRegionFocused: true
      }), CirclePhase.regionFocused
    );
  });

  it("is idle otherwise", () => {
    assert.equal(
      circlePhase({
        isOverlayOpen: false,
        isRegionFocused: false
      }), CirclePhase.idle
    );
  });
});

describe("circleToggle", () => {
  it("cancels an open overlay", () => {
    assert.equal(circleToggle(CirclePhase.overlayOpen), CircleToggleAction.cancelOverlay);
  });

  it("hands Gemini the whole display back while a region is focused", () => {
    assert.equal(circleToggle(CirclePhase.regionFocused), CircleToggleAction.focusWholeDisplay);
  });

  it("starts Circle to Search when idle", () => {
    assert.equal(circleToggle(CirclePhase.idle), CircleToggleAction.startCircle);
  });
});
