import { bringToFront } from "@/overlays/foreground.ts";
import type { ForegroundApi } from "@/overlays/ports.ts";
import { createPreviousApp, FOREGROUND_POLL_MILLISECONDS, SETTLE_MILLISECONDS } from "@/overlays/previous-app.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const OWN_PROCESS = 100;
const BROWSER = 11n;
const EDITOR = 12n;
const PILL_PROCESS = 3;
const SHELL_PROCESS = 4;
const COPILOT_PROCESS = 5;
const NO_WINDOW = 0n;
const PILL = 20n;
const DESKTOP = 30n;
const COPILOT_FRAME = 31n;
const OUR_WINDOW = 32n;
const OURS_THREAD = 5;
const THEIR_THREAD = 9;

function fakeWindows() {
  const calls: string[] = [];
  const state = {
    foreground: NO_WINDOW,
    alive: new Set<bigint>([BROWSER, EDITOR, PILL, DESKTOP, COPILOT_FRAME, OUR_WINDOW]),
    calls
  };
  const classes = new Map<bigint, string>([
    [BROWSER, "Chrome_WidgetWin_1"],
    [EDITOR, "Notepad"],
    [PILL, "WinUIDesktopWin32WindowClass"],
    [DESKTOP, "Progman"],
    [COPILOT_FRAME, "CopilotKeyPressFocusFrame"],
    [OUR_WINDOW, "WinUIDesktopWin32WindowClass"]
  ]);
  const processes = new Map<bigint, number>([
    [BROWSER, 1],
    [EDITOR, 2],
    [PILL, PILL_PROCESS],
    [DESKTOP, SHELL_PROCESS],
    [COPILOT_FRAME, COPILOT_PROCESS],
    [OUR_WINDOW, OWN_PROCESS]
  ]);
  const api: ForegroundApi = {
    foregroundWindow: () => state.foreground,
    isWindow: hwnd => state.alive.has(hwnd),
    classNameOf: hwnd => classes.get(hwnd) ?? "",
    processIdOf: hwnd => processes.get(hwnd) ?? 0,
    threadIdOf: hwnd => (hwnd === NO_WINDOW ? 0 : THEIR_THREAD),
    currentThreadId: () => OURS_THREAD,
    attachThreadInput({ isAttached }) {
      state.calls.push(`attach:${isAttached}`);
      return true;
    },
    bringWindowToTop(hwnd) {
      state.calls.push(`top:${hwnd}`);
    },
    setForegroundWindow(hwnd) {
      state.calls.push(`foreground:${hwnd}`);
      state.foreground = hwnd;
    }
  };
  return {
    state,
    api
  };
}

function createWatched() {
  const windows = fakeWindows();
  const ticks: Array<{
    onTick: () => void;
    milliseconds: number;
  }> = [];
  const delays: number[] = [];
  const lines: string[] = [];
  let isDisposed = false;
  const previous = createPreviousApp({
    api: windows.api,
    startPolling(options) {
      ticks.push(options);
      return () => {
        isDisposed = true;
      };
    },
    async delay(milliseconds) {
      delays.push(milliseconds);
    },
    ownProcessId: OWN_PROCESS,
    ownWindows: () => [PILL],
    log: {
      write: message => lines.push(message)
    }
  });
  return {
    ...windows,
    previous,
    delays,
    lines,
    isStopped: () => isDisposed,
    poll(hwnd: bigint) {
      windows.state.foreground = hwnd;
      ticks[0]?.onTick();
    },
    tick: () => ticks[0]
  };
}

describe("bringToFront", () => {
  it("joins the foreground thread's input, switches, then leaves", () => {
    const { state, api } = fakeWindows();
    state.foreground = BROWSER;
    bringToFront({
      api,
      hwnd: EDITOR
    });
    assert.deepEqual(state.calls, ["attach:true", `top:${EDITOR}`, `foreground:${EDITOR}`, "attach:false"]);
  });

  it("skips the attach when nothing is in front", () => {
    const { state, api } = fakeWindows();
    bringToFront({
      api,
      hwnd: EDITOR
    });
    assert.deepEqual(state.calls, [`top:${EDITOR}`, `foreground:${EDITOR}`]);
  });

  it("skips the attach when the foreground is our own thread", () => {
    const { state, api } = fakeWindows();
    state.foreground = BROWSER;
    bringToFront({
      api: {
        ...api,
        threadIdOf: () => OURS_THREAD
      },
      hwnd: EDITOR
    });
    assert.equal(state.calls.includes("attach:true"), false);
  });

  it("leaves the foreground thread even when the switch throws", () => {
    const { state, api } = fakeWindows();
    state.foreground = BROWSER;
    const failing: ForegroundApi = {
      ...api,
      setForegroundWindow() {
        throw new Error("refused");
      }
    };
    assert.throws(() => bringToFront({
      api: failing,
      hwnd: EDITOR
    }));
    assert.equal(state.calls.at(-1), "attach:false");
  });

  it("does not leave a thread it could not join", () => {
    const { state, api } = fakeWindows();
    state.foreground = BROWSER;
    bringToFront({
      api: {
        ...api,
        attachThreadInput: () => false
      },
      hwnd: EDITOR
    });
    assert.equal(state.calls.includes("attach:false"), false);
  });
});

describe("createPreviousApp", () => {
  it("polls at the named cadence", () => {
    const watched = createWatched();
    assert.equal(watched.tick()?.milliseconds, FOREGROUND_POLL_MILLISECONDS);
  });

  it("stops polling when disposed", () => {
    const watched = createWatched();
    watched.previous.dispose();
    assert.equal(watched.isStopped(), true);
  });

  it("puts the last real app back when Windows left the foreground on the desktop", () => {
    const watched = createWatched();
    watched.poll(BROWSER);
    watched.state.foreground = DESKTOP;
    watched.previous.restore();
    assert.equal(watched.state.foreground, BROWSER);
    assert.deepEqual(watched.lines, ["focus: back to the app that was in front"]);
  });

  it("restores after the Copilot focus frame", () => {
    const watched = createWatched();
    watched.poll(EDITOR);
    watched.poll(COPILOT_FRAME);
    watched.previous.restore();
    assert.equal(watched.state.foreground, EDITOR);
  });

  it("never records the pill or our own windows", () => {
    const watched = createWatched();
    watched.poll(BROWSER);
    watched.poll(PILL);
    watched.poll(OUR_WINDOW);
    watched.state.foreground = NO_WINDOW;
    watched.previous.restore();
    assert.equal(watched.state.foreground, BROWSER);
  });

  it("never records the shell classes", () => {
    const watched = createWatched();
    watched.poll(EDITOR);
    watched.poll(DESKTOP);
    watched.poll(COPILOT_FRAME);
    watched.state.foreground = NO_WINDOW;
    watched.previous.restore();
    assert.equal(watched.state.foreground, EDITOR);
  });

  it("leaves an app the user switched to alone", () => {
    const watched = createWatched();
    watched.poll(BROWSER);
    watched.state.foreground = EDITOR;
    watched.previous.restore();
    assert.equal(watched.state.foreground, EDITOR);
    assert.deepEqual(watched.state.calls, []);
  });

  it("does nothing when there was no previous app", () => {
    const watched = createWatched();
    watched.previous.restore();
    assert.deepEqual(watched.state.calls, []);
  });

  it("does nothing when the previous app closed", () => {
    const watched = createWatched();
    watched.poll(BROWSER);
    watched.state.alive.delete(BROWSER);
    watched.state.foreground = DESKTOP;
    watched.previous.restore();
    assert.deepEqual(watched.state.calls, []);
  });

  it("notes the app already in front when it starts", () => {
    const windows = fakeWindows();
    windows.state.foreground = BROWSER;
    const previous = createPreviousApp({
      api: windows.api,
      startPolling: () => () => undefined,
      delay: async () => undefined,
      ownProcessId: OWN_PROCESS,
      ownWindows: () => [],
      log: {
        write: () => undefined
      }
    });
    windows.state.foreground = DESKTOP;
    previous.restore();
    assert.equal(windows.state.foreground, BROWSER);
  });

  it("waits the settle time before restoring", async () => {
    const watched = createWatched();
    watched.poll(BROWSER);
    watched.state.foreground = COPILOT_FRAME;
    await watched.previous.settle();
    assert.deepEqual(watched.delays, [SETTLE_MILLISECONDS]);
    assert.equal(watched.state.foreground, BROWSER);
  });
});
