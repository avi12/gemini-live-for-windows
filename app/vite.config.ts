import { defineConfig } from "vite";
import { winuiSvelte } from "winui-svelte/vite";

import { aliasPlugin } from "./alias.ts";

export default defineConfig({
  plugins: [aliasPlugin(), winuiSvelte()]
});
