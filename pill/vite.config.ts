import { SRC_ALIAS } from "./alias.ts";
import { defineConfig } from "vite";
import { winuiSvelte } from "winui-svelte/vite";

export default defineConfig({
  plugins: [winuiSvelte()],
  resolve: {
    alias: SRC_ALIAS
  }
});
