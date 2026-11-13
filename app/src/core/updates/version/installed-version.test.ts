import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import operatingSystem from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readInstalledVersion } from "./installed-version.ts";

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="Avi.GeminiLive" Publisher="CN=Avi" Version="1.4.2.0" ProcessorArchitecture="x64" />
  <Dependencies>
    <PackageDependency Name="Microsoft.WindowsAppRuntime.2.2" MinVersion="2000.1.1.0" />
  </Dependencies>
</Package>`;

describe("the installed version", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(operatingSystem.tmpdir(), "installed-version-"));
  });

  afterEach(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  it("is the version of the package's identity", async () => {
    await writeFile(path.join(directory, "AppxManifest.xml"), MANIFEST);
    assert.equal(await readInstalledVersion({ directory }), "1.4.2.0");
  });

  it("is undefined with no manifest beside the exe", async () => {
    assert.equal(await readInstalledVersion({ directory }), undefined);
  });

  it("is undefined for a manifest with no identity version", async () => {
    await writeFile(path.join(directory, "AppxManifest.xml"), "<Package />");
    assert.equal(await readInstalledVersion({ directory }), undefined);
  });
});
