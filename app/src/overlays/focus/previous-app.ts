import type { PillWindowPort, PreviousAppPort } from "@/pill/ports.ts";

// How long Windows gets to finish handing the foreground over before it is judged
export const SETTLE_MILLISECONDS = 120;

// Gives the keyboard back to the app the user was in when the pill opened. The pill never takes
// focus itself, but Win+C passes the foreground through Windows' own Copilot focus frame and then
// to the window we registered for the key. The UI worker follows the foreground (winui-svelte's
// trackForeground) and puts the last real app back in front when Windows left it on one of those,
// the desktop or nothing; an app the user switched to meanwhile is left alone. This is the main
// thread's end: it asks the worker.
export function createPreviousApp({ window, delay }: {
  window: Pick<PillWindowPort, "restorePreviousApp">;
  delay: (milliseconds: number) => Promise<void>;
}) {
  // Waits a moment for Windows to finish handing the foreground over
  async function settle() {
    await delay(SETTLE_MILLISECONDS);
    window.restorePreviousApp();
  }

  return {
    settle,
    restore: window.restorePreviousApp
  } satisfies PreviousAppPort;
}
