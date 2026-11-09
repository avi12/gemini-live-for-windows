import { startDevWindow } from "./dev-window.ts";
import { serveMockView } from "./mock-host.ts";
import { isScenarioName, nextScenario, SCENARIO_ORDER, ScenarioName } from "./scenarios.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import { initWindowsAppSdk } from "winui-svelte/bootstrap";
import { createMessagePortTransport } from "winui-svelte/state/host";

const WINDOWS_APP_SDK_MAJOR = 2;
const WINDOWS_APP_SDK_MINOR = 2;
const SCENARIO_ARGUMENT = "--scenario";
const THEME_ARGUMENT = "--theme";
const FAKE_SETTINGS_VARIABLE = "WINUI_SVELTE_FAKE_SETTINGS";
const ThemeName = {
  light: "light",
  dark: "dark"
} as const;
const KEY_NEXT = "n";
const KEY_PREVIOUS = "p";
const KEY_QUIT = "\u0003";
const FIRST_DIGIT = 1;

function readScenarioArgument() {
  const index = process.argv.indexOf(SCENARIO_ARGUMENT);
  const value = process.argv[index + 1];
  const isOmitted = index < 0;
  if (isOmitted) {
    return ScenarioName.captions;
  }

  if (!isScenarioName(value)) {
    throw new Error(`${SCENARIO_ARGUMENT} takes one of: ${SCENARIO_ORDER.join(", ")}`);
  }

  return value;
}

function readKeyStep(key: string) {
  const isNext = key === KEY_NEXT;
  const isPrevious = key === KEY_PREVIOUS;
  if (isNext) {
    return 1;
  }

  if (isPrevious) {
    return -1;
  }

  return 0;
}

function watchKeys({ onPick, onQuit }: {
  onPick(name: ScenarioName): void;
  onQuit(): void;
}) {
  const isInteractive = process.stdin.isTTY;
  if (!isInteractive) {
    return;
  }

  let current = readScenarioArgument();
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key: string) => {
    const isQuit = key === KEY_QUIT;
    if (isQuit) {
      onQuit();
      return;
    }

    const picked = SCENARIO_ORDER[Number(key) - FIRST_DIGIT];
    const step = readKeyStep(key);
    current = picked ?? nextScenario({
      current,
      step
    });
    onPick(current);
  });
}

function applyThemeArgument() {
  const index = process.argv.indexOf(THEME_ARGUMENT);
  const isOmitted = index < 0;
  if (isOmitted) {
    return;
  }

  const value = process.argv[index + 1];
  const isKnown = value === ThemeName.light || value === ThemeName.dark;
  if (!isKnown) {
    throw new Error(`${THEME_ARGUMENT} takes one of: ${Object.values(ThemeName).join(", ")}`);
  }

  const file = path.join(os.tmpdir(), `gemini-live-pill-theme-${process.pid}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      isDark: value === ThemeName.dark
    })
  );
  process.env[FAKE_SETTINGS_VARIABLE] = file;
}

export async function runMock() {
  const scenario = readScenarioArgument();
  applyThemeArgument();
  initWindowsAppSdk({
    major: WINDOWS_APP_SDK_MAJOR,
    minor: WINDOWS_APP_SDK_MINOR
  });
  const link = new MessageChannel();
  const host = serveMockView({
    transport: createMessagePortTransport({ port: link.port1 }),
    scenario
  });
  const { worker, server } = await startDevWindow({
    port: link.port2,
    isFakeCapture: true
  });
  watchKeys({
    onPick: host.show,
    onQuit: () => worker.terminate()
  });
  worker.on("error", error => {
    process.stderr.write(`${error.stack ?? String(error)}\n`);
    process.exitCode = 1;
  });
  const code = await new Promise<number>(resolve => {
    worker.on("exit", resolve);
  });
  host.close();
  await server.close();
  return process.exitCode ?? code;
}
