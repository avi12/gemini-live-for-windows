import { CrashVerdict, createCrashGuard } from "./guards/crash-guard.ts";
import { createSwitchableTransport } from "./transports.ts";
import type { PermissionDecision, PermissionKind, WebViewCore, WebViewFactory } from "./web-view-port.ts";
import { ProcessFailureKind } from "./web-view-port.ts";
import type { Logger } from "@/google/ports.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { defineMessaging, type ProtocolMap } from "@gemini-live/messaging";

const MAX_CRASH_STREAK = 3;
const CRASH_WINDOW_MS = 30_000;
const ROTATE_COOKIES_FILTER = "https://accounts.google.com/RotateCookies*";

export const RecoveryFailure = {
  crashLoop: "crashLoop",
  rebuildFailed: "rebuildFailed"
} as const;
export type RecoveryFailure = typeof RecoveryFailure[keyof typeof RecoveryFailure];

export interface WebHostOptions {
  // For the log lines
  readonly name: string;
  readonly factory: WebViewFactory;
  readonly bridgeScript: string;
  // A message sent while the page navigates is lost, so every send times out
  readonly messageTimeoutMs: number;
  readonly isDebugging: boolean;
  readonly isNavigationAllowed: (uri: string) => boolean;
  readonly decidePermission: ((kind: PermissionKind) => PermissionDecision) | undefined;
  readonly log: Logger;
  readonly now: () => number;
  // Wires up a freshly built engine: page-specific handlers, session, first navigation. Runs at
  // warm-up and after every rebuild.
  readonly onCoreReady: (core: WebViewCore) => void;
  // A crash is being recovered from; the page is about to reload
  readonly onRecovering: () => void;
  // Recovery gave up; the next ensureCore() tries again
  readonly onRecoveryFailed: (failure: {
    reason: RecoveryFailure;
    cause: Error | undefined;
  }) => void;
}

// The live engine, or undefined before warm-up and while a crashed browser is being replaced.
// Always reach the page through this, never an old control: a dead control throws on every access.
interface CoreHolder {
  core: WebViewCore | undefined;
  building: Promise<void> | undefined;
}

type SwitchableChannel = ReturnType<typeof createSwitchableTransport>;

// Points the channel at a fresh control and hands it the host's policies, the cookie-rotation
// block and the bridge
async function buildCore({ options, channel, holder, onProcessFailed }: {
  options: WebHostOptions;
  channel: SwitchableChannel;
  holder: CoreHolder;
  onProcessFailed: (kind: ProcessFailureKind) => void;
}) {
  holder.core = undefined;
  channel.detach();
  const next = await options.factory.create({ isDebugging: options.isDebugging });
  next.onMessage(channel.receive);
  channel.attach(json => next.postMessage(json));
  next.onProcessFailed(onProcessFailed);
  next.onNavigation(options.isNavigationAllowed);

  if (options.decidePermission) {
    next.onPermission(options.decidePermission);
  }

  // This WebView2 only ever adopts the rotations the browser makes; two writers would
  // invalidate each other's session
  next.blockRequests(ROTATE_COOKIES_FILTER);
  await next.injectScript(options.bridgeScript);
  holder.core = next;
  options.onCoreReady(next);
}

// A render crash reloads the page in place; a browser crash kills the whole control, so it is
// replaced. Repeated crashes in a short window stop looping.
async function recoverFromFailure({ kind, options, channel, holder, crashGuard, ensureCore }: {
  kind: ProcessFailureKind;
  options: WebHostOptions;
  channel: SwitchableChannel;
  holder: CoreHolder;
  crashGuard: ReturnType<typeof createCrashGuard>;
  ensureCore: () => Promise<WebViewCore | undefined>;
}) {
  options.log.write(`${options.name}: process failed (${kind})`);
  const isBrowserDead = kind === ProcessFailureKind.browserExited;
  const failed = holder.core;
  if (isBrowserDead) {
    holder.core = undefined;
    channel.detach();
  }

  const isCrashLoop = crashGuard.record() === CrashVerdict.giveUp;
  if (isCrashLoop) {
    options.log.write(`${options.name}: crashing repeatedly; waiting for the next use to retry`);
    options.onRecoveryFailed({
      reason: RecoveryFailure.crashLoop,
      cause: undefined
    });
    return;
  }

  options.onRecovering();
  try {
    if (isBrowserDead) {
      await ensureCore();
      return;
    }

    failed?.reload();
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(errorMessage(error));
    options.log.write(`${options.name}: recovery failed: ${cause.message}`);
    options.onRecoveryFailed({
      reason: RecoveryFailure.rebuildFailed,
      cause
    });
  }
}

// A hidden WebView2 that rides the browser's Google session, the base of Gemini's glic page and of
// the Home page. It owns what is identical between them: the Chromium window and flags (in the
// factory), the cookie-rotation block, the injected bridge, the typed messenger to the page, and
// surviving a crashed browser process.
//
// A browser-process crash leaves the control permanently invalid, so recovery replaces the control
// itself, never just its core. The messenger and its handlers outlive every control.
export function createWebHost<TProtocolMap extends ProtocolMap>(options: WebHostOptions) {
  const channel = createSwitchableTransport();
  const messenger = defineMessaging<TProtocolMap>(channel.transport, { timeoutMs: options.messageTimeoutMs });
  const crashGuard = createCrashGuard({
    maxStreak: MAX_CRASH_STREAK,
    windowMs: CRASH_WINDOW_MS,
    now: options.now
  });
  const holder: CoreHolder = {
    core: undefined,
    building: undefined
  };

  // Brings the engine up if it isn't: at warm-up, or when a use finds it down after a crash that
  // recovery gave up on. Joins a build already in flight rather than starting a second.
  async function ensureCore() {
    if (holder.core) {
      return holder.core;
    }

    holder.building ??= buildCore({
      options,
      channel,
      holder,
      onProcessFailed: kind => void recoverFromFailure({
        kind,
        options,
        channel,
        holder,
        crashGuard,
        ensureCore
      })
    }).finally(() => {
      holder.building = undefined;
    });
    await holder.building;
    return holder.core;
  }

  return {
    messenger,
    ensureCore,
    get core() {
      return holder.core;
    }
  };
}
