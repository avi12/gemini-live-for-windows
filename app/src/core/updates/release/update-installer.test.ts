import { downloadRelease } from "./update-installer.ts";
import type { AppRelease } from "@/core/updates/app-release.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const HTTP_ERROR = 500;
const PACKAGE = Buffer.from("pretend this is an msix");

function releaseFor(bytes: Buffer) {
  const release: AppRelease = {
    version: "0.2.0.0",
    msixUrl: "https://example.com/GeminiLive-0.2.0.msix",
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase()
  };
  return release;
}

function serving(bytes: Buffer) {
  let count = 0;
  async function fetchPackage() {
    count += 1;
    return new Response(new Uint8Array(bytes));
  }
  return {
    fetchPackage,
    count: () => count
  };
}

describe("downloadRelease", () => {
  let folder = "";
  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "gl-update-"));
  });
  afterEach(async () => {
    await fs.rm(folder, {
      recursive: true,
      force: true
    });
  });

  it("streams the package to disk and verifies it", async () => {
    const { fetchPackage } = serving(PACKAGE);
    const filePath = await downloadRelease({
      release: releaseFor(PACKAGE),
      folder,
      fetchPackage
    });
    assert.equal(filePath, path.join(folder, "GeminiLive-0.2.0.0.msix"));
    assert.deepEqual(await fs.readFile(String(filePath)), PACKAGE);
  });

  it("deletes a download that fails its hash", async () => {
    const { fetchPackage } = serving(Buffer.from("tampered"));
    const filePath = await downloadRelease({
      release: releaseFor(PACKAGE),
      folder,
      fetchPackage
    });
    assert.equal(filePath, undefined);
    assert.deepEqual(await fs.readdir(folder), []);
  });

  it("reuses a copy that already matches", async () => {
    const { fetchPackage, count } = serving(PACKAGE);
    const release = releaseFor(PACKAGE);
    await downloadRelease({
      release,
      folder,
      fetchPackage
    });
    await downloadRelease({
      release,
      folder,
      fetchPackage
    });
    assert.equal(count(), 1);
  });

  it("downloads again over a damaged copy", async () => {
    const release = releaseFor(PACKAGE);
    await fs.writeFile(path.join(folder, "GeminiLive-0.2.0.0.msix"), "damaged");
    const { fetchPackage, count } = serving(PACKAGE);
    assert.ok(
      await downloadRelease({
        release,
        folder,
        fetchPackage
      })
    );
    assert.equal(count(), 1);
  });

  it("rejects when the server refuses", async () => {
    async function fetchPackage() {
      return new Response("no", { status: HTTP_ERROR });
    }

    await assert.rejects(
      downloadRelease({
        release: releaseFor(PACKAGE),
        folder,
        fetchPackage
      })
    );
  });
});
