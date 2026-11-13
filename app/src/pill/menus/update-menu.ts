import { UpdateCheck } from "@/core/updates/update-checker.ts";
import type { PillContext } from "@/pill/context.ts";
import { runInBackground } from "@/pill/context.ts";

export const INSTALLER_NOTE = "Choose Update in the installer window. Gemini Live restarts when it's done.";
export const NO_UPDATE = "There is no update to install";
export const UNPACKAGED = "Updates need the installed app";

// The gear menu's update facts: the version ready to restart into, if any; null when unpackaged,
// with nothing to replace. The window words the entry.
export function describeUpdate({ deps }: PillContext) {
  const isUnpackaged = deps.updates.installed === undefined;
  if (isUnpackaged) {
    return null;
  }

  return {
    readyVersion: deps.updates.ready?.version ?? null,
    isAutoUpdateOn: deps.settings.isAutoUpdateOn
  };
}

// Turns looking on its own on or off; turning it on looks right away
export async function setAutoUpdate({ context, isOn }: { context: PillContext; isOn: boolean }) {
  const { deps } = context;
  await deps.settings.setAutoUpdate(isOn);

  if (!isOn) {
    return;
  }

  runInBackground({
    context,
    task: deps.updates.check({ isManual: false }),
    name: "checking for updates"
  });
}

export function installUpdate(context: PillContext) {
  if (!context.deps.updates.install()) {
    throw new Error(NO_UPDATE);
  }

  context.captions.addNote(INSTALLER_NOTE);
}

function describeCheck({ context, result }: { context: PillContext; result: UpdateCheck }) {
  const { deps } = context;
  const isReady = result === UpdateCheck.READY;
  if (isReady) {
    return `Version ${deps.updates.ready?.version} is ready. Open the gear menu to restart into it.`;
  }

  const isFailed = result === UpdateCheck.FAILED;
  if (isFailed) {
    return "Couldn't get the update from GitHub.";
  }

  return `Gemini Live ${deps.updates.installed} is the latest version.`;
}

async function sayUpdateCheck(context: PillContext) {
  const result = await context.deps.updates.check({ isManual: true });
  context.captions.addNote(
    describeCheck({
      context,
      result
    })
  );
  context.changed();
}

export function checkForUpdates(context: PillContext) {
  const isUnpackaged = context.deps.updates.installed === undefined;
  if (isUnpackaged) {
    throw new Error(UNPACKAGED);
  }

  runInBackground({
    context,
    task: sayUpdateCheck(context),
    name: "checking for updates"
  });
}
