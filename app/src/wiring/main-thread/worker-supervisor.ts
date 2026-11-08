import { RECOVERED_ARGUMENT } from "@/entry/activation/activation.ts";
import type { Launch } from "@/lib/launch.ts";

export const RAPID_RESTARTS_VARIABLE = "GEMINI_LIVE_RAPID_RESTARTS";
export const MAX_RAPID_RESTARTS = 5;
export const STABLE_RUN_MILLISECONDS = 10_000;
export const RESTART_DELAY_MILLISECONDS = 1000;

// Mirrors PillHost.cs: a window that ran long enough starts the count over, and one that keeps
// exiting right after it starts is given up on
export function planRestart({ rapidRestarts, ranMilliseconds }: {
  rapidRestarts: number;
  ranMilliseconds: number;
}) {
  const isRapid = ranMilliseconds < STABLE_RUN_MILLISECONDS;
  const next = isRapid ? rapidRestarts + 1 : 0;
  return {
    rapidRestarts: next,
    isGivingUp: next > MAX_RAPID_RESTARTS
  };
}

export function rapidRestartsOf(env: NodeJS.ProcessEnv) {
  const count = Number.parseInt(env[RAPID_RESTARTS_VARIABLE] ?? "", 10);
  const isCount = Number.isInteger(count) && count > 0;
  return isCount ? count : 0;
}

// The command that starts this app again: a single-executable app is its own entry, any other
// Node run needs its flags and script first
export function restartCommand({ isSingleExecutable, execPath, execArgv, script }: {
  isSingleExecutable: boolean;
  execPath: string;
  execArgv: readonly string[];
  script: string | undefined;
}) {
  const isSelfContained = isSingleExecutable || script === undefined;
  return {
    file: execPath,
    args: isSelfContained ? [RECOVERED_ARGUMENT] : [...execArgv, script, RECOVERED_ARGUMENT]
  } satisfies Parameters<Launch>[0];
}

// The UI worker owns the pill, the overlays and the Google pages, so when it ends the app has
// lost its window. Like PillHost.cs restarting a dead pill, start again after a pause, up to a
// limit; the new copy gets the count so a window that dies at once is not restarted forever.
export async function superviseUiWorker({ ranMilliseconds, exitCode, rapidRestarts, release, relaunch, delay, log }: {
  ranMilliseconds: number;
  exitCode: number;
  rapidRestarts: number;
  // Lets go of what the new copy needs first: the single-instance pipe
  release: () => Promise<void>;
  relaunch: (rapidRestarts: number) => void;
  delay: (milliseconds: number) => Promise<void>;
  log: (message: string) => void;
}) {
  log(`pill: the window exited with ${exitCode}`);
  const plan = planRestart({
    rapidRestarts,
    ranMilliseconds
  });
  if (plan.isGivingUp) {
    log("pill: the window keeps exiting; giving up");
    return false;
  }

  await release();
  await delay(RESTART_DELAY_MILLISECONDS);
  relaunch(plan.rapidRestarts);
  return true;
}
