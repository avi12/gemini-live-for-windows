import { pillViewSchema } from "@gemini-live/protocol/view";
import { z } from "@gemini-live/protocol/zod";
import { createGuard } from "@gemini-live/protocol/zod-guard";

import { SCENARIO_VIEWS, ScenarioName } from "./scenario-views.ts";

export const SCENARIO_ORDER = Object.values(ScenarioName);

export const isScenarioName = createGuard(z.enum(ScenarioName));

export function scenarioView(name: ScenarioName) {
  return pillViewSchema.parse(SCENARIO_VIEWS[name]);
}

export function nextScenario({ current, step }: { current: ScenarioName; step: number }) {
  const count = SCENARIO_ORDER.length;
  const index = SCENARIO_ORDER.indexOf(current);
  const next = SCENARIO_ORDER[(index + step + count) % count];
  return next ?? current;
}
