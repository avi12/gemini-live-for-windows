import { BlockKind } from "./protocols/glic.ts";
import { clip, describeScreen, unescapeMarkdown, webSearchPrompt } from "./screen-prompt.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const screen = {
  title: "Cats",
  app: "browser",
  version: "1",
  blocks: [
    {
      kind: BlockKind.heading,
      text: "Cat facts"
    },
    {
      kind: BlockKind.paragraph,
      text: "Cats sleep a lot."
    }
  ]
};

test("unescapeMarkdown shows the spoken words", () => {
  assert.equal(unescapeMarkdown(String.raw`17\.3 \*great\*`), "17.3 *great*");
});

test("clip shortens with an ellipsis", () => {
  assert.equal(
    clip({
      text: "abcdef",
      limit: 3
    }), "abc…"
  );
  assert.equal(
    clip({
      text: "abc",
      limit: 3
    }), "abc"
  );
});

test("describeScreen names the window, headings and text", () => {
  assert.equal(
    describeScreen(screen),
    "a window titled \"Cats\"; heading \"Cat facts\"; text beginning \"Cat facts Cats sleep a lot.\""
  );
});

test("webSearchPrompt adds the screen, Gemini's last line and the ask", () => {
  const prompt = webSearchPrompt({
    request: "find the source",
    screen,
    lastGeminiLine: "Cats nap."
  });
  assert.ok(prompt.startsWith("find the source (On my screen: a window titled"));
  assert.ok(prompt.includes("(You just told me: \"Cats nap.\".)"));
  assert.ok(prompt.endsWith("link the exact pages you used.)"));
});

test("webSearchPrompt without context is the request and the ask", () => {
  const prompt = webSearchPrompt({
    request: "find it",
    screen: null,
    lastGeminiLine: ""
  });
  assert.ok(prompt.startsWith("find it (This is a new chat"));
});
