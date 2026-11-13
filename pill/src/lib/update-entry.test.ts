import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeUpdateEntry } from "./update-entry.ts";

describe("update entry", () => {
  it("offers a check when nothing is ready", () => {
    assert.deepEqual(
      describeUpdateEntry({
        readyVersion: null,
        isAutoUpdateOn: true
      }),
      {
        kind: "checkForUpdates",
        text: "Check for updates"
      }
    );
  });

  it("offers a restart into a ready version", () => {
    assert.deepEqual(
      describeUpdateEntry({
        readyVersion: "2.0.0",
        isAutoUpdateOn: false
      }),
      {
        kind: "update",
        text: "Restart to update to 2.0.0"
      }
    );
  });
});
