import type { MessagePort } from "node:worker_threads";

import { DynCom } from "@microsoft/dynwinrt/com/unsafe";
import { readWindowText, withUiaClient } from "winui-svelte/automation";
import type { WindowText } from "winui-svelte/automation";

import { errorMessage } from "@/lib/error-message.ts";

// The multithreaded apartment Microsoft advises for a UI Automation client
const MULTITHREADED_APARTMENT = 0;

// What winui-svelte's createUiaWorker posts for a read of one window, and what it expects back
interface ReadRequest {
  readonly id: number;
  readonly target: { readonly hwnd: bigint };
  readonly excludeProcessId?: number;
  readonly maxElements?: number;
  readonly maxMilliseconds?: number;
  readonly maxCharacters?: number;
}

function readWindow({ target, excludeProcessId, ...limits }: Omit<ReadRequest, "id">) {
  return withUiaClient<WindowText | null>(client => {
    const root = client.elementFromHandle(target.hwnd);
    const isRootMissing = root === null;
    if (isRootMissing) {
      return null;
    }

    const isOwnProcess = excludeProcessId !== undefined && root.properties().processId === excludeProcessId;
    if (isOwnProcess) {
      return null;
    }

    return readWindowText({
      client,
      root,
      ...limits
    });
  });
}

// winui-svelte runs this body from a file beside its own module, which a bundled app does not have, so
// the app ships it as an entry of its own (uia-worker.ts) and hands createUiaWorker a `spawn` for it
export function startUiaWorker({ port }: { port: MessagePort | null }) {
  const isPortMissing = port === null;
  if (isPortMissing) {
    throw new Error("The UI Automation worker runs in a worker thread");
  }

  DynCom.initialize(MULTITHREADED_APARTMENT);
  port.on("message", async ({ id, ...request }: ReadRequest) => {
    try {
      port.postMessage({
        id,
        text: await readWindow(request)
      });
    } catch (error) {
      port.postMessage({
        id,
        error: errorMessage(error)
      });
    }
  });
}
