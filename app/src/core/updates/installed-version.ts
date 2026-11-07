import { readFile } from "node:fs/promises";
import path from "node:path";

const MANIFEST_FILE = "AppxManifest.xml";
const IDENTITY_VERSION = /<Identity\b[^>]*\sVersion="([^"]+)"/;

// The running package's version, from the manifest at the root of the package the exe was started
// from; undefined when run unpackaged, where there is no manifest beside the exe
export async function readInstalledVersion({ directory = path.dirname(process.execPath) }: {
  directory?: string;
} = {}) {
  try {
    const manifest = await readFile(path.join(directory, MANIFEST_FILE), "utf8");
    return IDENTITY_VERSION.exec(manifest)?.[1];
  } catch {
    return undefined;
  }
}
