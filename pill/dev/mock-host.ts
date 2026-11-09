import { scenarioView } from "./scenarios.ts";
import type { ScenarioName } from "./scenarios.ts";
import { pillActionSchema, VIEW_NAME } from "@gemini-live/protocol/view";
import type { PillAction, PillView, WindowProtocol } from "@gemini-live/protocol/view";
import { defineMessaging } from "winui-svelte/messaging";
import { diff, MessageType } from "winui-svelte/state/host";
import type { StateProtocol, Transport } from "winui-svelte/state/host";

type MockProtocol = StateProtocol<PillAction> & WindowProtocol;

function report(message: string) {
  process.stderr.write(`dev: ${message}\n`);
}

export function serveMockView({ transport, scenario }: {
  transport: Transport;
  scenario: ScenarioName;
}) {
  const messaging = defineMessaging<MockProtocol>({
    transport,
    onError: error => report(error.message)
  });
  let current: PillView | undefined;

  messaging.onMessage(MessageType.action, message => {
    const parsed = pillActionSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    report(`action ${JSON.stringify(parsed.data)}`);
  });

  function show(name: ScenarioName) {
    const next = scenarioView(name);
    if (!current) {
      messaging.notify(MessageType.snapshot, {
        name: VIEW_NAME,
        value: next
      });
    } else {
      const ops = diff({
        previous: current,
        next
      });
      messaging.notify(MessageType.patch, {
        name: VIEW_NAME,
        ops
      });
    }

    current = next;
    report(`scenario ${name}`);
  }

  show(scenario);

  return {
    show,
    close: () => messaging.close()
  };
}
