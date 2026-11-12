import { createSearchChoice } from "./search-choice.ts";
import { SearchAction } from "@/overlays/protocol.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function setup({ isSaveFailing = false }: { isSaveFailing?: boolean } = {}) {
  const settings: { circleSearch: SearchAction } = { circleSearch: SearchAction.lens };
  const logs: string[] = [];
  let saves = 0;
  const choice = createSearchChoice({
    settings,
    save() {
      saves += 1;
      return isSaveFailing ? Promise.reject(new Error("disk full")) : Promise.resolve();
    },
    log: message => logs.push(message)
  });
  return {
    choice,
    settings,
    logs,
    saves: () => saves
  };
}

describe("search choice", () => {
  it("starts on what the settings hold", () => {
    assert.equal(setup().choice.current(), SearchAction.lens);
  });

  it("remembers a new engine and saves it", () => {
    const { choice, settings, saves } = setup();
    choice.remember(SearchAction.bing);
    assert.equal(choice.current(), SearchAction.bing);
    assert.equal(settings.circleSearch, SearchAction.bing);
    assert.equal(saves(), 1);
  });

  it("does not save the engine it already has", () => {
    const { choice, saves } = setup();
    choice.remember(SearchAction.lens);
    assert.equal(saves(), 0);
  });

  it("logs a failed save and keeps the choice", async () => {
    const { choice, logs } = setup({ isSaveFailing: true });
    choice.remember(SearchAction.bing);
    await new Promise(setImmediate);
    assert.equal(choice.current(), SearchAction.bing);
    assert.equal(logs.length, 1);
  });
});
