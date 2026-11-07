import { listCameras } from "./camera.ts";
import { roInitialize } from "@microsoft/dynwinrt";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const IS_WINDOWS = process.platform === "win32";

// Only asks Windows which cameras exist; no camera is opened, so the light stays off
describe("camera list on this machine", { skip: !IS_WINDOWS }, () => {
  it("lists webcams by id and name without opening one", async () => {
    roInitialize();
    const cameras = await listCameras();
    for (const camera of cameras) {
      assert.equal(typeof camera.id, "string");
      assert.ok(camera.name.length > 0);
    }
  });
});
