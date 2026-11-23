import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkedTransports } from "@/lib/transport/linked-transports.ts";
import { connectOverlayWindows } from "@/overlays/controller-link.ts";
import { serveOverlayWindows } from "@/overlays/window/window-link.ts";
import { PRIMARY } from "@/pill/testing/fake-monitors.ts";

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

describe("the overlay link", () => {
  it("carries the controller's commands to the windows", async () => {
    const transports = linkedTransports();
    const calls: string[] = [];
    const log = { write: () => undefined };
    serveOverlayWindows({
      transport: transports.second,
      host: {
        coverBorder: ({ monitor }) => calls.push(`cover:${monitor.index}`),
        hideBorder: () => calls.push("hideBorder")
      },
      log
    });
    const { shareBorder } = connectOverlayWindows({
      transport: transports.first,
      log
    });
    shareBorder.cover(PRIMARY);
    shareBorder.hideBorder();
    await settle();
    assert.deepEqual(calls, ["cover:1", "hideBorder"]);
  });
});
