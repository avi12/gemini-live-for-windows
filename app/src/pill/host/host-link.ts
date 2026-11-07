import type { PillController } from "@/pill/controller.ts";
import type { PillWindowPort } from "@/pill/ports.ts";
import { pillActionSchema, VIEW_NAME, WindowMessage } from "@gemini-live/protocol/view";
import type { PillAction, PillView, WindowProtocol } from "@gemini-live/protocol/view";
import { defineMessaging } from "winui-svelte/messaging";
import { diff, MessageType } from "winui-svelte/state/host";
import type { StateProtocol, Transport } from "winui-svelte/state/host";

// Everything on the pill's link: the state protocol, and what only the window can do
export type PillProtocol = StateProtocol<PillAction> & WindowProtocol;

export interface PillLinkSetup {
  // The pill window's end of the link: a MessagePort pair between the main thread and the UI worker
  transport: Transport;
  log(message: string): void;
}

// The main thread's end of the link to the pill window. The window's own abilities come first,
// since the controller is built over them; `serve` then hands it the view and takes its actions.
export function openPillLink({ transport, log }: PillLinkSetup) {
  const messaging = defineMessaging<PillProtocol>({
    transport,
    onError: error => log(`pill: ${error.message}`)
  });

  const windowPort: PillWindowPort = {
    bringToFront: () => messaging.notify(WindowMessage.bringToFront),
    moveBy: data => messaging.notify(WindowMessage.moveBy, data)
  };

  // Serves the view over the state protocol: a snapshot first, then a patch after each change
  // (always ahead of the answer to the action that caused it); every action the window sends
  // goes to the controller, whose refusal is the answer's error.
  function serve(controller: Pick<PillController, "apply" | "subscribe">) {
    messaging.onMessage(MessageType.action, async message => {
      const parsed = pillActionSchema.safeParse(message.data);
      if (!parsed.success) {
        log(`pill: refused an action: ${parsed.error.message}`);
        throw new Error(parsed.error.message);
      }

      await controller.apply(parsed.data);
    });

    let previous: PillView | undefined;
    const stop = controller.subscribe(view => {
      if (!previous) {
        messaging.notify(MessageType.snapshot, {
          name: VIEW_NAME,
          value: view
        });
      } else {
        const ops = diff({
          previous,
          next: view
        });
        const isChanged = ops.length > 0;
        if (isChanged) {
          messaging.notify(MessageType.patch, {
            name: VIEW_NAME,
            ops
          });
        }
      }

      previous = view;
    });

    return () => {
      stop();
      messaging.close();
    };
  }

  return {
    windowPort,
    serve
  };
}
