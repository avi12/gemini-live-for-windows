import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import type { BrowserCookie } from "@gemini-live/protocol/link";

import { LiveStatus } from "@/contracts/live-engine.ts";
import type { MediaPort } from "@/google/ports.ts";
import { Direction, GlicMessage, GlicState, PageError } from "@/google/protocols/glic.ts";
import type { SessionStore } from "@/google/session/cookies.ts";
import type { SessionSource } from "@/google/session/session-link.ts";
import { createSharedView } from "@/google/shared-view.ts";
import { createFakeWebViewFactory, type FakeWebView } from "@/google/web-host/fake-web-view.ts";

import { type GlicHostEvent, GlicHostEventKind } from "./glic-events.ts";
import { createGlicHost } from "./glic-host.ts";
import { pageErrorOf } from "./page/glic-recovery.ts";
import { sessionNoticeFor } from "./session/glic-session-wait.ts";

const REFRESH_GRACE_MS = 25_000;
const RESTART_BUDGET = 3;
const BREAKS = RESTART_BUDGET + 1;
const PULL_ID = 5;
// a key down and a key up for each of the two characters of "hi"
const KEY_EVENTS_FOR_HI = 4;

const MONITOR = {
  deviceName: "D1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  workRight: 100,
  workBottom: 100,
  refreshRateHertz: 60
};

function cookie(name: string) {
  const result: BrowserCookie = {
    name,
    value: "v",
    domain: ".google.com",
    path: "/",
    secure: true,
    httpOnly: true
  };
  return result;
}

function setup({ saved = [] }: { saved?: BrowserCookie[] } = {}) {
  const factory = createFakeWebViewFactory();
  const saves: BrowserCookie[][] = [];
  const store: SessionStore = {
    load: async () => saved,
    async save(cookies) {
      saves.push([...cookies]);
    }
  };
  const cookieListeners: ((cookies: readonly BrowserCookie[]) => void)[] = [];
  const requests = {
    cookies: 0,
    refreshes: 0
  };
  const link: SessionSource = {
    isExtensionConnected: false,
    onCookies(listener) {
      cookieListeners.push(listener);
      return () => undefined;
    },
    onConnected: () => () => undefined,
    requestCookies() {
      requests.cookies += 1;
    },
    requestRefresh() {
      requests.refreshes += 1;
    }
  };
  const media: MediaPort = {
    grab: async () => ({
      jpeg: new Uint8Array([1, 2]),
      width: 10,
      height: 5
    }),
    readScreenText: async () => undefined,
    async openWebcam() {
      throw new Error("no camera");
    }
  };
  const view = createSharedView({
    media,
    monitor: MONITOR,
    log: {
      write: () => undefined
    }
  });
  const host = createGlicHost({
    factory,
    bridgeScript: "bridge();",
    link,
    store,
    view,
    log: {
      write: () => undefined
    },
    now: () => Date.now(),
    isDebugging: false
  });
  const events: GlicHostEvent[] = [];
  host.onEvent(event => events.push(event));
  return {
    factory,
    host,
    events,
    saves,
    requests,
    adopt(cookies: BrowserCookie[]) {
      for (const listener of cookieListeners) {
        listener(cookies);
      }
    }
  };
}

function flush() {
  return new Promise<void>(resolve => setImmediate(resolve));
}

// The page announces itself the way its bridge does
function pageSends({ view, type, data }: { view: FakeWebView | undefined; type: string; data?: unknown }) {
  view?.fromPage({
    id: 99,
    type,
    data: data ?? null,
    timestamp: 0
  });
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
});

afterEach(() => {
  mock.timers.reset();
});

describe("session notices", () => {
  test("say what the user can do about the missing session", () => {
    assert.equal(
      sessionNoticeFor({
        isConnected: true,
        isInstalled: true,
        isStale: true
      }),
      "Refreshing your Google session…"
    );
    assert.equal(
      sessionNoticeFor({
        isConnected: true,
        isInstalled: true,
        isStale: false
      }),
      "Sign in to Google in your browser"
    );
    assert.equal(
      sessionNoticeFor({
        isConnected: false,
        isInstalled: true,
        isStale: true
      }),
      "Waiting for your browser…"
    );
    assert.equal(
      sessionNoticeFor({
        isConnected: false,
        isInstalled: false,
        isStale: false
      }),
      "One-time setup"
    );
  });

  test("a page error code is recognized, anything else is a message", () => {
    assert.equal(pageErrorOf("live-broke"), PageError.LIVE_BROKE);
    assert.equal(pageErrorOf("Gemini page did not start"), undefined);
  });
});

describe("warm-up", () => {
  test("injects the saved session and loads glic", async () => {
    const { host, factory } = setup({ saved: [cookie("SID")] });
    await host.warmUp();
    const view = factory.latest;
    assert.deepEqual(
      view?.cookies[0]?.map(item => item.name),
      ["SID"]
    );
    assert.deepEqual(view?.navigations, ["https://gemini.google.com/glic"]);
    assert.deepEqual(view?.scripts, ["bridge();"]);
  });
});

describe("starting Live", () => {
  test("waits for the page to boot, starts, and resolves once it is live", async () => {
    const { host, factory } = setup({ saved: [cookie("SID")] });
    await host.warmUp();
    const started = host.start();
    assert.equal(factory.latest?.requestsOf(GlicMessage.START).length, 0);

    pageSends({
      view: factory.latest,
      type: GlicMessage.BOOTED
    });
    await flush();
    assert.equal(factory.latest?.requestsOf(GlicMessage.START).length, 1);

    pageSends({
      view: factory.latest,
      type: GlicMessage.READY
    });
    await started;
  });

  test("with no session it asks the extension and says the setup is needed", async () => {
    const { host, events, requests } = setup();
    await host.warmUp();
    void host.start();
    assert.equal(requests.cookies, 1);
    assert.deepEqual(
      events.map(event => event.kind),
      [GlicHostEventKind.NOTICE, GlicHostEventKind.EXTENSION_NEEDED]
    );
    assert.deepEqual(events[0], {
      kind: GlicHostEventKind.NOTICE,
      notice: "One-time setup"
    });
  });

  test("a session the page rejects is refreshed, then the user is told to sign in", async () => {
    const { host, factory, events, requests } = setup({ saved: [cookie("SID")] });
    await host.warmUp();
    void host.start();
    pageSends({
      view: factory.latest,
      type: GlicMessage.ERROR,
      data: PageError.UNAVAILABLE
    });
    assert.equal(requests.refreshes, 1);
    mock.timers.tick(REFRESH_GRACE_MS);
    assert.deepEqual(events.at(-1), {
      kind: GlicHostEventKind.NOTICE,
      notice: "Sign in to Google in your browser"
    });
  });

  test("a new session from the browser is saved, injected and reloads a page that never booted", async () => {
    const { host, factory, saves, adopt } = setup();
    await host.warmUp();
    adopt([cookie("SID")]);
    adopt([cookie("SID")]);
    await flush();
    assert.equal(saves.length, 1);
    assert.deepEqual(
      factory.latest?.cookies.map(list => list.length),
      [0, 1]
    );
    assert.equal(factory.latest?.navigations.length, 2);
  });
});

describe("reports from the page", () => {
  test("captions and states become events", async () => {
    const { host, factory, events } = setup({ saved: [cookie("SID")] });
    await host.warmUp();
    pageSends({
      view: factory.latest,
      type: GlicMessage.TRANSCRIPT,
      data: {
        text: "hi",
        direction: Direction.USER,
        index: 2
      }
    });
    pageSends({
      view: factory.latest,
      type: GlicMessage.STATE,
      data: GlicState.RESUMING
    });
    pageSends({
      view: factory.latest,
      type: GlicMessage.STATE,
      data: "nonsense"
    });
    assert.deepEqual(events, [
      {
        kind: GlicHostEventKind.CAPTION,
        text: "hi",
        isUser: true,
        index: 2
      },
      {
        kind: GlicHostEventKind.STATE,
        isListening: false
      }
    ]);
  });

  test("a broken Live reloads the page three times, then fails", async () => {
    const { host, factory, events } = setup({ saved: [cookie("SID")] });
    await host.warmUp();
    void host.start();
    for (let iBreak = 0; iBreak < BREAKS; iBreak += 1) {
      pageSends({
        view: factory.latest,
        type: GlicMessage.ERROR,
        data: PageError.LIVE_BROKE
      });
    }

    const reconnecting = events.filter(
      event => event.kind === GlicHostEventKind.NOTICE && event.notice === LiveStatus.RECONNECTING
    );
    assert.equal(reconnecting.length, RESTART_BUDGET);
    assert.deepEqual(events.at(-1), {
      kind: GlicHostEventKind.FAILED,
      message: "Gemini Live stopped working"
    });
    assert.equal(factory.latest?.navigations.length, RESTART_BUDGET + 1);
  });

  test("the page's picture pull is answered from the shared view", async () => {
    const { host, factory } = setup({ saved: [cookie("SID")] });
    await host.warmUp();
    factory.latest?.fromPage({
      id: PULL_ID,
      type: GlicMessage.CAPTURE,
      data: null,
      timestamp: 0
    });
    await flush();
    const reply = factory.latest?.posted.find(
      envelope =>
        typeof envelope === "object" && envelope !== null && "replyTo" in envelope && envelope.replyTo === PULL_ID
    );
    assert.deepEqual(reply, {
      replyTo: PULL_ID,
      res: {
        data: "AQI=",
        mimeType: "image/jpeg",
        width: 10,
        height: 5
      }
    });
  });
});

describe("text action", () => {
  test("opens the text box, types trusted keys and returns the checked answer", async () => {
    const { host, factory } = setup({ saved: [cookie("SID")] });
    await host.warmUp();
    factory.latest?.answers.set(GlicMessage.BEGIN_ACTION, true);
    factory.latest?.answers.set(GlicMessage.SUBMIT_AND_READ, {
      text: "ok",
      links: [
        {
          title: "t",
          url: "https://u"
        }
      ]
    });
    const answer = await host.runAction("hi");
    assert.equal(factory.latest?.devTools.length, KEY_EVENTS_FOR_HI);
    assert.equal(answer.text, "ok");
    assert.equal(answer.links[0]?.url, "https://u");
  });

  test("fails when the text box does not open", async () => {
    const { host, factory } = setup({ saved: [cookie("SID")] });
    await host.warmUp();
    factory.latest?.answers.set(GlicMessage.BEGIN_ACTION, false);
    await assert.rejects(host.runAction("hi"), /text box/);
  });
});
