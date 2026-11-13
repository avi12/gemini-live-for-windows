import assert from "node:assert/strict";
import fileSystem from "node:fs";
import operatingSystem from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { formatSpikeLine, isFastPathSpikeRequested, SPIKE_FLAG_FILE } from "./fast-path-spike.ts";

describe("isFastPathSpikeRequested", () => {
  it("is true only when the flag file sits beside the exe", () => {
    const folder = fileSystem.mkdtempSync(path.join(operatingSystem.tmpdir(), "spike-"));
    const executable = path.join(folder, "GeminiLive.exe");
    assert.equal(isFastPathSpikeRequested({ executable }), false);
    fileSystem.writeFileSync(path.join(folder, SPIKE_FLAG_FILE), "");
    assert.equal(isFastPathSpikeRequested({ executable }), true);
    fileSystem.rmSync(folder, { recursive: true });
  });
});

describe("formatSpikeLine", () => {
  it("is one timestamped line", () => {
    assert.equal(
      formatSpikeLine({
        time: new Date(0),
        text: "x"
      }),
      "1970-01-01T00:00:00.000Z x\n"
    );
  });
});
