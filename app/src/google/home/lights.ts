import type { Logger } from "@/google/ports.ts";
import { clickAt } from "@/google/web-host/cdp.ts";
import { delay } from "@/google/web-host/timeout.ts";

import { type HomePage, type HomeWebHost, SETTLE_MS } from "./home-page.ts";

const UNREACHABLE = "I couldn't reach your Google Home.";

const FALLBACK_LIGHTS_NAME = "PC lights";

function onOff(isOn: boolean) {
  return isOn ? "on" : "off";
}

// Sets the PC lights on or off, returning a short line to speak. Reads the tile's state first, so
// an already-correct light is a no-op instead of a toggle the wrong way.
export async function switchLights({
  isOn,
  webHost,
  page,
  log
}: {
  isOn: boolean;
  webHost: HomeWebHost;
  page: HomePage;
  log: Logger;
}) {
  if (!(await page.waitReady())) {
    return UNREACHABLE;
  }

  const state = await page.readLights();
  if (!state?.found) {
    return "I couldn't find the PC lights.";
  }

  const name = state.name ?? FALLBACK_LIGHTS_NAME;
  log.write(`home: ${name} text='${state.text}' on=${state.on}`);

  const isUnknown = state.on === null;
  if (isUnknown) {
    return `I couldn't tell whether the ${name} are on.`;
  }

  const isAlreadySet = state.on === isOn;
  if (isAlreadySet) {
    return `The ${name} are already ${onOff(isOn)}.`;
  }

  const core = webHost.core;
  if (!core) {
    return UNREACHABLE;
  }

  await clickAt({
    core,
    x: state.x,
    y: state.y
  });
  await delay(SETTLE_MS);
  const after = await page.readLights();
  const isUnconfirmed = !after?.found || after.on === null;
  if (isUnconfirmed) {
    return "I couldn't confirm the lights changed.";
  }

  log.write(`home: ${name} after text='${after.text}' on=${after.on}`);
  const isSwitched = after.on === isOn;
  return isSwitched ? `Turned the ${name} ${onOff(isOn)}.` : "I couldn't switch the lights.";
}
