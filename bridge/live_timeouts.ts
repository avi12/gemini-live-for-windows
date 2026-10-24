// Live timeouts. Glic disconnects Live on four client flags (BardChatUi's live_mode module reads
// them when its first session starts): 30 s in "listening" with no speech, 7 s of a silent mic
// (which a mute is), and a 1 h privacy cap. A session here ends only when the user ends it, so
// rewrite those flags before Live first reads them. Flag objects keep their numeric key across
// releases while their minified names change, so find them by key in the shared namespace.

const DAY_S = 24 * 60 * 60;
const DAY_MS = DAY_S * 1000;
const LIVE_TIMEOUT_FLAGS: Record<string, number> = {
  45681081: DAY_S, // inactivity in "listening", seconds
  45681082: DAY_S, // same, while a tab is shared, seconds
  45687231: DAY_MS, // mic silence, ms
  45677155: DAY_MS // privacy cap, ms
};

/** One of Glic's client flags (BardChatUi); we only rewrite the two members the flag service reads. */
interface ClientFlag {
  key?: string;
  defaultValue?: number;
  ctor?: (raw: unknown) => number;
}

declare global {
  interface Window {
    default_BardChatUi?: Record<string, unknown>;
  }
}

/** A member of Glic's flag namespace that may be a flag: any object, since every member is optional. */
function isClientFlag(value: unknown): value is ClientFlag {
  return typeof value === "object" && value !== null;
}

let timeoutsPatched = false;

/** Rewrites Glic's Live timeout flags; true once all were found. */
export function patchLiveTimeouts(): boolean {
  if (timeoutsPatched) {
    return true;
  }

  const namespace = window.default_BardChatUi;
  if (!namespace) {
    return false;
  }

  let found = 0;
  for (const flag of Object.values(namespace)) {
    if (!isClientFlag(flag) || !flag.key) {
      continue;
    }

    const value = LIVE_TIMEOUT_FLAGS[flag.key];
    if (value === undefined) {
      continue;
    }

    // The flag service returns defaultValue when the server sent no value, else ctor(raw).
    flag.defaultValue = value;
    flag.ctor = () => value;
    found++;
  }
  timeoutsPatched = found === Object.keys(LIVE_TIMEOUT_FLAGS).length;
  return timeoutsPatched;
}
