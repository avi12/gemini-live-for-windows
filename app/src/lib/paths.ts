import os from "node:os";
import path from "node:path";

const APP_FOLDER = "GeminiLive";
const BROWSER_FOLDER = ".gemini-live";

export function dataDir({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  const base = env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(base, APP_FOLDER);
}

// Not under AppData, so an MSIX install doesn't virtualize it away from the browser
export function browserDir() {
  return path.join(os.homedir(), BROWSER_FOLDER);
}
