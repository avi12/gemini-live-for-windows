import assert from "node:assert/strict";
import { test } from "node:test";

import { reassertTopmost } from "@/pill/host/window/topmost.ts";

test("the topmost flag is turned off and on again, so Windows applies it", () => {
  const writes: boolean[] = [];
  const presenter = {
    get isAlwaysOnTop() {
      return writes.at(-1) ?? false;
    },
    set isAlwaysOnTop(isTop: boolean) {
      writes.push(isTop);
    }
  };

  reassertTopmost(presenter);

  assert.deepEqual(writes, [false, true]);
});
