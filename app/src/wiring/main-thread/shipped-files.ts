import path from "node:path";
import { pathToFileURL } from "node:url";

const UI_WORKER_FILE = "window.js";
const AUDIO_WORKER_FILE = "audio-worker.js";
const UIA_WORKER_FILE = "uia-worker.js";
const BRIDGES_FOLDER = "bridges";
const EXTENSION_FOLDER = "extension";

// Where the build puts what the app reads at run time, all beside the entry in the package layout
export function shippedFiles({ directory }: { directory: string }) {
  return {
    uiWorker: path.join(directory, UI_WORKER_FILE),
    audioWorkerUrl: pathToFileURL(path.join(directory, AUDIO_WORKER_FILE)),
    uiaWorkerUrl: pathToFileURL(path.join(directory, UIA_WORKER_FILE)),
    bridgesDirectory: path.join(directory, BRIDGES_FOLDER),
    extensionDirectory: path.join(directory, EXTENSION_FOLDER)
  };
}

export type ShippedFiles = ReturnType<typeof shippedFiles>;
