import { argHandle, bindFunction, Win32Type } from "@/win32/bind.ts";
import "@microsoft/dynwinrt";

export const DpiAwareness = {
  unaware: "unaware",
  system: "system",
  perMonitor: "per-monitor",
  perMonitorV2: "per-monitor-v2"
} as const;
export type DpiAwareness = typeof DpiAwareness[keyof typeof DpiAwareness];

// DPI_AWARENESS_CONTEXT pseudo handles (windef.h): small negative numbers, passed as pointers.
const DpiContext = {
  unaware: -1n,
  system: -2n,
  perMonitor: -3n,
  perMonitorV2: -4n
} as const;

const AWARENESS_BY_CONTEXT = [
  [DpiContext.perMonitorV2, DpiAwareness.perMonitorV2],
  [DpiContext.perMonitor, DpiAwareness.perMonitor],
  [DpiContext.system, DpiAwareness.system],
  [DpiContext.unaware, DpiAwareness.unaware]
] as const;
const ERROR_ACCESS_DENIED = 5;
const AWARENESS_RANK: Record<DpiAwareness, number> = {
  [DpiAwareness.unaware]: 0,
  [DpiAwareness.system]: 1,
  [DpiAwareness.perMonitor]: 2,
  [DpiAwareness.perMonitorV2]: 3
};

export interface DpiCalls {
  /** The awareness of the process now. */
  read(): DpiAwareness;
  /** SetProcessDpiAwarenessContext; lastError is Win32's error when it did not succeed. */
  setPerMonitorV2(): {
    isSuccess: boolean;
    lastError: number | null;
  };
}

const POINTER_BITS = 64;

function toPointerValue(context: bigint) {
  return BigInt.asUintN(POINTER_BITS, context);
}

function createDpiCalls() {
  const setContext = bindFunction({
    library: "user32.dll",
    entryPoint: "SetProcessDpiAwarenessContext",
    parameters: [Win32Type.handle],
    returns: Win32Type.bool32,
    shouldCaptureLastError: true
  });
  const getThreadContext = bindFunction({
    library: "user32.dll",
    entryPoint: "GetThreadDpiAwarenessContext",
    parameters: [],
    returns: Win32Type.handle
  });
  const areEqual = bindFunction({
    library: "user32.dll",
    entryPoint: "AreDpiAwarenessContextsEqual",
    parameters: [Win32Type.handle, Win32Type.handle],
    returns: Win32Type.bool32
  });
  return {
    read() {
      const current = getThreadContext([]).address;
      for (const [context, awareness] of AWARENESS_BY_CONTEXT) {
        const isMatch = areEqual([argHandle(current), argHandle(toPointerValue(context))]).number !== 0;
        if (isMatch) {
          return awareness;
        }
      }
      return DpiAwareness.unaware;
    },
    setPerMonitorV2() {
      const result = setContext([argHandle(toPointerValue(DpiContext.perMonitorV2))]);
      return {
        isSuccess: result.number !== 0,
        lastError: result.lastError
      };
    }
  };
}

/** True when `current` is at least `required`. */
export function isAwareAtLeast({ current, required }: {
  current: DpiAwareness;
  required: DpiAwareness;
}) {
  return AWARENESS_RANK[current] >= AWARENESS_RANK[required];
}

/**
 * Makes the process per-monitor DPI aware (v2). Call first on the main thread, before anything creates a
 * window: user32 allows it once, and only before the first window. Idempotent. When Windows refuses
 * because the awareness is already set (a manifest or an earlier call), that is success if the process is
 * at least per-monitor aware, and an error naming both values otherwise.
 *
 * @returns the awareness the process has afterwards.
 */
export function ensureDpiAware({ calls = createDpiCalls() }: { calls?: DpiCalls } = {}) {
  const before = calls.read();
  const isAlreadyV2 = before === DpiAwareness.perMonitorV2;
  if (isAlreadyV2) {
    return before;
  }

  const result = calls.setPerMonitorV2();
  const isAlreadySet = !result.isSuccess && result.lastError === ERROR_ACCESS_DENIED;
  const isFailed = !result.isSuccess && !isAlreadySet;
  if (isFailed) {
    throw new Error(`SetProcessDpiAwarenessContext failed (error ${result.lastError})`);
  }

  const after = calls.read();
  const isAcceptable = isAwareAtLeast({
    current: after,
    required: DpiAwareness.perMonitor
  });
  if (!isAcceptable) {
    throw new Error(`DPI awareness is ${after} and Windows refused ${DpiAwareness.perMonitorV2}`);
  }

  return after;
}
