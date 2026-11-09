import { ScenarioName, scenarioView } from "./scenarios.ts";
import { pillActionSchema, VIEW_NAME } from "@gemini-live/protocol/view";
import type { PillAction, PillView, WindowProtocol } from "@gemini-live/protocol/view";
import { defineMessaging } from "winui-svelte/messaging";
import { diff, MessageType } from "winui-svelte/state/host";
import type { StateProtocol, Transport } from "winui-svelte/state/host";

type MockProtocol = StateProtocol<PillAction> & WindowProtocol;

const LEVEL_TICK_MILLISECONDS = 80;
const LEVEL_PRECISION = 100;
const LEVEL_WAVE_STEP = 0.35;
const LEVEL_SWING = 0.2;
const LEVEL_BASE = 0.22;
const SPEECH_PERIOD_TICKS = 40;
const SPEECH_PAUSE_TICKS = 12;

function report(message: string) {
  process.stderr.write(`dev: ${message}\n`);
}

function levelAt(tick: number) {
  const isPause = tick % SPEECH_PERIOD_TICKS < SPEECH_PAUSE_TICKS;
  if (isPause) {
    return 0;
  }

  return LEVEL_BASE + LEVEL_SWING * Math.sin(tick * LEVEL_WAVE_STEP);
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
  let levelTimer: ReturnType<typeof setInterval> | undefined;

  messaging.onMessage(MessageType.action, message => {
    const parsed = pillActionSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    report(`action ${JSON.stringify(parsed.data)}`);
  });

  function publish(next: PillView) {
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
  }

  function animateLevel(base: PillView) {
    let tick = 0;
    levelTimer = setInterval(() => {
      tick += 1;
      publish({
        ...base,
        glow: {
          ...base.glow,
          level: Math.round(levelAt(tick) * LEVEL_PRECISION) / LEVEL_PRECISION
        }
      });
    }, LEVEL_TICK_MILLISECONDS);
  }

  function show(name: ScenarioName) {
    clearInterval(levelTimer);
    const next = scenarioView(name);
    const isAnimated = name === ScenarioName.listening;
    publish(next);

    if (isAnimated) {
      animateLevel(next);
    }

    report(`scenario ${name}`);
  }

  show(scenario);

  return {
    show,
    close() {
      clearInterval(levelTimer);
      messaging.close();
    }
  };
}
