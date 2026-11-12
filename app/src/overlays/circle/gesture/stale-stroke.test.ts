import { withoutStaleStroke } from "@/overlays/circle/gesture/stale-stroke.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSelector, SelectionPhase } from "winui-svelte/selection";

const STROKE = [{
  x: 1,
  y: 2
}, {
  x: 30,
  y: 40
}];

function stateIn(phase: SelectionPhase) {
  return {
    ...createSelector({
      bounds: {
        width: 100,
        height: 100
      }
    }),
    phase,
    stroke: STROKE
  };
}

describe("withoutStaleStroke", () => {
  it("keeps the loop while drawing", () => {
    const state = stateIn(SelectionPhase.draw);
    assert.equal(
      withoutStaleStroke({
        state,
        isStrokeFaded: true
      }).stroke,
      STROKE
    );
  });

  it("keeps the loop while it fades after release", () => {
    const state = stateIn(SelectionPhase.idle);
    assert.equal(
      withoutStaleStroke({
        state,
        isStrokeFaded: false
      }).stroke,
      STROKE
    );
  });

  it("drops the loop once it has faded", () => {
    const state = stateIn(SelectionPhase.idle);
    assert.deepEqual(
      withoutStaleStroke({
        state,
        isStrokeFaded: true
      }).stroke,
      []
    );
  });

  it("drops the loop when the selection moves or resizes", () => {
    for (const phase of [SelectionPhase.move, SelectionPhase.resize]) {
      const state = stateIn(phase);
      assert.deepEqual(
        withoutStaleStroke({
          state,
          isStrokeFaded: false
        }).stroke,
        []
      );
    }
  });
});
