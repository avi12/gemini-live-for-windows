import assert from "node:assert/strict";
import { test } from "node:test";

import { CrashVerdict, createCrashGuard } from "./crash-guard.ts";

const CRASHES = 5;
const SECOND_MS = 1000;
const QUIET_SPELL_MS = 60_000;

test("recovers until the streak passes the limit, then gives up", () => {
  let clock = 0;
  const guard = createCrashGuard({
    maxStreak: 3,
    windowMs: 30_000,
    now: () => clock
  });
  const verdicts = [];
  for (let iCrash = 0; iCrash < CRASHES; iCrash += 1) {
    clock += SECOND_MS;
    verdicts.push(guard.record());
  }

  assert.deepEqual(verdicts, [
    CrashVerdict.RECOVER,
    CrashVerdict.RECOVER,
    CrashVerdict.RECOVER,
    CrashVerdict.GIVE_UP,
    CrashVerdict.GIVE_UP
  ]);
});

test("a quiet spell starts a new streak", () => {
  let clock = 0;
  const guard = createCrashGuard({
    maxStreak: 1,
    windowMs: 30_000,
    now: () => clock
  });
  assert.equal(guard.record(), CrashVerdict.RECOVER);
  clock += SECOND_MS;
  assert.equal(guard.record(), CrashVerdict.GIVE_UP);
  clock += QUIET_SPELL_MS;
  assert.equal(guard.record(), CrashVerdict.RECOVER);
});
