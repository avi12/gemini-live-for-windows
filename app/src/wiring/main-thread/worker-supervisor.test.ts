import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_RAPID_RESTARTS,
  planRestart,
  RAPID_RESTARTS_VARIABLE,
  rapidRestartsOf,
  restartCommand,
  STABLE_RUN_MILLISECONDS,
  superviseUiWorker
} from "./worker-supervisor.ts";

describe("planRestart", () => {
  it("counts a window that died soon after it started", () => {
    assert.deepEqual(
      planRestart({
        rapidRestarts: 2,
        ranMilliseconds: 500
      }),
      {
        rapidRestarts: 3,
        isGivingUp: false
      }
    );
  });

  it("starts the count over after a long run", () => {
    assert.deepEqual(
      planRestart({
        rapidRestarts: 4,
        ranMilliseconds: STABLE_RUN_MILLISECONDS
      }),
      {
        rapidRestarts: 0,
        isGivingUp: false
      }
    );
  });

  it("gives up once it has restarted too many times in a row", () => {
    const plan = planRestart({
      rapidRestarts: MAX_RAPID_RESTARTS,
      ranMilliseconds: 10
    });
    assert.equal(plan.isGivingUp, true);
  });
});

describe("rapidRestartsOf", () => {
  it("reads the count the previous copy passed on", () => {
    assert.equal(rapidRestartsOf({ [RAPID_RESTARTS_VARIABLE]: "4" }), MAX_RAPID_RESTARTS - 1);
  });

  it("is zero when it is missing or not a count", () => {
    assert.equal(rapidRestartsOf({}), 0);
    assert.equal(rapidRestartsOf({ [RAPID_RESTARTS_VARIABLE]: "many" }), 0);
    assert.equal(rapidRestartsOf({ [RAPID_RESTARTS_VARIABLE]: "-2" }), 0);
  });
});

describe("restartCommand", () => {
  it("is the executable alone for a single-executable app", () => {
    assert.deepEqual(
      restartCommand({
        isSingleExecutable: true,
        execPath: "C:/app/GeminiLive.exe",
        execArgv: [],
        script: "C:/app/GeminiLive.exe"
      }),
      {
        file: "C:/app/GeminiLive.exe",
        args: ["--recovered"]
      }
    );
  });

  it("is Node with its flags and the script otherwise", () => {
    assert.deepEqual(
      restartCommand({
        isSingleExecutable: false,
        execPath: "node.exe",
        execArgv: ["--no-warnings"],
        script: "main.js"
      }),
      {
        file: "node.exe",
        args: ["--no-warnings", "main.js", "--recovered"]
      }
    );
  });
});

describe("superviseUiWorker", () => {
  function setup() {
    const steps: string[] = [];
    return {
      steps,
      options: {
        exitCode: 1,
        release() {
          steps.push("release");
          return Promise.resolve();
        },
        relaunch: (count: number) => steps.push(`relaunch ${count}`),
        delay() {
          steps.push("delay");
          return Promise.resolve();
        },
        log: (message: string) => steps.push(message)
      }
    };
  }

  it("lets go, waits and starts again, passing the count on", async () => {
    const { steps, options } = setup();
    const isRestarting = await superviseUiWorker({
      ...options,
      ranMilliseconds: 100,
      rapidRestarts: 1
    });
    assert.equal(isRestarting, true);
    assert.deepEqual(steps, ["pill: the window exited with 1", "release", "delay", "relaunch 2"]);
  });

  it("leaves the app down when the window keeps dying", async () => {
    const { steps, options } = setup();
    const isRestarting = await superviseUiWorker({
      ...options,
      ranMilliseconds: 100,
      rapidRestarts: MAX_RAPID_RESTARTS
    });
    assert.equal(isRestarting, false);
    assert.deepEqual(steps, ["pill: the window exited with 1", "pill: the window keeps exiting; giving up"]);
  });
});
