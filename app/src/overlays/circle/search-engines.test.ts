import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SearchAction } from "@/overlays/protocol.ts";

import { SEARCH_ENGINES } from "./search-engines.ts";

describe("search engines", () => {
  it("gives each search action an engine, a label, a glyph and a key", () => {
    for (const action of Object.values(SearchAction)) {
      const row = SEARCH_ENGINES[action];
      assert.ok(row.label.length > 0);
      assert.ok(row.glyph.length > 0);
      assert.equal(row.keys.length, 1);
    }
  });

  it("uses each key once, and each engine once for each destination", () => {
    const rows = Object.values(SEARCH_ENGINES);
    assert.equal(new Set(rows.map(row => row.keys)).size, rows.length);
    assert.equal(new Set(rows.map(row => `${row.engine}/${row.destination}`)).size, rows.length);
  });
});
