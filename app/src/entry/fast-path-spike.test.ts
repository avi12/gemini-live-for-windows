import { formatSpikeLine, isFastPathSpikeRequested, SPIKE_FLAG_FILE } from "./fast-path-spike.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

describe("isFastPathSpikeRequested", () => {
  it("is true only when the flag file sits beside the exe", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "spike-"));
    const executable = path.join(folder, "GeminiLive.exe");
    assert.equal(isFastPathSpikeRequested({ executable }), false);
    fs.writeFileSync(path.join(folder, SPIKE_FLAG_FILE), "");
    assert.equal(isFastPathSpikeRequested({ executable }), true);
    fs.rmSync(folder, { recursive: true });
  });
});

describe("formatSpikeLine", () => {
  it("is one timestamped line", () => {
    assert.equal(
      formatSpikeLine({
        time: new Date(0),
        text: "x"
      }), "1970-01-01T00:00:00.000Z x\n"
    );
  });
});
