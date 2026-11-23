import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeDisplay, findSharedDisplayName, nameDisplay } from "./display-labels.ts";

const PRIMARY = {
  id: "d1",
  index: 1,
  isPrimary: true,
  width: 1920,
  height: 1080
};
const SECONDARY = {
  id: "d2",
  index: 2,
  isPrimary: false,
  width: 2560,
  height: 1440
};

describe("display labels", () => {
  it("names a display by its index", () => {
    assert.equal(nameDisplay(SECONDARY), "Display 2");
  });

  it("describes the primary with its size", () => {
    assert.equal(describeDisplay(PRIMARY), "Display 1 (primary) · 1920×1080");
  });

  it("describes a secondary without the primary mark", () => {
    assert.equal(describeDisplay(SECONDARY), "Display 2 · 2560×1440");
  });

  it("finds the shared display's name", () => {
    assert.equal(
      findSharedDisplayName({
        displays: [PRIMARY, SECONDARY],
        sharedDisplayId: "d2"
      }),
      "Display 2"
    );
  });

  it("has no shared name when nothing is shared or the display left", () => {
    assert.equal(
      findSharedDisplayName({
        displays: [PRIMARY],
        sharedDisplayId: null
      }),
      null
    );
    assert.equal(
      findSharedDisplayName({
        displays: [PRIMARY],
        sharedDisplayId: "gone"
      }),
      null
    );
  });
});
