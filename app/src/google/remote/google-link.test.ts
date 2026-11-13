import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EngineKind, LiveEventKind } from "@/contracts/live-engine.ts";
import type { LiveEvent } from "@/contracts/live-engine.ts";
import { linkedTransports } from "@/lib/transport/linked-transports.ts";
import { createFakeEngine, PRIMARY, SECONDARY, settle } from "@/pill/test-fakes.ts";
import type { FakeEngine } from "@/pill/test-fakes.ts";

import { connectGoogle } from "./google-client.ts";
import { serveGoogle } from "./google-server.ts";
import type { GoogleHostServices } from "./google-server.ts";

const REGION = {
  x: 1,
  y: 2,
  width: 30,
  height: 40
};

function setup() {
  const transports = linkedTransports();
  const engines: FakeEngine[] = [];
  const extensionListeners = new Set<(isNeeded: boolean) => void>();
  const microphoneIds: (string | null)[] = [];
  const lines: string[] = [];
  const services: GoogleHostServices = {
    createEngine(monitor) {
      const fake = createFakeEngine({
        kind: EngineKind.GOOGLE,
        monitor,
        extensionListeners
      });
      engines.push(fake);
      return fake.engine;
    },
    setMicrophone(id) {
      microphoneIds.push(id);
    },
    listMicrophones: () =>
      Promise.resolve([
        {
          id: "mic-1",
          label: "Headset"
        }
      ])
  };
  serveGoogle({
    transport: transports.second,
    services,
    log: {
      write: message => lines.push(message)
    }
  });
  const client = connectGoogle({
    transport: transports.first,
    log: {
      write: message => lines.push(message)
    }
  });
  return {
    client,
    engines,
    extensionListeners,
    microphoneIds,
    lines
  };
}

describe("the Google link", () => {
  it("starts the engine behind it and resolves when it is listening", async () => {
    const { client, engines } = setup();
    const engine = client.createEngine(PRIMARY);
    await engine.start();
    assert.equal(engines.length, 1);
    assert.equal(engines[0]?.calls.started, 1);
  });

  it("rejects a start the engine refused, with its reason", async () => {
    const { client, engines } = setup();
    const engine = client.createEngine(PRIMARY);
    await settle();
    const [behind] = engines;
    assert.ok(behind);
    behind.startControl.fail = new Error("no session");
    await assert.rejects(engine.start(), /no session/);
  });

  it("carries the engine's events across", async () => {
    const { client, engines } = setup();
    const engine = client.createEngine(PRIMARY);
    const heard: LiveEvent[] = [];
    engine.onEvent(event => heard.push(event));
    await settle();
    engines[0]?.emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: "hello",
      isUser: true
    });
    await settle();
    assert.deepEqual(heard, [
      {
        kind: LiveEventKind.TRANSCRIPT,
        text: "hello",
        isUser: true
      }
    ]);
  });

  it("carries mute, the region and a shared display to the engine, and remembers them here", async () => {
    const { client, engines } = setup();
    const engine = client.createEngine(PRIMARY);
    engine.isMuted = true;
    engine.region = REGION;
    await settle();
    assert.equal(engines[0]?.engine.isMuted, true);
    assert.deepEqual(engines[0]?.engine.region, REGION);
    assert.deepEqual(engine.region, REGION);

    engine.share(SECONDARY);
    await settle();
    assert.equal(engines[0]?.engine.monitor.deviceName, SECONDARY.deviceName);
    assert.equal(engine.monitor.deviceName, SECONDARY.deviceName);
    assert.equal(engine.region, undefined);
    assert.equal(engines[0]?.engine.region, undefined);
  });

  it("switches the camera and reports whether it took", async () => {
    const { client, engines } = setup();
    const engine = client.createEngine(PRIMARY);
    assert.equal(engine.isCameraShared, false);
    assert.equal(await engine.useCamera(true), true);
    assert.equal(engine.isCameraShared, true);
    assert.equal(engines[0]?.engine.isCameraShared, true);
    assert.equal(await engine.useCamera(false), true);
    assert.equal(engine.isCameraShared, false);
  });

  it("tells when the extension is needed", async () => {
    const { client, extensionListeners } = setup();
    const engine = client.createEngine(PRIMARY);
    const needed: boolean[] = [];
    engine.onExtensionNeeded(isNeeded => needed.push(isNeeded));
    await settle();
    for (const listener of extensionListeners) {
      listener(true);
    }

    await settle();
    assert.deepEqual(needed, [true]);
  });

  it("disposes the engine behind it and answers a later call with an error", async () => {
    const { client, engines } = setup();
    const engine = client.createEngine(PRIMARY);
    await engine.start();
    await engine.dispose();
    assert.equal(engines[0]?.calls.disposed, 1);
    await assert.rejects(engine.start(), /There is no engine/);
  });

  it("lists and selects microphones", async () => {
    const { client, microphoneIds } = setup();
    assert.deepEqual(await client.microphones.list(), [
      {
        id: "mic-1",
        name: "Headset"
      }
    ]);
    client.microphones.select("mic-1");
    client.microphones.select(null);
    await settle();
    assert.deepEqual(microphoneIds, ["mic-1", null]);
  });
});
