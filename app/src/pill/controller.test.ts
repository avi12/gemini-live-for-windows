import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GlowMode, PillActionKind, pillViewSchema } from "@gemini-live/protocol/view";
import type { PillView } from "@gemini-live/protocol/view";

import { EngineKind, LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { UpdateCheck } from "@/core/updates/update-checker.ts";
import { INSTALLER_NOTE, NO_UPDATE, UNPACKAGED } from "@/pill/menus/update-menu.ts";
import { createFakePill, PRIMARY, SECONDARY, settle } from "@/pill/test-fakes.ts";

const SECONDARY_NAME = "Display 2 · 2560×1440";
const CHECK_UPDATE: NonNullable<PillView["update"]> = {
  readyVersion: null,
  isAutoUpdateOn: true
};

function displayEntry(monitor: Monitor) {
  return {
    id: monitor.deviceName,
    index: monitor.index,
    isPrimary: monitor.isPrimary,
    refreshRateHertz: monitor.refreshRateHertz,
    x: monitor.x,
    y: monitor.y,
    width: monitor.width,
    height: monitor.height
  };
}

function expectedView(overrides: Partial<PillView> = {}) {
  const view: PillView = {
    status: "",
    statusDetail: "",
    isMuted: false,
    lines: [],
    links: [],
    displays: [displayEntry(PRIMARY), displayEntry(SECONDARY)],
    pillDisplay: PRIMARY.deviceName,
    sharedDisplay: null,
    isExtensionNeeded: false,
    isExtensionStepsShown: false,
    isKeyPromptShown: false,
    engine: EngineKind.GOOGLE,
    microphones: [],
    microphoneId: null,
    isCameraShared: false,
    update: CHECK_UPDATE,
    glow: {
      mode: GlowMode.REST,
      level: 0,
      isUser: false
    },
    isShown: false,
    isFocusable: false,
    ...overrides
  };
  return view;
}

const HEADSET = {
  id: "mic-1",
  name: "Headset"
};
const DESK = {
  id: "mic-2",
  name: "Desk"
};
const LISTENING: Partial<PillView> = {
  status: LiveStatus.LISTENING,
  isShown: true,
  sharedDisplay: PRIMARY.deviceName,
  microphones: [HEADSET, DESK],
  glow: {
    mode: GlowMode.BREATHE,
    level: 0,
    isUser: false
  }
};

async function started(options: Parameters<typeof createFakePill>[0] = {}) {
  const pill = createFakePill(options);
  await pill.controller.onTrigger(KeyTrigger.TAP);
  await settle();
  return pill;
}

describe("the pill view", () => {
  it("is a hidden, idle pill before anything happens", () => {
    const { controller } = createFakePill();
    assert.deepEqual(controller.view(), expectedView({ pillDisplay: null }));
  });

  it("always satisfies the protocol schema", async () => {
    const pill = await started();
    assert.equal(pillViewSchema.safeParse(pill.controller.view()).success, true);
  });

  it("has no update entry when run unpackaged", () => {
    const { controller } = createFakePill({ isPackaged: false });
    assert.equal(controller.view()?.update, null);
  });

  it("starts watching for updates and picks the saved microphone", () => {
    const { calls } = createFakePill();
    assert.deepEqual(calls, ["watch", "selectMicrophone null"]);
  });

  it("coalesces a burst of changes into one view", async () => {
    const pill = await started();
    const seen: PillView[] = [];
    pill.controller.subscribe(view => seen.push(view));
    seen.length = 0;
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: "one"
    });
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: "two"
    });
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: "three"
    });
    await settle();
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.status, "three");
  });

  it("tells a new subscriber the current view first", () => {
    const { controller } = createFakePill();
    const seen: PillView[] = [];
    controller.subscribe(view => seen.push(view));
    assert.deepEqual(seen, [expectedView({ pillDisplay: null })]);
  });
});

describe("starting a conversation", () => {
  it("shows the pill listening, unmuted and shared, on a tap", async () => {
    const pill = await started();
    assert.deepEqual(pill.controller.view(), expectedView(LISTENING));
    assert.equal(pill.engine.calls.started, 1);
    assert.equal(pill.engine.engine.isMuted, false);
    assert.deepEqual(pill.calls.slice(2), ["settle", "cover 1"]);
  });

  it("shows Connecting until the engine is up", async () => {
    const pill = createFakePill();
    const gate = Promise.withResolvers<void>();
    pill.prepareNextEngine({ gate: gate.promise });
    void pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.CONNECTING,
        isShown: true,
        sharedDisplay: PRIMARY.deviceName,
        microphones: [HEADSET, DESK]
      })
    );
    gate.resolve();
    await settle();
    assert.equal(pill.controller.view()?.status, LiveStatus.LISTENING);
  });

  it("follows voice levels instead of breathing when the engine reports them", async () => {
    const pill = createFakePill();
    pill.prepareNextEngine({ reportsLevels: true });
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.equal(pill.controller.view()?.glow.mode, GlowMode.REST);
    pill.engine.emit({
      kind: LiveEventKind.LEVEL,
      peak: 0.4349,
      isUser: false
    });
    await settle();
    assert.deepEqual(pill.controller.view()?.glow, {
      mode: GlowMode.LEVEL,
      level: 0.43,
      isUser: false
    });
  });

  it("starts on the active display", async () => {
    const pill = createFakePill();
    pill.world.active = SECONDARY;
    await pill.controller.onTrigger(KeyTrigger.HOLD_START);
    await settle();
    assert.equal(pill.controller.view()?.sharedDisplay, SECONDARY.deviceName);
  });

  it("clears the last session's captions", async () => {
    const pill = await started();
    pill.engine.emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: "old",
      isUser: true
    });
    await pill.controller.apply({ kind: PillActionKind.END });
    await settle();
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(pill.controller.view()?.lines, []);
  });
});

describe("the engine's events", () => {
  it("turns transcripts into lines and links", async () => {
    const pill = await started();
    pill.engine.emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: "What is the news",
      isUser: true
    });
    pill.engine.emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: "Try example.com",
      isUser: false
    });
    pill.engine.emit({
      kind: LiveEventKind.LINKS,
      links: [
        {
          title: "Weather",
          uri: "https://weather.example.com/tlv"
        }
      ]
    });
    await settle();
    const view = pill.controller.view();
    assert.deepEqual(view?.lines, [
      {
        id: "line-0",
        text: "What is the news",
        isUser: true,
        isNote: false
      },
      {
        id: "line-1",
        text: "Try example.com",
        isUser: false,
        isNote: false
      }
    ]);
    assert.deepEqual(view?.links, [
      {
        id: "link-2",
        title: "example.com",
        uri: "https://example.com",
        address: "example.com",
        isSearch: false
      },
      {
        id: "link-3",
        title: "Weather",
        uri: "https://weather.example.com/tlv",
        address: "weather.example.com/tlv",
        isSearch: false
      }
    ]);
    assert.deepEqual(pill.logs, ["trigger Tap", "link: https://example.com", "link: https://weather.example.com/tlv"]);
  });

  it("shows the engine's own status", async () => {
    const pill = await started();
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: LiveStatus.RECONNECTING
    });
    await settle();
    assert.equal(pill.controller.view()?.status, LiveStatus.RECONNECTING);
  });

  it("keeps the pill up with the reason when the session ends", async () => {
    const pill = await started();
    pill.engine.emit({
      kind: LiveEventKind.ENDED,
      reason: "The connection dropped"
    });
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.STOPPED,
        statusDetail: "The connection dropped",
        isShown: true,
        isMuted: false,
        microphones: [HEADSET, DESK],
        lines: [
          {
            id: "line-0",
            text: "The connection dropped",
            isUser: false,
            isNote: true
          }
        ]
      })
    );
    assert.equal(pill.engine.calls.disposed, 1);
    assert.equal(pill.calls.includes("hideBorder"), true);
  });

  it("ignores events from an engine that was replaced", async () => {
    const pill = await started();
    const first = pill.engine;
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.API_KEY
    });
    await settle();
    first.emit({
      kind: LiveEventKind.ENDED,
      reason: "late"
    });
    await settle();
    assert.equal(pill.controller.view()?.status, LiveStatus.LISTENING);
    assert.deepEqual(pill.controller.view()?.lines, []);
  });
});

describe("a start that fails", () => {
  it("stops with the reason as status detail and a note", async () => {
    const pill = createFakePill();
    pill.prepareNextEngine({ fail: new Error("Gemini is unreachable") });
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.STOPPED,
        statusDetail: "Gemini is unreachable",
        isShown: true,
        microphones: [HEADSET, DESK],
        lines: [
          {
            id: "line-0",
            text: "Gemini is unreachable",
            isUser: false,
            isNote: true
          }
        ]
      })
    );
    assert.equal(pill.engine.calls.disposed, 1);
    assert.equal(pill.logs.includes("start failed: Gemini is unreachable"), true);
  });

  it("asks for a key when the failure is about the API key", async () => {
    const pill = createFakePill({ engineKind: EngineKind.API_KEY });
    pill.prepareNextEngine({ fail: new Error("The API key was rejected") });
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.NEEDS_API_KEY,
        statusDetail: "",
        engine: EngineKind.API_KEY,
        isShown: true,
        isKeyPromptShown: true,
        isFocusable: true,
        microphones: [HEADSET, DESK],
        lines: [
          {
            id: "line-0",
            text: "The API key was rejected",
            isUser: false,
            isNote: true
          }
        ]
      })
    );
  });

  it("says nothing when the session ended while it was connecting", async () => {
    const pill = createFakePill();
    const gate = Promise.withResolvers<void>();
    pill.prepareNextEngine({
      gate: gate.promise,
      fail: new Error("late failure")
    });
    void pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    await pill.controller.apply({ kind: PillActionKind.END });
    gate.resolve();
    await settle();
    assert.equal(pill.controller.view()?.status, LiveStatus.CONNECTING);
    assert.equal(pill.controller.view()?.isShown, false);
    assert.deepEqual(pill.controller.view()?.lines, []);
  });
});

describe("the Copilot key", () => {
  it("ends the conversation on a tap while one runs, and hands focus back", async () => {
    const pill = await started();
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.LISTENING,
        microphones: [HEADSET, DESK]
      })
    );
    assert.equal(pill.engine.calls.disposed, 1);
    assert.equal(pill.calls.at(-1), "restore");
  });

  it("unmutes on a hold while one runs", async () => {
    const pill = await started();
    await pill.controller.apply({ kind: PillActionKind.MUTE });
    assert.equal(pill.controller.view()?.isMuted, true);
    assert.equal(pill.engine.engine.isMuted, true);
    await pill.controller.onTrigger(KeyTrigger.HOLD_START);
    assert.equal(pill.controller.view()?.isMuted, false);
    assert.equal(pill.engine.engine.isMuted, false);
    assert.equal(pill.engines.length, 1);
  });

  it("starts on a hold when idle, and does nothing on release", async () => {
    const pill = createFakePill();
    await pill.controller.onTrigger(KeyTrigger.HOLD_STOP);
    assert.equal(pill.engines.length, 0);
    await pill.controller.onTrigger(KeyTrigger.HOLD_START);
    assert.equal(pill.engines.length, 1);
  });
});

describe("muting", () => {
  it("toggles the tracked state", async () => {
    const pill = await started();
    await pill.controller.apply({ kind: PillActionKind.MUTE });
    assert.equal(pill.controller.view()?.isMuted, true);
    await pill.controller.apply({ kind: PillActionKind.MUTE });
    assert.equal(pill.controller.view()?.isMuted, false);
  });
});

describe("a new session after muting", () => {
  it("never shows the old mute, not even while connecting", async () => {
    const pill = await started();
    await pill.controller.apply({ kind: PillActionKind.MUTE });
    await pill.controller.onTrigger(KeyTrigger.TAP);
    const seen: boolean[] = [];
    pill.controller.subscribe(view => seen.push(view.isMuted));
    seen.length = 0;
    await pill.controller.onTrigger(KeyTrigger.TAP);
    assert.deepEqual([...new Set(seen)], [false]);
  });
});

describe("the API key prompt", () => {
  it("asks first when the engine needs a key and there is none", async () => {
    const pill = await started({
      engineKind: EngineKind.API_KEY,
      hasApiKey: false
    });
    assert.equal(pill.engines.length, 0);
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.NEEDS_API_KEY,
        engine: EngineKind.API_KEY,
        isShown: true,
        isKeyPromptShown: true,
        isFocusable: true,
        microphones: [HEADSET, DESK]
      })
    );
  });

  it("saves a submitted key, hides the prompt and starts over", async () => {
    const pill = await started({
      engineKind: EngineKind.API_KEY,
      hasApiKey: false
    });
    await pill.controller.apply({
      kind: PillActionKind.SUBMIT_KEY,
      key: "AIza-secret"
    });
    await settle();
    assert.equal(pill.calls.includes("setApiKey AIza-secret"), true);
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        ...LISTENING,
        engine: EngineKind.API_KEY
      })
    );
    assert.equal(pill.engine.engine.kind, EngineKind.API_KEY);
  });

  it("goes back to Google when cancelled with no key to fall back on", async () => {
    const pill = await started({
      engineKind: EngineKind.API_KEY,
      hasApiKey: false
    });
    await pill.controller.apply({ kind: PillActionKind.CANCEL_KEY });
    await settle();
    assert.deepEqual(pill.controller.view(), expectedView(LISTENING));
    assert.equal(pill.engine.engine.kind, EngineKind.GOOGLE);
  });

  it("keeps the current key and engine when cancelled with a key saved", async () => {
    const pill = await started({ engineKind: EngineKind.API_KEY });
    await pill.controller.apply({ kind: PillActionKind.ASK_FOR_KEY });
    assert.equal(pill.controller.view()?.isKeyPromptShown, true);
    assert.equal(pill.controller.view()?.status, LiveStatus.LISTENING);
    assert.equal(pill.controller.view()?.isFocusable, true);
    await pill.controller.apply({ kind: PillActionKind.CANCEL_KEY });
    await settle();
    assert.equal(pill.controller.view()?.isKeyPromptShown, false);
    assert.equal(pill.controller.view()?.isFocusable, false);
    assert.equal(pill.controller.view()?.engine, EngineKind.API_KEY);
    assert.equal(pill.engines.length, 1);
  });

  it("stays focusable while the prompt waits, whatever the window asks", async () => {
    const pill = await started({ engineKind: EngineKind.API_KEY });
    await pill.controller.apply({ kind: PillActionKind.ASK_FOR_KEY });
    await pill.controller.apply({
      kind: PillActionKind.SET_FOCUSABLE,
      isFocusable: false
    });
    assert.equal(pill.controller.view()?.isFocusable, true);
  });
});

describe("switching engines", () => {
  it("restarts an open pill on the new engine", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.API_KEY
    });
    await settle();
    assert.equal(pill.engines.length, 2);
    assert.equal(pill.engines[0]?.calls.disposed, 1);
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        ...LISTENING,
        engine: EngineKind.API_KEY
      })
    );
  });

  it("only saves the choice when the pill is closed", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.API_KEY
    });
    await settle();
    assert.equal(pill.engines.length, 0);
    assert.equal(pill.controller.view()?.engine, EngineKind.API_KEY);
    assert.equal(pill.controller.view()?.isShown, false);
  });

  it("does nothing for the engine already chosen", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.GOOGLE
    });
    await settle();
    assert.equal(pill.engines.length, 1);
  });

  it("drops the extension panel when leaving Google", async () => {
    const pill = await started();
    for (const listener of pill.listeners.extension) {
      listener(true);
    }

    await settle();
    assert.equal(pill.controller.view()?.isExtensionNeeded, true);
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.API_KEY
    });
    await settle();
    assert.equal(pill.controller.view()?.isExtensionNeeded, false);
  });
});

describe("the extension steps", () => {
  it("shows the steps after connecting, and hides them once it is no longer needed", async () => {
    const pill = await started();
    for (const listener of pill.listeners.extension) {
      listener(true);
    }

    await pill.controller.apply({ kind: PillActionKind.CONNECT_EXTENSION });
    assert.equal(pill.calls.includes("beginExtensionSetup"), true);
    assert.equal(pill.controller.view()?.isExtensionNeeded, true);
    assert.equal(pill.controller.view()?.isExtensionStepsShown, true);
    for (const listener of pill.listeners.extension) {
      listener(false);
    }

    await settle();
    assert.equal(pill.controller.view()?.isExtensionNeeded, false);
    assert.equal(pill.controller.view()?.isExtensionStepsShown, false);
  });

  it("ignores the need from a Google session winding down after a switch", async () => {
    const pill = await started({ engineKind: EngineKind.API_KEY });
    for (const listener of pill.listeners.extension) {
      listener(true);
    }

    await settle();
    assert.equal(pill.controller.view()?.isExtensionNeeded, false);
  });
});

describe("the microphone menu", () => {
  it("lists the microphones on show and on refresh", async () => {
    const pill = await started();
    pill.world.microphones = [DESK];
    await pill.controller.apply({ kind: PillActionKind.REFRESH_MICROPHONES });
    await settle();
    assert.deepEqual(pill.controller.view()?.microphones, [DESK]);
  });

  it("saves a chosen microphone and tells the engine side", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_MICROPHONE,
      microphoneId: "mic-2"
    });
    assert.equal(pill.controller.view()?.microphoneId, "mic-2");
    assert.equal(pill.world.microphoneId, "mic-2");
    assert.equal(pill.calls.at(-1), "selectMicrophone mic-2");
    assert.equal(pill.logs.at(-1), "microphone -> Desk");
  });

  it("goes back to the Windows default", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_MICROPHONE,
      microphoneId: "mic-2"
    });
    await pill.controller.apply({
      kind: PillActionKind.SET_MICROPHONE,
      microphoneId: null
    });
    assert.equal(pill.controller.view()?.microphoneId, null);
    assert.equal(pill.logs.at(-1), "microphone -> Default (Windows)");
  });

  it("refuses a microphone that is not listed", async () => {
    const pill = await started();
    await assert.rejects(
      pill.controller.apply({
        kind: PillActionKind.SET_MICROPHONE,
        microphoneId: "ghost"
      }),
      { message: "There is no microphone 'ghost'" }
    );
    assert.equal(pill.controller.view()?.microphoneId, null);
  });
});

describe("displays and sharing", () => {
  it("shares another display whole, and drops any focused region", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SHARE,
      displayId: SECONDARY.deviceName
    });
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        ...LISTENING,
        sharedDisplay: SECONDARY.deviceName
      })
    );
    const expectedCalls = ["cover 2", "unfocus"];
    assert.deepEqual(pill.calls.slice(pill.calls.length - expectedCalls.length), expectedCalls);
    assert.equal(pill.logs.at(-1), `sharing ${SECONDARY_NAME}`);
  });

  it("refuses a display that does not exist", async () => {
    const pill = await started();
    await assert.rejects(
      pill.controller.apply({
        kind: PillActionKind.SHARE,
        displayId: "ghost"
      }),
      { message: "There is no display 'ghost'" }
    );
  });

  it("does nothing to share with no conversation", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.SHARE,
      displayId: SECONDARY.deviceName
    });
    assert.equal(pill.controller.view()?.sharedDisplay, null);
  });

  it("moves the share to the active display when the shared one is unplugged", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SHARE,
      displayId: SECONDARY.deviceName
    });
    pill.world.displays = [PRIMARY];
    for (const listener of pill.listeners.displays) {
      listener();
    }

    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        ...LISTENING,
        displays: [displayEntry(PRIMARY)]
      })
    );
    assert.equal(pill.logs.includes("displays changed: 1"), true);
  });

  it("re-shares a display that survived, since its bounds may have moved", async () => {
    const pill = await started();
    const movedPrimary = {
      ...PRIMARY,
      width: SECONDARY.width,
      height: SECONDARY.height
    };
    pill.world.displays = [movedPrimary, SECONDARY];
    for (const listener of pill.listeners.displays) {
      listener();
    }

    await settle();
    assert.equal(pill.calls.at(-1), "unfocus");
    assert.equal(pill.engine.engine.monitor.width, SECONDARY.width);
    assert.equal(pill.controller.view()?.displays[0]?.width, SECONDARY.width);
  });

  it("shows a changed display list even with no conversation", () => {
    const pill = createFakePill();
    pill.world.displays = [PRIMARY];
    for (const listener of pill.listeners.displays) {
      listener();
    }

    assert.equal(pill.controller.view()?.displays.length, 1);
  });
});

describe("the camera", () => {
  it("shares and unshares on the Google engine", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_CAMERA,
      isOn: true
    });
    await settle();
    assert.equal(pill.controller.view()?.isCameraShared, true);
    await pill.controller.apply({
      kind: PillActionKind.SET_CAMERA,
      isOn: false
    });
    await settle();
    assert.equal(pill.controller.view()?.isCameraShared, false);
  });

  it("leaves the camera alone on the API key engine, and logs why", async () => {
    const pill = await started({ engineKind: EngineKind.API_KEY });
    await pill.controller.apply({
      kind: PillActionKind.SET_CAMERA,
      isOn: true
    });
    await settle();
    assert.equal(pill.controller.view()?.isCameraShared, false);
    assert.equal(pill.logs.at(-1), "Camera sharing needs the Gemini subscription engine");
  });

  it("leaves the camera alone with no session running, and logs why", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.SET_CAMERA,
      isOn: true
    });
    await settle();
    assert.equal(pill.controller.view()?.isCameraShared, false);
    assert.equal(pill.logs.at(-1), "Camera sharing needs a running session");
  });
});

describe("updates", () => {
  it("offers a ready update and flags it available", async () => {
    const pill = createFakePill();
    pill.world.readyVersion = "2.0.0";
    for (const listener of pill.listeners.updates) {
      listener();
    }

    await settle();
    assert.deepEqual(pill.controller.view()?.update, {
      readyVersion: "2.0.0",
      isAutoUpdateOn: true
    });
  });

  it("opens the installer and leaves a note", async () => {
    const pill = await started();
    pill.world.readyVersion = "2.0.0";
    await pill.controller.apply({ kind: PillActionKind.UPDATE });
    assert.deepEqual(pill.controller.view()?.lines, [
      {
        id: "line-0",
        text: INSTALLER_NOTE,
        isUser: false,
        isNote: true
      }
    ]);
  });

  it("refuses to install when nothing is ready", async () => {
    const pill = createFakePill();
    pill.world.isInstallOk = false;
    await assert.rejects(pill.controller.apply({ kind: PillActionKind.UPDATE }), { message: NO_UPDATE });
  });

  it("says what a manual check found", async () => {
    const pill = createFakePill();
    await pill.controller.apply({ kind: PillActionKind.CHECK_FOR_UPDATES });
    await settle();
    assert.equal(pill.calls.includes("check true"), true);
    assert.equal(pill.controller.view()?.lines[0]?.text, "Gemini Live 1.0.0 is the latest version.");
    assert.equal(pill.controller.view()?.lines[0]?.isNote, true);
  });

  it("says a ready version, and a failure", async () => {
    const ready = createFakePill();
    ready.world.checkResult = UpdateCheck.READY;
    ready.world.readyVersion = "2.0.0";
    await ready.controller.apply({ kind: PillActionKind.CHECK_FOR_UPDATES });
    await settle();
    assert.equal(
      ready.controller.view()?.lines[0]?.text,
      "Version 2.0.0 is ready. Open the gear menu to restart into it."
    );

    const failed = createFakePill();
    failed.world.checkResult = UpdateCheck.FAILED;
    await failed.controller.apply({ kind: PillActionKind.CHECK_FOR_UPDATES });
    await settle();
    assert.equal(failed.controller.view()?.lines[0]?.text, "Couldn't get the update from GitHub.");
  });

  it("refuses to check when unpackaged", async () => {
    const pill = createFakePill({ isPackaged: false });
    await assert.rejects(pill.controller.apply({ kind: PillActionKind.CHECK_FOR_UPDATES }), { message: UNPACKAGED });
  });

  it("turns looking on its own off and on, looking right away when turned on", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.SET_AUTO_UPDATE,
      isOn: false
    });
    assert.equal(pill.controller.view()?.update?.isAutoUpdateOn, false);
    assert.equal(pill.calls.includes("check false"), false);
    await pill.controller.apply({
      kind: PillActionKind.SET_AUTO_UPDATE,
      isOn: true
    });
    await settle();
    assert.equal(pill.controller.view()?.update?.isAutoUpdateOn, true);
    assert.equal(pill.calls.includes("check false"), true);
  });
});

describe("window actions", () => {
  it("brings the window to the front when it asks to be focusable", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_FOCUSABLE,
      isFocusable: true
    });
    assert.equal(pill.controller.view()?.isFocusable, true);
    assert.equal(pill.calls.at(-1), "bringToFront");
    await pill.controller.apply({
      kind: PillActionKind.SET_FOCUSABLE,
      isFocusable: false
    });
    assert.equal(pill.controller.view()?.isFocusable, false);
  });

  it("moves the window by whole pixels", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.MOVE_BY,
      dx: 10.6,
      dy: -3.2
    });
    assert.equal(pill.calls.at(-1), "moveBy 11 -3");
  });

  it("opens a link by its normalized address", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.OPEN_LINK,
      uri: "https://Example.com"
    });
    assert.equal(pill.calls.at(-1), "open https://example.com/");
  });

  it("ends the conversation and quits", async () => {
    const pill = await started();
    await pill.controller.apply({ kind: PillActionKind.QUIT });
    await settle();
    assert.equal(pill.calls.includes("quit"), true);
    assert.equal(pill.controller.view()?.isShown, false);
    assert.equal(pill.engine.calls.disposed, 1);
  });
});

describe("circling a region", () => {
  it("starts a conversation if none runs, then focuses the region", async () => {
    const pill = createFakePill();
    await pill.controller.focusRegion({
      monitor: SECONDARY,
      region: {
        x: 10,
        y: 10,
        width: 300,
        height: 200
      }
    });
    assert.equal(pill.controller.isRunning, true);
    assert.equal(pill.calls.at(-1), "focusOn 2 300x200");
  });

  it("passes the screen focus the running engine", async () => {
    const pill = await started();
    assert.equal(pill.focusOptions?.currentEngine(), pill.engine.engine);
  });

  it("republishes when the screen focus changes", async () => {
    const pill = await started();
    const seen: PillView[] = [];
    pill.controller.subscribe(view => seen.push(view));
    seen.length = 0;
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: "x"
    });
    for (const listener of pill.listeners.focus) {
      listener();
    }

    await settle();
    assert.equal(seen.length, 1);
  });
});

describe("disposing", () => {
  it("stops listening", () => {
    const pill = createFakePill();
    pill.controller.dispose();
    assert.equal(pill.calls.includes("unwatch"), true);
    assert.equal(pill.listeners.displays.size, 0);
  });
});
