import { compareVersions, parseVersion } from "./version.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("version", () => {
  it("pads missing parts with zero", () => {
    assert.deepEqual(parseVersion("1.2"), [1, 2, 0, 0]);
    assert.deepEqual(parseVersion("0.1.0.0"), [0, 1, 0, 0]);
  });

  it("rejects what .NET's Version rejects", () => {
    for (const text of ["1", "1.2.3.4.5", "a.b", "1..2", "v1.2", "1.2-beta", ""]) {
      assert.equal(parseVersion(text), undefined, text);
    }
  });

  it("compares part by part, numerically", () => {
    assert.equal(
      compareVersions({
        left: "0.1.0.1",
        right: "0.1.0.0"
      }), 1
    );
    assert.equal(
      compareVersions({
        left: "0.9.0.0",
        right: "0.10.0.0"
      }), -1
    );
    assert.equal(
      compareVersions({
        left: "1.0",
        right: "1.0.0.0"
      }), 0
    );
  });

  it("throws on a malformed version", () => {
    assert.throws(() => compareVersions({
      left: "x",
      right: "1.0"
    }), RangeError);
  });
});
