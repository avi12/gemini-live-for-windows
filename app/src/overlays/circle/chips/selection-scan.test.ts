import type { Chip } from "./chip.ts";
import { createSelectionScan, SCAN_SETTLE_MILLISECONDS } from "./selection-scan.ts";
import type { SelectionScanWorld } from "./selection-scan.ts";
import type { Region } from "@/contracts/monitor.ts";
import type { OcrLine } from "@/overlays/ports.ts";
import type { Rect } from "@/overlays/shapes.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const FIRST: Rect = {
  x: 10,
  y: 10,
  width: 100,
  height: 50
};
const SECOND: Rect = {
  x: 20,
  y: 10,
  width: 100,
  height: 50
};

function line(text: string) {
  return {
    words: [{
      text,
      bounds: {
        x: 0,
        y: 0,
        width: 1,
        height: 1
      }
    }]
  };
}

function valuesOf(chips: readonly Chip[]) {
  return chips.map(chip => chip.value);
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

function setup({ read = () => Promise.resolve([line("example.com")]), codes = () => Promise.resolve([]) }: {
  read?: SelectionScanWorld["readText"];
  codes?: SelectionScanWorld["scanCodes"];
} = {}) {
  const timers: Array<{
    callback: () => void;
    isCancelled: boolean;
    milliseconds: number;
  }> = [];
  const shown: Array<readonly Chip[]> = [];
  const logs: string[] = [];
  const scan = createSelectionScan({
    world: {
      readText: read,
      scanCodes: codes,
      schedule({ callback, milliseconds }) {
        const timer = {
          callback,
          milliseconds,
          isCancelled: false
        };
        timers.push(timer);
        return () => {
          timer.isCancelled = true;
        };
      },
      log: {
        write: message => logs.push(message)
      }
    },
    regionOf: selection => ({
      ...selection
    } satisfies Region),
    onChips: chips => shown.push(chips)
  });
  function fire(index: number) {
    const timer = timers[index];
    const isLive = timer !== undefined && !timer.isCancelled;
    if (isLive) {
      timer.callback();
    }
  }

  return {
    scan,
    timers,
    shown,
    logs,
    fire
  };
}

describe("selection scan", () => {
  it("reads nothing until the selection has settled", async () => {
    let reads = 0;
    const { scan, timers } = setup({
      read() {
        reads += 1;
        return Promise.resolve([]);
      }
    });
    scan.watch(FIRST);
    assert.equal(reads, 0);
    assert.equal(timers[0]?.milliseconds, SCAN_SETTLE_MILLISECONDS);
  });

  it("shows the chips found once it has settled", async () => {
    const { scan, shown, fire } = setup();
    scan.watch(FIRST);
    fire(0);
    await new Promise(setImmediate);
    assert.equal(shown.length, 1);
    assert.equal(shown[0]?.[0]?.value, "https://example.com/");
  });

  it("does not start a read for a selection that changed before it settled", () => {
    const { scan, timers, fire } = setup();
    scan.watch(FIRST);
    scan.watch(SECOND);
    assert.equal(timers[0]?.isCancelled, true);
    fire(0);
    assert.equal(timers.length, 2);
  });

  it("drops a read that comes back after the selection moved on", async () => {
    const slow = deferred<readonly OcrLine[]>();
    let calls = 0;
    const { scan, shown, fire } = setup({
      read() {
        calls += 1;
        return calls === 1 ? slow.promise : Promise.resolve([line("other.org")]);
      }
    });
    scan.watch(FIRST);
    fire(0);
    scan.watch(SECOND);
    fire(1);
    await new Promise(setImmediate);
    slow.resolve([line("example.com")]);
    await new Promise(setImmediate);
    const values = shown.map(valuesOf);
    assert.deepEqual(values, [["https://other.org/"]]);
  });

  it("drops a read that comes back after the selection was cleared", async () => {
    const slow = deferred<readonly OcrLine[]>();
    const { scan, shown, fire } = setup({ read: () => slow.promise });
    scan.watch(FIRST);
    fire(0);
    scan.watch(undefined);
    slow.resolve([line("example.com")]);
    await new Promise(setImmediate);
    assert.deepEqual(shown, []);
  });

  it("clears the chips when the selection changes", async () => {
    const { scan, shown, fire } = setup();
    scan.watch(FIRST);
    fire(0);
    await new Promise(setImmediate);
    scan.watch(undefined);
    assert.equal(shown.length, 2);
    assert.deepEqual(shown[1], []);
  });

  it("ignores the same selection watched again", () => {
    const { scan, timers } = setup();
    scan.watch(FIRST);
    scan.watch({ ...FIRST });
    assert.equal(timers.length, 1);
  });

  it("shows what is left when the OCR or the code scan fails, and logs it", async () => {
    const { scan, shown, logs, fire } = setup({
      read: () => Promise.reject(new Error("no OCR")),
      codes: () => Promise.resolve(["https://qr.example/"])
    });
    scan.watch(FIRST);
    fire(0);
    await new Promise(setImmediate);
    assert.deepEqual(shown[0]?.map(chip => chip.kind), ["qr"]);
    assert.equal(logs.length, 1);
  });
});
