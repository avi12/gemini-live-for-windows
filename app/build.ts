import { buildWinuiApp } from "../scripts/build-winui-app.ts";
import { aliasPlugin } from "./alias.ts";
import { buildApp } from "winui-svelte/vite";

// main.js starts the app, window.js is the UI thread (it carries the pill, the overlays and the
// Google pages), host.js is the browsers' native messaging host, audio-worker.js is the audio
// thread each conversation starts, and uia-worker.js is the thread that reads another window's text
await buildWinuiApp({
  buildApp,
  root: import.meta.dirname,
  entries: {
    main: "main.ts",
    window: "window.ts",
    host: "host.ts",
    "audio-worker": "media/audio/audio-worker.ts",
    "uia-worker": "media/screen-text/uia-worker.ts"
  },
  config: {
    plugins: [aliasPlugin()]
  }
});
