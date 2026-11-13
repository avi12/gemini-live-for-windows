import { defineConfig } from "vite";
import { winuiSvelte } from "winui-svelte/vite";

import { SRC_ALIAS } from "./alias.ts";

export default defineConfig({
  plugins: [winuiSvelte()],
  resolve: {
    alias: SRC_ALIAS
  }
});
