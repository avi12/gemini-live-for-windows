import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import { keepRunningOnUnhandledErrors } from "./unhandled-errors.ts";

describe("keepRunningOnUnhandledErrors", () => {
  it("logs an uncaught exception and a rejection", () => {
    const target = new EventEmitter();
    const lines: string[] = [];
    keepRunningOnUnhandledErrors({
      write: line => lines.push(line),
      target
    });

    target.emit("uncaughtException", new Error("boom"));
    target.emit("unhandledRejection", "plain reason");

    assert.match(lines[0] ?? "", /^unhandled: Error: boom/);
    assert.equal(lines[1], "unhandled rejection: plain reason");
  });
});
