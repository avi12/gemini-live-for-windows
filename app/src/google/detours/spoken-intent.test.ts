import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  appName,
  asksWeb,
  classifyRefusal,
  classifyUtterance,
  IntentKind,
  lightsCommand,
  needsApp,
  targetsApp,
  withholdsLink
} from "./spoken-intent.ts";

describe("lightsCommand", () => {
  test("reads a clear command with its direction", () => {
    assert.deepEqual(lightsCommand("turn on the lights"), { isOn: true });
    assert.deepEqual(lightsCommand("please switch the lights off"), { isOn: false });
  });

  test("leaves questions and app requests alone", () => {
    assert.equal(lightsCommand("are the lights on?"), undefined);
    assert.equal(lightsCommand("remind me to turn off the lights"), undefined);
  });

  test("needs a switch verb and one direction", () => {
    assert.equal(lightsCommand("the lights are bright"), undefined);
    assert.equal(lightsCommand("turn the lights"), undefined);
    assert.equal(lightsCommand("turn the lights on and off"), undefined);
  });
});

describe("apps", () => {
  test("a refusal about an app is a need for the text path", () => {
    assert.equal(needsApp("I can't access your calendar"), true);
    assert.equal(needsApp("Here is the weather"), false);
  });

  test("an imperative about an app targets it", () => {
    assert.equal(targetsApp("add a meeting for tomorrow"), true);
    assert.equal(targetsApp("tell me a joke"), false);
  });

  test("names the app a request mentions", () => {
    assert.equal(appName("check my inbox"), "Gmail");
    assert.equal(appName("add a to-do"), "Tasks");
    assert.equal(appName("what's on my calendar"), "Calendar");
    assert.equal(appName("something else"), "your Google apps");
  });
});

describe("web", () => {
  test("recognizes a request for a link in English and Hebrew", () => {
    assert.equal(asksWeb("can you give me a link to that article"), true);
    assert.equal(asksWeb("תחפש לי מתכון"), true);
    assert.equal(asksWeb("I linked it yesterday"), false);
  });

  test("recognizes Gemini withholding a page", () => {
    assert.equal(withholdsLink("I can't give you a link"), true);
    assert.equal(withholdsLink("You can find it on the official site"), true);
    assert.equal(withholdsLink("It is sunny"), false);
  });
});

describe("classifyUtterance", () => {
  test("tries lights, then apps, then the web", () => {
    assert.deepEqual(classifyUtterance("turn off the lights"), {
      kind: IntentKind.LIGHTS,
      isOn: false
    });
    assert.deepEqual(classifyUtterance("add a meeting"), { kind: IntentKind.APP });
    assert.deepEqual(classifyUtterance("search the web for cats"), { kind: IntentKind.WEB });
    assert.equal(classifyUtterance("how are you"), undefined);
  });
});

describe("classifyRefusal", () => {
  test("maps a refusal to the detour that fixes it", () => {
    assert.equal(classifyRefusal("I don't have access to your calendar"), IntentKind.APP);
    assert.equal(classifyRefusal("I can't browse the internet"), IntentKind.WEB);
    assert.equal(classifyRefusal("Sure, one moment"), undefined);
  });
});
