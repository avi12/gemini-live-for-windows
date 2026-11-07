import { createFakeWebViewFactory } from "./fake-web-view.ts";
import { createWebHost, RecoveryFailure, type WebHostOptions } from "./web-host.ts";
import { PermissionDecision, PermissionKind, ProcessFailureKind } from "./web-view-port.ts";
import { HomeMessage, type HomeProtocolMap } from "@/google/protocols/home.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const CRASHES_TO_GIVE_UP = 4;

function setup(overrides: Partial<WebHostOptions> = {}) {
  const factory = createFakeWebViewFactory();
  const ready: string[] = [];
  const recovering: number[] = [];
  const failures: RecoveryFailure[] = [];
  const host = createWebHost<HomeProtocolMap>({
    name: "test",
    factory,
    bridgeScript: "bridge();",
    messageTimeoutMs: 500,
    isDebugging: false,
    isNavigationAllowed: uri => uri.startsWith("https://"),
    decidePermission: () => PermissionDecision.allow,
    log: {
      write: () => undefined
    },
    now: () => 0,
    onCoreReady: core => ready.push(core.source),
    onRecovering: () => recovering.push(1),
    onRecoveryFailed: ({ reason }) => failures.push(reason),
    ...overrides
  });
  return {
    factory,
    host,
    ready,
    recovering,
    failures
  };
}

describe("building the control", () => {
  test("injects the bridge, blocks the rotation and wires the policies once", async () => {
    const { host, factory, ready } = setup();
    await host.ensureCore();
    const view = factory.latest;
    assert.ok(view);
    assert.deepEqual(view.scripts, ["bridge();"]);
    assert.deepEqual(view.blocked, ["https://accounts.google.com/RotateCookies*"]);
    assert.equal(view.allows("https://x.example/"), true);
    assert.equal(view.allows("file:///c"), false);
    assert.equal(view.decide(PermissionKind.microphone), PermissionDecision.allow);
    assert.equal(ready.length, 1);
  });

  test("joins a build in flight instead of starting a second", async () => {
    const { host, factory } = setup();
    await Promise.all([host.ensureCore(), host.ensureCore(), host.ensureCore()]);
    assert.equal(factory.views.length, 1);
  });
});

describe("messaging", () => {
  test("a request reaches the page and its reply settles the send", async () => {
    const { host, factory } = setup();
    await host.ensureCore();
    const view = factory.latest;
    assert.ok(view);
    view.answers.set(HomeMessage.ready, true);
    assert.equal(await host.messenger.sendMessage(HomeMessage.ready), true);
    assert.equal(view.requestsOf(HomeMessage.ready).length, 1);
  });

  test("a handler registered once keeps working on the rebuilt control", async () => {
    const { host, factory } = setup();
    const received: unknown[] = [];
    host.messenger.onMessage(HomeMessage.pcLights, message => {
      received.push(message.data);
      return null;
    });
    await host.ensureCore();
    factory.latest?.fail(ProcessFailureKind.browserExited);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(factory.views.length, 2);
    factory.latest?.fromPage({
      id: 1,
      type: HomeMessage.pcLights,
      data: "after",
      timestamp: 0
    });
    assert.deepEqual(received, ["after"]);
  });
});

describe("crash recovery", () => {
  test("a render crash reloads the page in place", async () => {
    const { host, factory, recovering } = setup();
    await host.ensureCore();
    factory.latest?.fail(ProcessFailureKind.other);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(factory.latest?.reloads, 1);
    assert.equal(factory.views.length, 1);
    assert.equal(recovering.length, 1);
  });

  test("a browser crash replaces the control and runs the setup again", async () => {
    const { host, factory, ready, recovering } = setup();
    await host.ensureCore();
    factory.latest?.fail(ProcessFailureKind.browserExited);
    assert.equal(host.core, undefined);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(factory.views.length, 2);
    assert.ok(host.core);
    assert.equal(ready.length, 2);
    assert.equal(recovering.length, 1);
  });

  test("a crash loop gives up until the next use", async () => {
    const { host, factory, failures } = setup();
    await host.ensureCore();
    for (let iCrash = 0; iCrash < CRASHES_TO_GIVE_UP; iCrash += 1) {
      factory.latest?.fail(ProcessFailureKind.browserExited);
      await new Promise(resolve => setImmediate(resolve));
    }

    assert.deepEqual(failures, [RecoveryFailure.crashLoop]);
    assert.equal(host.core, undefined);
    await host.ensureCore();
    assert.ok(host.core);
  });
});
