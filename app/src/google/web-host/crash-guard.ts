export const CrashVerdict = {
  recover: "recover",
  giveUp: "giveUp"
} as const;

// Repeated crashes in a short window stop the recovery loop instead of spinning on a browser that
// cannot stay up
export function createCrashGuard({ maxStreak, windowMs, now }: {
  maxStreak: number;
  windowMs: number;
  now: () => number;
}) {
  let lastCrash = Number.NEGATIVE_INFINITY;
  let streak = 0;

  function record() {
    const moment = now();
    streak = moment - lastCrash < windowMs ? streak + 1 : 1;
    lastCrash = moment;
    return streak > maxStreak ? CrashVerdict.giveUp : CrashVerdict.recover;
  }

  return { record };
}
