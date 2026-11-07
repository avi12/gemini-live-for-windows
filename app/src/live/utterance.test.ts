import { appendFragment, EMPTY_UTTERANCE } from "@/live/utterance.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("appendFragment", () => {
  it("grows the current utterance while the speaker stays the same", () => {
    const first = appendFragment({
      utterance: EMPTY_UTTERANCE,
      fragment: "Hel",
      isUser: true
    });
    const second = appendFragment({
      utterance: first,
      fragment: "lo",
      isUser: true
    });
    assert.deepEqual(second, {
      text: "Hello",
      isUser: true
    });
  });

  it("starts a new utterance when the speaker changes", () => {
    const user = appendFragment({
      utterance: EMPTY_UTTERANCE,
      fragment: "Hi",
      isUser: true
    });
    const model = appendFragment({
      utterance: user,
      fragment: "Hey",
      isUser: false
    });
    assert.deepEqual(model, {
      text: "Hey",
      isUser: false
    });
  });

  it("keeps a model opening fragment, as the empty start is already the model", () => {
    const model = appendFragment({
      utterance: EMPTY_UTTERANCE,
      fragment: "Hey",
      isUser: false
    });
    assert.equal(model.text, "Hey");
  });
});
