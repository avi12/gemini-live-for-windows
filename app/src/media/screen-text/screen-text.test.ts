import { appNameOf } from "./foreground-window.ts";
import type { ForegroundWindow } from "./foreground-window.ts";
import { createOcrScreenTextReader, createUiaScreenTextReader } from "./screen-text.ts";
import type { ScreenTextDeps, UiaScreenTextDeps } from "./screen-text.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";
import { ScreenDetail } from "@/media/screen/capture-geometry.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextBlockKind } from "winui-svelte/automation";
import type { WindowText } from "winui-svelte/automation";

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

const EXACT_TEXT: WindowText = {
  title: "Article",
  blocks: [
    {
      kind: TextBlockKind.heading,
      level: 1,
      text: "Big news"
    },
    {
      kind: TextBlockKind.text,
      level: 0,
      text: "The exact words."
    }
  ],
  version: "abcdef0123456789",
  end: "complete"
};

function setupUia(overrides: Partial<UiaScreenTextDeps> = {}) {
  const requests: Array<Parameters<UiaScreenTextDeps["readText"]>[0]> = [];
  const logs: string[] = [];
  const fallback = setup();
  const reader = createUiaScreenTextReader({
    foregroundWindow: () => WINDOW,
    foregroundDisplayName: () => MONITOR.deviceName,
    ownProcessId: OWN_PID,
    readText(request) {
      requests.push(request);
      return Promise.resolve(EXACT_TEXT);
    },
    fallback: fallback.reader,
    log: message => logs.push(message),
    ...overrides
  });
  return {
    reader,
    requests,
    logs,
    grabs: fallback.grabs
  };
}

describe("UI Automation screen text reader", () => {
  it("shapes the exact text of the foreground window as a screen view", async () => {
    const { reader, requests, grabs } = setupUia();
    const view = await reader.read(MONITOR);
    assert.deepEqual(view, {
      title: "Article",
      app: "msedge",
      blocks: [
        {
          kind: "heading",
          text: "Big news"
        },
        {
          kind: "paragraph",
          text: "The exact words."
        }
      ],
      version: "abcdef0123456789"
    });
    assert.deepEqual(requests, [{
      hwnd: WINDOW.hwnd,
      excludeProcessId: OWN_PID
    }]);
    assert.equal(grabs.length, 0);
  });

  it("takes the window's title when the tree has none", async () => {
    const { reader } = setupUia({
      readText: () => Promise.resolve({
        ...EXACT_TEXT,
        title: ""
      })
    });
    assert.equal((await reader.read(MONITOR))?.title, "Article - Browser");
  });

  it("reads the picture when the tree gives no text", async () => {
    for (const text of [null, {
      ...EXACT_TEXT,
      blocks: []
    }]) {
      const { reader, grabs } = setupUia({ readText: () => Promise.resolve(text) });
      const view = await reader.read(MONITOR);
      assert.deepEqual(view?.blocks, [{
        kind: "paragraph",
        text: "Hello"
      }]);
      assert.equal(grabs.length, 1);
    }
  });

  it("reads the picture, and says why, when UI Automation fails", async () => {
    const { reader, logs } = setupUia({ readText: () => Promise.reject(new Error("the target did not answer")) });
    const view = await reader.read(MONITOR);
    assert.equal(view?.blocks[0]?.text, "Hello");
    assert.match(logs.join(" "), /the target did not answer/);
  });

  it("is undefined, without reading anything, for no window, our own or another display", async () => {
    const cases: Array<Partial<UiaScreenTextDeps>> = [
      { foregroundWindow: () => undefined },
      {
        foregroundWindow: () => ({
          ...WINDOW,
          processId: OWN_PID
        })
      },
      { foregroundDisplayName: () => "elsewhere" }
    ];
    for (const overrides of cases) {
      const { reader, requests, grabs } = setupUia(overrides);
      assert.equal(await reader.read(MONITOR), undefined);
      assert.equal(requests.length, 0);
      assert.equal(grabs.length, 0);
    }
  });
});

describe("app name", () => {
  it("is the executable without folder or extension", () => {
    assert.equal(appNameOf("C:\\Program Files\\Microsoft VS Code\\Code.exe"), "Code");
    assert.equal(appNameOf("C:\\Windows\\System32\\notepad.EXE"), "notepad");
    assert.equal(appNameOf(""), "");
  });
});
