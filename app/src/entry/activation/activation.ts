import { z } from "zod";

import { KeyTrigger } from "@/core/instance/key-trigger.ts";

export const KEY_SCHEME = "geminilive-key";
export const RECOVERED_ARGUMENT = "--recovered";
const STATE_PARAMETER = "state";

// ExtendedActivationKind.StartupTask of the Windows App SDK (Microsoft.Windows.AppLifecycle).
export const STARTUP_TASK_ACTIVATION_KIND = 1020;

export const ActivationKind = {
  LAUNCH: "launch",
  KEY: "key",
  STARTUP: "startup",
  // The app started itself again after its window died: it only comes back up, like a sign-in start
  RECOVERED: "recovered"
} as const;
export type ActivationKind = (typeof ActivationKind)[keyof typeof ActivationKind];

export type Activation =
  | { kind: typeof ActivationKind.LAUNCH }
  | { kind: typeof ActivationKind.STARTUP }
  | { kind: typeof ActivationKind.RECOVERED }
  | {
      kind: typeof ActivationKind.KEY;
      trigger: KeyTrigger;
    };

const TRIGGER_BY_LOWERCASE_NAME = new Map(Object.values(KeyTrigger).map(name => [name.toLowerCase(), name]));

// C# treated a missing or unknown ?state= as a tap.
const stateSchema = z.preprocess(
  value => (typeof value === "string" ? TRIGGER_BY_LOWERCASE_NAME.get(value.toLowerCase()) : undefined),
  z.enum(KeyTrigger).catch(KeyTrigger.TAP)
);

function keyUriOf(argument: string) {
  const parsed = URL.parse(argument);
  const isKeyUri = parsed !== null && parsed.protocol === `${KEY_SCHEME}:`;
  return isKeyUri ? parsed : undefined;
}

/** The trigger a `geminilive-key:` argument carries; undefined when the argument is not one. */
export function triggerFromArgument(argument: string) {
  const uri = keyUriOf(argument);
  const isOtherUri = uri === undefined;
  if (isOtherUri) {
    return undefined;
  }

  return stateSchema.parse(uri.searchParams.get(STATE_PARAMETER) ?? undefined);
}

/**
 * How this process was started.
 *
 * The manifest passes the protocol URI as an argument (`uap3:Protocol Parameters`). A startup task
 * passes nothing, so it can only be told from a plain launch by the Windows App SDK's activation
 * kind, which the caller reads (`packagedKind`) and which is undefined outside a package.
 */
export function describeActivation({
  args,
  packagedKind
}: {
  args: readonly string[];
  packagedKind?: number | undefined;
}) {
  for (const argument of args) {
    const trigger = triggerFromArgument(argument);
    const isKey = trigger !== undefined;
    if (isKey) {
      return {
        kind: ActivationKind.KEY,
        trigger
      };
    }
  }
  const isRecovered = args.includes(RECOVERED_ARGUMENT);
  if (isRecovered) {
    return { kind: ActivationKind.RECOVERED };
  }

  const isStartup = packagedKind === STARTUP_TASK_ACTIVATION_KIND;
  return isStartup ? { kind: ActivationKind.STARTUP } : { kind: ActivationKind.LAUNCH };
}

/** The arguments the user (or the manifest) gave: what follows the exe in `process.argv`. */
export function userArguments(argv: readonly string[]) {
  return argv.slice(2);
}
