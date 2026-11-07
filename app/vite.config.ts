import { aliasPlugin } from "./alias.ts";
import { defineConfig } from "vite";
import { winuiSvelte } from "winui-svelte/vite";

export default defineConfig({
  plugins: [aliasPlugin(), winuiSvelte()]
});
