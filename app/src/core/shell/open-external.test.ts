import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openExternal, openFile } from "./open-external.ts";

function recorder() {
  const launched: {
    file: string;
    args: readonly string[];
  }[] = [];
  return {
    launched,
    launch: (command: { file: string; args: readonly string[] }) => launched.push(command)
  };
}

describe("openExternal", () => {
  it("opens http and https addresses", () => {
    const { launched, launch } = recorder();
    assert.equal(
      openExternal({
        uri: "https://example.com/a b",
        launch
      }),
      true
    );
    assert.equal(
      openExternal({
        uri: "http://example.com",
        launch
      }),
      true
    );
    assert.deepEqual(
      launched.map(command => command.args),
      [["https://example.com/a%20b"], ["http://example.com/"]]
    );
  });

  it("refuses everything else without launching", () => {
    const { launched, launch } = recorder();
    for (const uri of [
      "file:///C:/Windows/notepad.exe",
      "ms-settings:",
      "javascript:alert(1)",
      "calc.exe",
      "C:\\a.exe",
      ""
    ]) {
      assert.equal(
        openExternal({
          uri,
          launch
        }),
        false,
        uri
      );
    }

    assert.deepEqual(launched, []);
  });
});

describe("openFile", () => {
  it("hands the path to Explorer as one argument", () => {
    const { launched, launch } = recorder();
    openFile({
      filePath: "C:\\Temp\\a b.msix",
      launch
    });
    assert.deepEqual(launched, [
      {
        file: "explorer.exe",
        args: ["C:\\Temp\\a b.msix"]
      }
    ]);
  });
});
