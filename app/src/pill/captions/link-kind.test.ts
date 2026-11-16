import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { faviconUri, isSearchPage } from "@/pill/captions/link-kind.ts";

describe("isSearchPage", () => {
  it("knows the results pages of the search engines", () => {
    for (const uri of [
      "https://www.google.com/search?q=cats",
      "https://www.google.co.il/search?q=cats",
      "https://www.bing.com/search?q=cats",
      "https://search.yahoo.com/search?p=cats",
      "https://duckduckgo.com/?q=cats",
      "https://yandex.com/search/?text=cats"
    ]) {
      assert.equal(isSearchPage(uri), true, uri);
    }
  });

  it("takes every other page, and an engine's own other pages, for pages", () => {
    for (const uri of [
      "https://www.youtube.com/watch?v=abc",
      "https://www.google.com/maps",
      "https://www.google.com/search",
      "https://example.com/search?q=cats",
      "not a link"
    ]) {
      assert.equal(isSearchPage(uri), false, uri);
    }
  });
});

describe("faviconUri", () => {
  it("asks the icon service for the page's site", () => {
    assert.equal(
      faviconUri("https://www.youtube.com/watch?v=abc"),
      "https://www.google.com/s2/favicons?domain=www.youtube.com&sz=32"
    );
  });
});
