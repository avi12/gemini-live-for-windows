import type { Monitor } from "@/contracts/monitor.ts";
import { createCircleSession } from "@/overlays/circle/session.ts";
import type { CircleScreen, FrozenScreen } from "@/overlays/ports.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import type { CircleOutcome, OpenCircle } from "@/overlays/protocol.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const MONITOR: Monitor = {
  deviceName: "\\.DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1040
};
const STILL_BYTES = Buffer.from("still");
const CROP_BYTES = Buffer.from("crop");
const FROZEN: FrozenScreen = {
  monitor: MONITOR,
  width: 1920,
  height: 1080,
  jpeg: STILL_BYTES
};
const REGION = {
  x: 10,
  y: 20,
  width: 300,
  height: 200
};
const CROP = {
  jpeg: CROP_BYTES,
  width: 300,
  height: 200
};

function setup({ outcome, isFreezeFailing = false }: {
  outcome: CircleOutcome | Error;
  isFreezeFailing?: boolean;
}) {
  const steps: string[] = [];
  const opened: OpenCircle[] = [];
  const lines: string[] = [];
  const screen: CircleScreen = {
    async freeze() {
      steps.push("freeze");

      if (isFreezeFailing) {
        throw new Error("no capture");
      }

      return FROZEN;
    },
    async crop() {
      steps.push("crop");
      return CROP;
    },
    async readText() {
      steps.push("readText");
      return [];
    }
  };
  const gate = Promise.withResolvers<void>();
  const session = createCircleSession({
    screen,
    async openOverlay(options) {
      steps.push("open");
      opened.push(options);
      await gate.promise;

      const isFailure = outcome instanceof Error;
      if (isFailure) {
        throw outcome;
      }

      return outcome;
    },
    setCircling: isCircling => steps.push(`circling:${isCircling}`),
    log: {
      write: message => lines.push(message)
    }
  });
  return {
    session,
    steps,
    opened,
    lines,
    release: () => gate.resolve()
  };
}

describe("createCircleSession", () => {
  it("freezes before the window, releases Esc around the overlay, and crops the answer", async () => {
    const { session, steps, opened, release } = setup({
      outcome: {
        isCancelled: false,
        action: CircleAction.lens,
        region: REGION
      }
    });
    const pending = session.select({
      monitor: MONITOR,
      isAskOnRelease: false
    });
    release();
    const selection = await pending;
    assert.deepEqual(steps, ["freeze", "circling:true", "open", "circling:false", "crop"]);
    assert.deepEqual(selection, {
      action: CircleAction.lens,
      crop: CROP,
      region: REGION,
      monitor: MONITOR
    });
    assert.deepEqual(opened[0], {
      monitor: MONITOR,
      stillJpegBase64: STILL_BYTES.toString("base64"),
      stillWidth: 1920,
      stillHeight: 1080,
      isAskOnRelease: false
    });
  });

  it("passes the ask-on-release mode through", async () => {
    const { session, opened, release } = setup({
      outcome: {
        isCancelled: false,
        action: CircleAction.askGemini,
        region: REGION
      }
    });
    const pending = session.select({
      monitor: MONITOR,
      isAskOnRelease: true
    });
    release();
    await pending;
    assert.equal(opened[0]?.isAskOnRelease, true);
  });

  it("is undefined on cancel, with no crop", async () => {
    const { session, steps, release } = setup({
      outcome: {
        isCancelled: true
      }
    });
    const pending = session.select({
      monitor: MONITOR,
      isAskOnRelease: false
    });
    release();
    assert.equal(await pending, undefined);
    assert.equal(steps.includes("crop"), false);
    assert.equal(steps.at(-1), "circling:false");
  });

  it("ignores a second request while open", async () => {
    const { session, steps, release } = setup({
      outcome: {
        isCancelled: true
      }
    });
    const first = session.select({
      monitor: MONITOR,
      isAskOnRelease: false
    });
    const second = await session.select({
      monitor: MONITOR,
      isAskOnRelease: false
    });
    assert.equal(second, undefined);
    release();
    await first;
    assert.equal(steps.filter(step => step === "freeze").length, 1);
  });

  it("can be opened again after it closed", async () => {
    const { session, steps, release } = setup({
      outcome: {
        isCancelled: true
      }
    });
    release();
    await session.select({
      monitor: MONITOR,
      isAskOnRelease: false
    });
    await session.select({
      monitor: MONITOR,
      isAskOnRelease: false
    });
    assert.equal(steps.filter(step => step === "freeze").length, 2);
  });

  it("logs and gives Esc back when the overlay fails", async () => {
    const { session, steps, lines, release } = setup({ outcome: new Error("window died") });
    const pending = session.select({
      monitor: MONITOR,
      isAskOnRelease: false
    });
    release();
    assert.equal(await pending, undefined);
    assert.deepEqual(lines, ["circle: window died"]);
    assert.equal(steps.at(-1), "circling:false");
  });

  it("logs a failed capture without opening anything", async () => {
    const { session, steps, lines } = setup({
      outcome: {
        isCancelled: true
      },
      isFreezeFailing: true
    });
    assert.equal(
      await session.select({
        monitor: MONITOR,
        isAskOnRelease: false
      }), undefined
    );
    assert.deepEqual(lines, ["circle: no capture"]);
    assert.equal(steps.includes("open"), false);
  });

  it("reads text off the still only while the overlay is open", async () => {
    const { session, steps, release } = setup({
      outcome: {
        isCancelled: true
      }
    });
    assert.deepEqual(await session.readText(null), []);
    assert.equal(steps.includes("readText"), false);
    const pending = session.select({
      monitor: MONITOR,
      isAskOnRelease: false
    });
    await new Promise(resolve => setImmediate(resolve));
    await session.readText(REGION);
    assert.equal(steps.includes("readText"), true);
    release();
    await pending;
  });
});
