import operatingSystem from "node:os";
import path from "node:path";

const APP_FOLDER = "GeminiLive";
const BROWSER_FOLDER = ".gemini-live";

export function dataDir({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  const base = env["LOCALAPPDATA"] ?? path.join(operatingSystem.homedir(), "AppData", "Local");
  return path.join(base, APP_FOLDER);
}

// Google's Lens text models, which the user pulls from their own phone (scripts/fetch-lens-models.ps1)
export function lensModelsDir({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  return path.join(dataDir({ env }), "lens-models");
}

// Not under AppData, so an MSIX install doesn't virtualize it away from the browser
export function browserDir() {
  return path.join(operatingSystem.homedir(), BROWSER_FOLDER);
}
