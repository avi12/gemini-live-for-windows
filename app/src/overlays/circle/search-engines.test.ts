import { CORE_SEARCH_ACTION, extraSearchActions, SEARCH_ENGINES } from "./search-engines.ts";
import { SearchAction } from "@/overlays/protocol.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("search engines", () => {
  it("gives each search action an engine, a label, a glyph and a key", () => {
    for (const action of Object.values(SearchAction)) {
      const row = SEARCH_ENGINES[action];
      assert.ok(row.label.length > 0);
      assert.ok(row.glyph.length > 0);
      assert.equal(row.keys.length, 1);
    }
  });

  it("uses each key and each engine once", () => {
    const rows = Object.values(SEARCH_ENGINES);
    assert.equal(new Set(rows.map(row => row.keys)).size, rows.length);
    assert.equal(new Set(rows.map(row => row.engine)).size, rows.length);
  });

  it("keeps Lens out of the chooser and lists the last chosen extra first", () => {
    for (const preferred of Object.values(SearchAction)) {
      const extras: readonly SearchAction[] = extraSearchActions(preferred);
      assert.ok(!extras.includes(CORE_SEARCH_ACTION));
      assert.equal(new Set(extras).size, extras.length);
      assert.equal(extras.length, Object.values(SearchAction).length - 1);
    }

    assert.equal(extraSearchActions(SearchAction.bing)[0], SearchAction.bing);
  });
});
