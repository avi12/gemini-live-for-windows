import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DpiAwareness, ensureDpiAware, isAwareAtLeast } from "./dpi.ts";
import type { DpiCalls } from "./dpi.ts";

function fakeCalls({ reads, result }: { reads: DpiAwareness[]; result: ReturnType<DpiCalls["setPerMonitorV2"]> }) {
  let setCount = 0;
  const calls: DpiCalls = {
    read: () => reads.shift() ?? DpiAwareness.UNAWARE,
    setPerMonitorV2() {
      setCount += 1;
      return result;
    }
  };
  return {
    calls,
    setCount: () => setCount
  };
}

describe("ensureDpiAware", () => {
  it("does nothing when the process is already per-monitor v2", () => {
    const fake = fakeCalls({
      reads: [DpiAwareness.PER_MONITOR_V2],
      result: {
        isSuccess: true,
        lastError: null
      }
    });
    assert.equal(ensureDpiAware({ calls: fake.calls }), DpiAwareness.PER_MONITOR_V2);
    assert.equal(fake.setCount(), 0);
  });

  it("sets it for an unaware process", () => {
    const fake = fakeCalls({
      reads: [DpiAwareness.UNAWARE, DpiAwareness.PER_MONITOR_V2],
      result: {
        isSuccess: true,
        lastError: null
      }
    });
    assert.equal(ensureDpiAware({ calls: fake.calls }), DpiAwareness.PER_MONITOR_V2);
    assert.equal(fake.setCount(), 1);
  });

  it("accepts an access-denied answer when the process is per-monitor aware already", () => {
    const fake = fakeCalls({
      reads: [DpiAwareness.PER_MONITOR, DpiAwareness.PER_MONITOR],
      result: {
        isSuccess: false,
        lastError: 5
      }
    });
    assert.equal(ensureDpiAware({ calls: fake.calls }), DpiAwareness.PER_MONITOR);
  });

  it("names both values when denied and too low", () => {
    const fake = fakeCalls({
      reads: [DpiAwareness.SYSTEM, DpiAwareness.SYSTEM],
      result: {
        isSuccess: false,
        lastError: 5
      }
    });
    assert.throws(() => ensureDpiAware({ calls: fake.calls }), /system.*per-monitor-v2/);
  });

  it("throws on any other failure", () => {
    const fake = fakeCalls({
      reads: [DpiAwareness.UNAWARE],
      result: {
        isSuccess: false,
        lastError: 87
      }
    });
    assert.throws(() => ensureDpiAware({ calls: fake.calls }), /error 87/);
  });
});

describe("isAwareAtLeast", () => {
  it("orders the awareness values", () => {
    assert.ok(
      isAwareAtLeast({
        current: DpiAwareness.PER_MONITOR_V2,
        required: DpiAwareness.PER_MONITOR
      })
    );
    assert.ok(
      !isAwareAtLeast({
        current: DpiAwareness.SYSTEM,
        required: DpiAwareness.PER_MONITOR
      })
    );
  });
});
