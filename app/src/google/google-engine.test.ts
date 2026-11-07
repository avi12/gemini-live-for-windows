import { type GlicHostEvent, GlicHostEventKind } from "./glic-events.ts";
import { createGoogleEngine } from "./google-engine.ts";
import type { MediaPort } from "./ports.ts";
import { createSharedView } from "./shared-view.ts";
import { EngineKind, type LiveEvent, LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";
import assert from "node:assert/strict";
import {
  afterEach,
  beforeEach,
  describe,
  mock,
  test
} from "node:test";

const MONITOR = {
  deviceName: "D1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  workRight: 100,
  workBottom: 100
};

const PARTIAL_PAUSE_MS = 500;
const SETTLED_MS = 1200;
const DETOUR_MS = 6000;
const LONG_DETOUR_MS = 8000;
const QUIET_MS = 2000;
const REFUSAL_INDEX = 7;

const media: MediaPort = {
  grab: async () => undefined,
  readScreenText: async () => undefined,
  async openWebcam() {
    throw new Error("no camera");
  }
};

function setup() {
  const hostListeners: Array<(event: GlicHostEvent) => void> = [];
  const muted: boolean[] = [];
  const actions: string[] = [];
  const lights: boolean[] = [];
  const calls = {
    starts: 0,
    stops: 0,
    muted,
    actions,
    lights
  };
  const engine = createGoogleEngine({
    host: {
      onEvent(listener) {
        hostListeners.push(listener);
        return () => undefined;
      },
      start: async () => void (calls.starts += 1),
      stop: async () => void (calls.stops += 1),
      setMuted: async isMuted => void calls.muted.push(isMuted),
      async runAction(prompt) {
        calls.actions.push(prompt);
        return {
          text: "answer",
          links: [{
            title: "Doc",
            url: "https://doc"
          }]
        };
      }
    },
    home: {
      async setLights(isOn) {
        calls.lights.push(isOn);
        return `lights ${isOn}`;
      }
    },
    view: createSharedView({
      media,
      monitor: MONITOR,
      log: {
        write: () => undefined
      }
    }),
    log: {
      write: () => undefined
    },
    now: () => Date.now()
  });
  const events: LiveEvent[] = [];
  engine.onEvent(event => events.push(event));
  function hostSays(event: GlicHostEvent) {
    for (const listener of hostListeners) {
      listener(event);
    }
  }
  return {
    engine,
    events,
    calls,
    user: (text: string, index = 0) => hostSays({
      kind: GlicHostEventKind.caption,
      text,
      isUser: true,
      index
    }),
    gemini: (text: string, index = 1) => hostSays({
      kind: GlicHostEventKind.caption,
      text,
      isUser: false,
      index
    }),
    hostSays
  };
}

// Lets the awaited steps of a detour run between clock ticks
async function advance(durationMs: number) {
  const step = 150;
  for (let elapsed = 0; elapsed < durationMs; elapsed += step) {
    mock.timers.tick(step);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
});

afterEach(() => {
  mock.timers.reset();
});

describe("the engine contract", () => {
  test("is the Google engine with no levels", () => {
    const { engine } = setup();
    assert.equal(engine.kind, EngineKind.google);
    assert.equal(engine.reportsLevels, false);
  });

  test("mute, share and region go to the host and the shared view", () => {
    const { engine, calls } = setup();
    engine.isMuted = true;
    assert.deepEqual(calls.muted, [true]);
    engine.region = {
      x: 1,
      y: 2,
      width: 3,
      height: 4
    };
    engine.share({
      ...MONITOR,
      deviceName: "D2",
      index: 2
    });
    assert.equal(engine.monitor.deviceName, "D2");
    assert.equal(engine.region, undefined);
  });

  test("maps the host's state, captions and failure", () => {
    const { events, hostSays, gemini } = setup();
    hostSays({
      kind: GlicHostEventKind.state,
      isListening: true
    });
    hostSays({
      kind: GlicHostEventKind.notice,
      notice: "Waiting for your browser…"
    });
    gemini(String.raw`It is 17\.3 degrees`);
    hostSays({
      kind: GlicHostEventKind.failed,
      message: "boom"
    });
    assert.deepEqual(events, [
      {
        kind: LiveEventKind.status,
        status: LiveStatus.listening
      },
      {
        kind: LiveEventKind.status,
        status: "Waiting for your browser…"
      },
      {
        kind: LiveEventKind.transcript,
        text: "It is 17.3 degrees",
        isUser: false
      },
      {
        kind: LiveEventKind.ended,
        reason: "boom"
      }
    ]);
  });

  test("tells the controller when the extension is needed", () => {
    const { engine, hostSays } = setup();
    const needed: boolean[] = [];
    engine.onExtensionNeeded(isNeeded => needed.push(isNeeded));
    hostSays({
      kind: GlicHostEventKind.extensionNeeded,
      isNeeded: true
    });
    assert.deepEqual(needed, [true]);
  });

  test("dispose stops the host", async () => {
    const { engine, calls } = setup();
    await engine.dispose();
    assert.equal(calls.stops, 1);
  });
});

describe("detours", () => {
  test("a lights command goes to Home once the utterance settles", async () => {
    const { user, calls, events } = setup();
    user("turn off");
    await advance(PARTIAL_PAUSE_MS);
    user("turn off the lights");
    await advance(SETTLED_MS);
    assert.deepEqual(calls.lights, [false]);
    assert.ok(events.some(event => event.kind === LiveEventKind.transcript && event.text === "lights false"));
    assert.deepEqual(events.at(-1), {
      kind: LiveEventKind.status,
      status: LiveStatus.listening
    });
  });

  test("an app request waits for Gemini to finish, asks the text path and resumes Live", async () => {
    const { user, gemini, calls, events } = setup();
    user("add a meeting for tomorrow");
    await advance(SETTLED_MS);
    gemini("Sure, adding it");
    await advance(DETOUR_MS);
    assert.deepEqual(calls.actions, ["add a meeting for tomorrow"]);
    assert.equal(calls.starts, 1);
    assert.ok(events.some(event => event.kind === LiveEventKind.status && event.status === "Checking Calendar…"));
    assert.ok(events.some(event => event.kind === LiveEventKind.links && event.links[0]?.uri === "https://doc"));
  });

  test("Gemini's refusal triggers the detour even when the request was not recognized up front", async () => {
    const { user, gemini, calls } = setup();
    user("what is on my agenda");
    gemini("I can't access your calendar", REFUSAL_INDEX);
    await advance(LONG_DETOUR_MS);
    assert.equal(calls.actions.length, 1);
  });

  test("the same request is not handled twice", async () => {
    const { user, gemini, calls } = setup();
    user("search the web for cats");
    await advance(SETTLED_MS);
    gemini("I can't browse the internet", REFUSAL_INDEX);
    await advance(LONG_DETOUR_MS);
    assert.equal(calls.actions.length, 1);
  });

  test("chatter Live can answer is left alone", async () => {
    const { user, calls } = setup();
    user("how are you today");
    await advance(QUIET_MS);
    assert.equal(calls.actions.length + calls.lights.length, 0);
  });
});
