import type { AppRelease } from "./app-release.ts";
import { latestRelease } from "./release/release-feed.ts";
import { downloadRelease, installRelease } from "./release/update-installer.ts";
import { UpdateMessage } from "./update-protocol.ts";
import type { UpdateProtocolMap } from "./update-protocol.ts";
import { compareVersions } from "./version/version.ts";
import { log } from "@/core/log/log.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { createLoopback } from "@/lib/transport/loopback-transport.ts";
import { defineMessaging } from "@gemini-live/messaging";

export const UpdateCheck = {
  // Not looked: unpackaged, or the user turned updates off
  skipped: "Skipped",
  upToDate: "UpToDate",
  // A newer release is downloaded and checked, ready to install
  ready: "Ready",
  // GitHub couldn't be reached, or the download was damaged
  failed: "Failed"
} as const;
export type UpdateCheck = typeof UpdateCheck[keyof typeof UpdateCheck];

const NOTIFY_TIMEOUT_MS = 1000;
const HOURS_BETWEEN_CHECKS = 6;
const MS_PER_HOUR = 3_600_000;
export const UPDATE_INTERVAL_MS = HOURS_BETWEEN_CHECKS * MS_PER_HOUR;

interface UpdateCheckerDependencies {
  // The running package's version, or undefined when run unpackaged (nothing to update)
  installed: string | undefined;
  isCheckEnabled: () => boolean;
  findLatest?: () => Promise<AppRelease | undefined>;
  download?: (release: AppRelease) => Promise<string | undefined>;
  install?: (filePath: string) => void;
  writeLog?: (message: string) => void;
  schedule?: (options: {
    work: () => void;
    delayMs: number;
  }) => () => void;
}

function scheduleWithTimer({ work, delayMs }: {
  work: () => void;
  delayMs: number;
}) {
  const timer = setInterval(work, delayMs);
  timer.unref();
  return () => clearInterval(timer);
}

function createUpdateEvents() {
  const channel = createLoopback();
  return {
    sender: defineMessaging<UpdateProtocolMap>(channel.first, { timeoutMs: NOTIFY_TIMEOUT_MS }),
    // Listeners subscribe here: events.onMessage(UpdateMessage.readyChanged, ...)
    events: defineMessaging<UpdateProtocolMap>(channel.second, { timeoutMs: NOTIFY_TIMEOUT_MS })
  };
}

async function findNewer({ installed, findLatest, writeLog }: {
  installed: string;
  findLatest: () => Promise<AppRelease | undefined>;
  writeLog: (message: string) => void;
}) {
  const latest = await findLatest();
  writeLog(`update check: installed ${installed}, latest ${latest?.version ?? "none"}`);

  if (!latest) {
    return undefined;
  }

  const isNewer = compareVersions({
    left: latest.version,
    right: installed
  }) > 0;
  return isNewer ? latest : undefined;
}

async function runCheck({ installed, isSkipped, findLatest, writeLog, prepare }: {
  installed: string | undefined;
  isSkipped: () => boolean;
  findLatest: () => Promise<AppRelease | undefined>;
  writeLog: (message: string) => void;
  prepare: (latest: AppRelease) => Promise<UpdateCheck>;
}) {
  const isUnpackaged = !installed;
  const isOff = isUnpackaged || isSkipped();
  if (isOff) {
    return UpdateCheck.skipped;
  }

  try {
    const newer = await findNewer({
      installed,
      findLatest,
      writeLog
    });
    if (!newer) {
      return UpdateCheck.upToDate;
    }

    return await prepare(newer);
  } catch (error) {
    writeLog(`update check failed: ${errorMessage(error)}`);
    return UpdateCheck.failed;
  }
}

// Knows whether a newer release than the running package is on GitHub, and has it downloaded and
// checked by the time it says so. It looks at start and every few hours after, unless the user
// turned updates off, which also stops every connection it makes.
export function createUpdateChecker({
  installed,
  isCheckEnabled,
  findLatest = () => latestRelease(),
  download = release => downloadRelease({ release }),
  install = installRelease,
  writeLog = message => log.write(message),
  schedule = scheduleWithTimer
}: UpdateCheckerDependencies) {
  let ready: AppRelease | undefined;
  let readyPath: string | undefined;
  const { sender, events } = createUpdateEvents();

  async function prepare(latest: AppRelease) {
    readyPath = await download(latest);
    ready = readyPath ? latest : undefined;
    sender.sendMessage(UpdateMessage.readyChanged, ready ?? null).catch(() => undefined);

    return ready ? UpdateCheck.ready : UpdateCheck.failed;
  }

  function check({ isManual }: { isManual: boolean }) {
    return runCheck({
      installed,
      isSkipped: () => !isManual && !isCheckEnabled(),
      findLatest,
      writeLog,
      prepare
    });
  }

  // Looks now, then again every few hours; the returned function stops it
  function watch() {
    void check({ isManual: false });
    return schedule({
      work: () => void check({ isManual: false }),
      delayMs: UPDATE_INTERVAL_MS
    });
  }

  // Opens the downloaded package in App Installer; false when none is ready
  function installReady() {
    if (!readyPath) {
      return false;
    }

    install(readyPath);
    return true;
  }

  return {
    check,
    watch,
    install: installReady,
    events,
    get ready() {
      return ready;
    }
  };
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>;
