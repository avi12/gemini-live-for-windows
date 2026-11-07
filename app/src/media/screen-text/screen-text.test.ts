import { appNameOf } from "./foreground-window.ts";
import type { ForegroundWindow } from "./foreground-window.ts";
import { createOcrScreenTextReader } from "./screen-text.ts";
import type { ScreenTextDeps } from "./screen-text.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";
import { ScreenDetail } from "@/media/screen/capture-geometry.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const MONITOR: Monitor = {
  deviceName: "\\\\.\\DISPLAY2",
  index: 2,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 3840,
  height: 2160,
  workRight: 3840,
  workBottom: 2112
};
const OWN_PID = 100;

const WINDOW: ForegroundWindow = {
  hwnd: 5n,
  title: "Article - Browser",
  processId: 200,
  appName: "msedge",
  bounds: {
    x: 100,
    y: 50,
    width: 1600,
    height: 900
  }
};

const LINES: OcrLine[] = [{
  words: [{
    text: "Hello",
    bounds: {
      x: 0,
      y: 0,
      width: 50,
      height: 20
    }
  }]
}];

function setup(overrides: Partial<ScreenTextDeps> = {}) {
  const grabs: Array<Parameters<ScreenTextDeps["grab"]>[0]> = [];
  const reader = createOcrScreenTextReader({
    foregroundWindow: () => WINDOW,
    foregroundDisplayName: () => MONITOR.deviceName,
    grab(request) {
      grabs.push(request);
      return Promise.resolve({
        jpeg: Uint8Array.of(1),
        width: 1600,
        height: 900
      });
    },
    readLines: () => Promise.resolve(LINES),
    ownProcessId: OWN_PID,
    ...overrides
  });
  return {
    reader,
    grabs
  };
}

describe("OCR screen text reader", () => {
  it("reads the window's own region at full detail and shapes it as a screen view", async () => {
    const { reader, grabs } = setup();
    const view = await reader.read(MONITOR);
    assert.equal(view?.title, "Article - Browser");
    assert.equal(view?.app, "msedge");
    assert.deepEqual(view?.blocks, [{
      kind: "paragraph",
      text: "Hello"
    }]);
    assert.deepEqual(grabs[0]?.region, {
      x: 100,
      y: 50,
      width: 1600,
      height: 900
    });
    assert.equal(grabs[0]?.detail, ScreenDetail.frozen);
  });

  it("offsets the window by the display's origin on a second display", async () => {
    const second: Monitor = {
      ...MONITOR,
      x: -3840,
      y: -134
    };
    const { reader, grabs } = setup({
      foregroundWindow: () => ({
        ...WINDOW,
        bounds: {
          x: -3740,
          y: -84,
          width: 800,
          height: 600
        }
      })
    });
    await reader.read(second);
    assert.deepEqual(grabs[0]?.region, {
      x: 100,
      y: 50,
      width: 800,
      height: 600
    });
  });

  it("is undefined with no window, or this app's own window", async () => {
    assert.equal(await setup({ foregroundWindow: () => undefined }).reader.read(MONITOR), undefined);
    assert.equal(
      await setup({
        foregroundWindow: () => ({
          ...WINDOW,
          processId: OWN_PID
        })
      }).reader.read(MONITOR), undefined
    );
  });

  it("is undefined when the window is on another display, without taking a picture", async () => {
    const { reader, grabs } = setup({ foregroundDisplayName: () => "\\\\.\\DISPLAY9" });
    assert.equal(await reader.read(MONITOR), undefined);
    assert.equal(grabs.length, 0);
  });

  it("is undefined when the window lies outside the display", async () => {
    const { reader } = setup({
      foregroundWindow: () => ({
        ...WINDOW,
        bounds: {
          x: 9000,
          y: 0,
          width: 100,
          height: 100
        }
      })
    });
    assert.equal(await reader.read(MONITOR), undefined);
  });

  it("is undefined when nothing was read", async () => {
    assert.equal(await setup({ readLines: () => Promise.resolve([]) }).reader.read(MONITOR), undefined);
  });
});

describe("app name", () => {
  it("is the executable without folder or extension", () => {
    assert.equal(appNameOf("C:\\Program Files\\Microsoft VS Code\\Code.exe"), "Code");
    assert.equal(appNameOf("C:\\Windows\\System32\\notepad.EXE"), "notepad");
    assert.equal(appNameOf(""), "");
  });
});
