import { z } from "@gemini-live/protocol/zod";
import { createGuard } from "@gemini-live/protocol/zod-guard";

// The UI thread's message pump (winui-svelte, window/message-hooks) offers every message it takes
// off the thread's queue to a set of hooks that lives on globalThis under this key, one set per
// thread, whichever copy of the library asks. The library does not export its `addMessageHook`
// (HANDOFF-copilot-key-fast-path.md asks for it), so this adds to the same set. When the library
// exports it, replace this file with that export and keep the `MessageHookSource` type.
const SHARED_KEY = Symbol.for("winui-svelte.message-hooks");

/** A message taken off the thread's queue. */
export interface ThreadMessage {
  /** The window it was posted to; 0n for a thread message. */
  readonly hwnd: bigint;
  readonly id: number;
  readonly wParam: bigint;
  readonly lParam: bigint;
}

/** True when the hook handled the message, which is then not dispatched further. */
export type MessageHook = (message: ThreadMessage) => boolean;

/** Adds a hook; the returned function takes it away again. */
export type MessageHookSource = (hook: MessageHook) => () => void;

const isHookSet = createGuard(z.instanceof(Set<MessageHook>));

function hooksOfThread() {
  const existing: unknown = Object.getOwnPropertyDescriptor(globalThis, SHARED_KEY)?.value;
  if (isHookSet(existing)) {
    return existing;
  }

  const created = new Set<MessageHook>();
  Object.defineProperty(globalThis, SHARED_KEY, { value: created });
  return created;
}

export function addThreadMessageHook(hook: MessageHook) {
  const hooks = hooksOfThread();
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}
