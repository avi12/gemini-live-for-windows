import { buildWinuiApp } from "../scripts/build-winui-app.ts";
import { SRC_ALIAS } from "./alias.ts";
import { buildApp } from "winui-svelte/vite";

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
