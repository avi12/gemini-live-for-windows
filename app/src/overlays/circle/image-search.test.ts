import { createImageSearch, searchEngineOf } from "./image-search.ts";
import { CircleAction, isSearchAction } from "@/overlays/protocol.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImageSearchEngine } from "winui-svelte/image-search";
import type { ImageSearchOptions } from "winui-svelte/image-search";

const CROP = {
  jpeg: Uint8Array.from(Buffer.from("jpeg")),
  width: 640,
  height: 480
};
const RESULT_URL = "https://lens.google.com/search?vsrid=abc";

function silentLog() {
  const lines: string[] = [];
  return {
    lines,
    write(message: string) {
      lines.push(message);
    }
  };
}

describe("searchEngineOf", () => {
  it("names the engine of each search action", () => {
    assert.equal(searchEngineOf(CircleAction.lens), ImageSearchEngine.GOOGLE_LENS);
    assert.equal(searchEngineOf(CircleAction.bing), ImageSearchEngine.BING);
  });

  it("has an engine for exactly the actions the overlay searches", () => {
    for (const action of Object.values(CircleAction)) {
      assert.equal(searchEngineOf(action) !== undefined, isSearchAction(action));
    }
  });

  it("is undefined for asking Gemini", () => {
    assert.equal(searchEngineOf(CircleAction.askGemini), undefined);
  });
});

describe("createImageSearch", () => {
  it("uploads the crop as a JPEG and gives the result page", async () => {
    const asked: ImageSearchOptions[] = [];
    const search = createImageSearch({
      log: silentLog(),
      resolve(options) {
        asked.push(options);
        return Promise.resolve(RESULT_URL);
      }
    });
    const url = await search.search({
      engine: ImageSearchEngine.GOOGLE_LENS,
      crop: CROP
    });
    assert.equal(url, RESULT_URL);
    const [options] = asked;
    assert.equal(options?.engine, ImageSearchEngine.GOOGLE_LENS);
    const image = options?.image;
    assert.ok(image !== undefined && "blob" in image);
    assert.equal(image.blob.type, "image/jpeg");
    assert.deepEqual([...new Uint8Array(await image.blob.arrayBuffer())], [...CROP.jpeg]);
  });

  it("only logs when the engine refuses, and gives no page", async () => {
    const log = silentLog();
    const search = createImageSearch({
      log,
      resolve: () => Promise.reject(new Error("bing answered 403"))
    });
    const url = await search.search({
      engine: ImageSearchEngine.BING,
      crop: CROP
    });
    assert.equal(url, undefined);
    assert.deepEqual(log.lines, ["bing search failed: bing answered 403"]);
  });
});
