// Signs the Chrome build into a .crx that installs by dragging onto chrome://extensions. The key,
// keys/chrome.pem at the repo root, is the one whose public half is the manifest's "key"
// (wxt.config.ts), so the .crx keeps the extension's pinned ID.

import crx3 from "crx3";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KEY_PATH = fileURLToPath(new URL("../../keys/chrome.pem", import.meta.url));
const BUILD_DIR = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url));
const OUTPUT_DIR = new URL("../.output/", import.meta.url);
const { name, version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const crxPath = fileURLToPath(new URL(`${name}-${version}-chrome.crx`, OUTPUT_DIR));
// crx3 mints a fresh key when the file is missing, which would sign under a different ID.
if (!existsSync(KEY_PATH)) {
  throw new Error(`No signing key at ${KEY_PATH}; restore keys/chrome.pem from its backup`);
}

await crx3([BUILD_DIR], {
  keyPath: KEY_PATH,
  crxPath
});
console.log(`Signed ${crxPath}`);
