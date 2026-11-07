import {
  LENS_DIMENSIONS_FIELD,
  LENS_IMAGE_FIELD,
  LENS_IMAGE_MIME_TYPE,
  LENS_UPLOAD_URL,
  lensUploadPage
} from "@/overlays/circle/lens-page.ts";
import {
  createLensSearch,
  LENS_PAGE_FOLDER,
  LENS_PAGE_LIFETIME_MS,
  lensPageDirectory
} from "@/overlays/circle/lens-search.ts";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const JPEG_MAGIC = Buffer.from("jpeg");
const EXPECTED_LIFETIME_MS = 300_000;
const PAST_LIFETIME_MS = 1000;
const CROP = {
  jpeg: JPEG_MAGIC,
  width: 640,
  height: 480
};
const SENT_AT_MS = 1_700_000_000_000;

function silentLog() {
  const lines: string[] = [];
  return {
    lines,
    write(message: string) {
      lines.push(message);
    }
  };
}

describe("lensUploadPage", () => {
  const page = lensUploadPage({
    crop: CROP,
    sentAtMs: SENT_AT_MS
  });

  it("posts a multipart form to Lens with the client clock", () => {
    assert.ok(page.includes(`method="post" enctype="multipart/form-data"`));
    assert.ok(page.includes(`action="${LENS_UPLOAD_URL}&stcs=${SENT_AT_MS}"`));
  });

  it("names the image field and the dimensions", () => {
    assert.ok(page.includes(`name="${LENS_IMAGE_FIELD}"`));
    assert.ok(page.includes(`name="${LENS_DIMENSIONS_FIELD}" value="640,480"`));
  });

  it("carries the picture as base64 with its type", () => {
    assert.ok(page.includes(`atob("${Buffer.from(CROP.jpeg).toString("base64")}")`));
    assert.ok(page.includes(`type: "${LENS_IMAGE_MIME_TYPE}"`));
  });

  it("adds the viewport in the browser and submits on load", () => {
    assert.ok(page.includes("&vpw=${innerWidth}&vph=${innerHeight}"));
    assert.ok(page.includes("form.submit();"));
  });

  it("keeps the constants the C# verified", () => {
    assert.equal(LENS_UPLOAD_URL, "https://lens.google.com/v3/upload?re=df&ep=gsbubb");
    assert.equal(LENS_IMAGE_FIELD, "encoded_image");
    assert.equal(LENS_DIMENSIONS_FIELD, "processed_image_dimensions");
    assert.equal(LENS_PAGE_LIFETIME_MS, EXPECTED_LIFETIME_MS);
  });

  it("writes into a folder under the temp directory", () => {
    assert.equal(lensPageDirectory(), path.join(os.tmpdir(), LENS_PAGE_FOLDER));
  });
});

describe("createLensSearch", () => {
  async function inTempDirectory(use: (directory: string) => Promise<void>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "lens-test-"));
    const directory = path.join(root, LENS_PAGE_FOLDER);
    try {
      await use(directory);
    } finally {
      await rm(root, {
        recursive: true,
        force: true
      });
    }
  }

  it("writes the page and opens it", async () => {
    await inTempDirectory(async directory => {
      const opened: string[] = [];
      const search = createLensSearch({
        opener: {
          openFile: ({ filePath }) => opened.push(filePath)
        },
        log: silentLog(),
        now: () => SENT_AT_MS,
        directory
      });
      await search.search(CROP);
      assert.equal(opened.length, 1);
      const [page] = opened;
      assert.ok(page?.startsWith(directory));
      assert.ok(page?.endsWith(".html"));
      const text = await readFile(page ?? "", "utf8");
      assert.ok(text.includes(`stcs=${SENT_AT_MS}`));
    });
  });

  it("sweeps pages older than the lifetime and keeps the recent ones", async () => {
    await inTempDirectory(async directory => {
      await mkdir(directory, { recursive: true });
      const stale = path.join(directory, "stale.html");
      const fresh = path.join(directory, "fresh.html");
      const other = path.join(directory, "keep.txt");
      await Promise.all([writeFile(stale, "x"), writeFile(fresh, "x"), writeFile(other, "x")]);
      const now = Date.now();
      const old = new Date(now - LENS_PAGE_LIFETIME_MS - PAST_LIFETIME_MS);
      await utimes(stale, old, old);
      await utimes(other, old, old);
      const search = createLensSearch({
        opener: {
          openFile: () => undefined
        },
        log: silentLog(),
        now: () => now,
        directory
      });
      await search.search(CROP);
      const names = await readdir(directory);
      assert.equal(names.includes("stale.html"), false);
      assert.equal(names.includes("fresh.html"), true);
      assert.equal(names.includes("keep.txt"), true);
    });
  });

  it("only logs when the page cannot be written", async () => {
    await inTempDirectory(async directory => {
      await mkdir(path.dirname(directory), { recursive: true });
      await writeFile(directory, "a file where the folder should be");
      const log = silentLog();
      const opened: string[] = [];
      const search = createLensSearch({
        opener: {
          openFile: ({ filePath }) => opened.push(filePath)
        },
        log,
        directory
      });
      await search.search(CROP);
      assert.equal(opened.length, 0);
      assert.equal(log.lines.length, 1);
      assert.ok(log.lines[0]?.startsWith("Lens search failed"));
    });
  });
});
