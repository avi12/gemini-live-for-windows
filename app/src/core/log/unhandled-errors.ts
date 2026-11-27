import { log } from "@/core/log/log.ts";
import { isError } from "@/lib/error-guards.ts";

const UNHANDLED_EXCEPTION_EVENT = "uncaughtException";
const UNHANDLED_REJECTION_EVENT = "unhandledRejection";

interface ErrorTarget {
  on(event: string, listener: (error: unknown) => void): unknown;
}

function describeError(error: unknown) {
  return isError(error) ? (error.stack ?? error.message) : String(error);
}

// Mirrors App.xaml.cs: an exception nobody caught is written to the log and the app keeps running
export function keepRunningOnUnhandledErrors({
  write = message => log.write(message),
  target = process
}: {
  write?: (message: string) => void;
  target?: ErrorTarget;
} = {}) {
  target.on(UNHANDLED_EXCEPTION_EVENT, error => write(`unhandled: ${describeError(error)}`));
  target.on(UNHANDLED_REJECTION_EVENT, error => write(`unhandled rejection: ${describeError(error)}`));
}
