import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageChannel } from "node:worker_threads";

import { createMessagePortTransport } from "winui-svelte/state/host";

import { KeyTrigger } from "@/core/instance/key-trigger.ts";

import { createKeyTriggerSender, KeySource, keyTriggerSchema, serveKeyTriggers } from "./protocol.ts";
import type { KeyTriggerPayload } from "./protocol.ts";

describe("key trigger link", () => {
  it("delivers a trigger from the worker's end to the main thread's end", async () => {
    const channel = new MessageChannel();
    const received: KeyTriggerPayload[] = [];
    const arrived = Promise.withResolvers<void>();
    const stop = serveKeyTriggers({
      transport: createMessagePortTransport({ port: channel.port1 }),
      onTrigger(payload) {
        received.push(payload);
        arrived.resolve();
      },
      log: () => undefined
    });
    const send = createKeyTriggerSender({ transport: createMessagePortTransport({ port: channel.port2 }) });
    send({
      trigger: KeyTrigger.HOLD_START,
      source: KeySource.FAST_PATH
    });
    await arrived.promise;
    assert.deepEqual(received, [
      {
        trigger: KeyTrigger.HOLD_START,
        source: KeySource.FAST_PATH
      }
    ]);
    stop();
    channel.port1.close();
    channel.port2.close();
  });
});

describe("keyTriggerSchema", () => {
  it("refuses unknown triggers and sources", () => {
    assert.equal(
      keyTriggerSchema.safeParse({
        trigger: "Nope",
        source: KeySource.FAST_PATH
      }).success,
      false
    );
    assert.equal(
      keyTriggerSchema.safeParse({
        trigger: KeyTrigger.TAP,
        source: "x"
      }).success,
      false
    );
  });
});
