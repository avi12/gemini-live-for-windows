import { buildApp } from "winui-svelte/vite";

import { buildWinuiApp } from "../scripts/build-winui-app.ts";
import { SRC_ALIAS } from "./alias.ts";

await buildWinuiApp({
  buildApp,
  root: import.meta.dirname,
  entries: {
    main: "main.ts",
    window: "window.ts"
  },
  config: {
    resolve: {
      alias: SRC_ALIAS
    }
  }
});
