import { dataDir } from "@/lib/paths.ts";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const LOG_FILE = "log.txt";
const DEBUG_FLAG_FILE = "debug.flag";
const DEBUG_VARIABLE = "GEMINI_LIVE_DEBUG";
const LINE_BREAK = "\r\n";

function pad({ value, width }: {
  value: number;
  width: number;
}) {
  return String(value).padStart(width, "0");
}

export function formatTimestamp(date: Date) {
  const clock = [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => pad({
    value,
    width: 2
  }));
  return `${clock.join(":")}.${pad({
    value: date.getMilliseconds(),
    width: 3
  })}`;
}

// GEMINI_LIVE_DEBUG set to anything, or a debug.flag file in the data folder (for launches that
// can't carry env vars)
export function isDebugging({ dir, env }: {
  dir: string;
  env: NodeJS.ProcessEnv;
}) {
  return env[DEBUG_VARIABLE] !== undefined || existsSync(path.join(dir, DEBUG_FLAG_FILE));
}

// Logging must never take the app down
export function createLog({ dir, now }: {
  dir: string;
  now: () => Date;
}) {
  const file = path.join(dir, LOG_FILE);

  function write(message: string) {
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, `${formatTimestamp(now())} ${message}${LINE_BREAK}`);
    } catch {
      return;
    }
  }

  return { write };
}

let shared: ReturnType<typeof createLog> | undefined;

function sharedLog() {
  shared ??= createLog({
    dir: dataDir(),
    now: () => new Date()
  });
  return shared;
}

export const log = {
  write(message: string) {
    sharedLog().write(message);
  },
  get isDebugging() {
    return isDebugging({
      dir: dataDir(),
      env: process.env
    });
  }
};
