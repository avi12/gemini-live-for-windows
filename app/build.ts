import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { buildWinuiApp } from "@scripts/build-winui-app.ts";
import { buildApp } from "winui-svelte/vite";

import { aliasPlugin } from "./alias.ts";

// The runtime Hebrew text reading runs on: only the plain WebAssembly build, which the app loads from
// `litert` beside the bundles
const LITERT_FILES = ["litert_wasm_internal.js", "litert_wasm_internal.wasm"] as const;
const LITERT_FOLDER = "litert";

// main.js starts the app, window.js is the UI thread (it carries the pill, the overlays and the
// Google pages), host.js is the browsers' native messaging host, audio-worker.js is the audio
// thread each conversation starts, uia-worker.js is the thread that reads another window's text, and
// screen-capture-worker.js is the thread that grabs and encodes the screen frames
await buildWinuiApp({
  buildApp,
  root: import.meta.dirname,
  entries: {
    main: "main.ts",
    window: "window.ts",
    host: "host.ts",
    "audio-worker": "media/audio/audio-worker.ts",
    "uia-worker": "media/screen-text/uia-worker.ts",
    "screen-capture-worker": "media/screen/screen-capture-worker.ts"
  },
  config: {
    plugins: [aliasPlugin()]
  }
});

const litertSource = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@litertjs/core/package.json")),
  "wasm"
);
const litertTarget = path.join(import.meta.dirname, "dist", LITERT_FOLDER);
await mkdir(litertTarget, { recursive: true });
for (const file of LITERT_FILES) {
  await copyFile(path.join(litertSource, file), path.join(litertTarget, file));
}
