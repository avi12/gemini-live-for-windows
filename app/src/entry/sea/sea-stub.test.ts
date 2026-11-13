import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import sandbox from "node:vm";

import { HOST_ARGUMENT_PREFIX, HOST_MODULE, MAIN_MODULE, seaStubSource } from "./sea-stub.ts";

const EXE_FOLDER = path.join("C:", "Apps", "Gemini Live");

// Runs the real stub source with the dynamic import replaced, and reports which file it asked for.
function fileChosenFor(args: readonly string[]) {
  const source = seaStubSource().replace("import(", "load(");
  let chosen = "";
  function load(url: string) {
    chosen = url;
    return Promise.resolve();
  }
  const fakeProcess = {
    argv: ["exe", "exe", ...args],
    execPath: path.join(EXE_FOLDER, "GeminiLive.exe")
  };
  sandbox.runInNewContext(source, {
    require: createRequire(import.meta.url),
    process: fakeProcess,
    load
  });
  return chosen;
}

describe("seaStubSource", () => {
  it("is valid JavaScript", () => {
    assert.doesNotThrow(() => new sandbox.Script(seaStubSource().replace("import(", "(")));
  });

  it("loads the main module beside the exe for a plain launch", () => {
    assert.ok(fileChosenFor([]).endsWith(`/${MAIN_MODULE}`));
    assert.ok(fileChosenFor(["geminilive-key:?state=Tap"]).endsWith(`/${MAIN_MODULE}`));
  });

  it("encodes the exe folder, spaces included", () => {
    assert.ok(fileChosenFor([]).includes("Gemini%20Live"));
  });

  it("loads the host module when a browser passes its extension origin", () => {
    assert.ok(fileChosenFor([`${HOST_ARGUMENT_PREFIX}abcdefg/`]).endsWith(`/${HOST_MODULE}`));
  });
});
