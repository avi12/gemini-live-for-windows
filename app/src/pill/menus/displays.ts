import type { Monitor } from "@/contracts/monitor.ts";
import { monitorName } from "@/contracts/monitor.ts";
import type { PillContext } from "@/pill/context.ts";
import { runInBackground } from "@/pill/context.ts";
import { refreshMicrophones } from "@/pill/menus/microphones.ts";

export function describeMonitor(monitor: Monitor) {
  const primary = monitor.isPrimary ? " (primary)" : "";
  return `${monitorName(monitor)}${primary} · ${monitor.width}×${monitor.height}`;
}

export function showOn({ context, monitor }: {
  context: PillContext;
  monitor: Monitor;
}) {
  const { state, deps } = context;
  if (!state.isShown) {
    runInBackground({
      context,
      task: deps.previousApp.settle(),
      name: "settling the previous app"
    });
  }

  state.pillMonitor = monitor;
  state.isKeyPromptShown = false;
  state.isExtensionNeeded = false;
  state.isExtensionStepsShown = false;
  state.isShown = true;
  state.displays = deps.displays.all();
  runInBackground({
    context,
    task: refreshMicrophones(context),
    name: "listing microphones"
  });
  context.changed();
}

function share({ context, monitor }: {
  context: PillContext;
  monitor: Monitor;
}) {
  const { state, deps, focus } = context;
  const { conversation } = state;
  const isIdle = conversation === undefined;
  if (isIdle) {
    return;
  }

  conversation.share(monitor);
  focus.cover(monitor);
  // Sharing a display shares all of it
  focus.unfocus();
  deps.log(`sharing ${describeMonitor(monitor)}`);
}

export function shareDisplay({ context, displayId }: {
  context: PillContext;
  displayId: string;
}) {
  const monitor = context.deps.displays.all().find(display => display.deviceName === displayId);
  const isMissing = monitor === undefined;
  if (isMissing) {
    throw new Error(`There is no display '${displayId}'`);
  }

  share({
    context,
    monitor
  });
}

// Displays plugged in or out: keep sharing one that survived, and re-dock
export function onDisplaysChanged(context: PillContext) {
  const { state, deps } = context;
  state.displays = deps.displays.all();
  deps.log(`displays changed: ${state.displays.length}`);

  const shared = state.conversation?.monitor;
  const isSharing = shared !== undefined;
  if (isSharing) {
    // Re-share even when the display survived: its bounds may have moved
    share({
      context,
      monitor: deps.displays.reconcile({
        all: state.displays,
        display: shared
      })
    });
  }

  const { pillMonitor } = state;
  const isDocked = pillMonitor !== undefined;
  if (isDocked) {
    state.pillMonitor = deps.displays.reconcile({
      all: state.displays,
      display: pillMonitor
    });
  }

  context.changed();
}
