import { SRC_ALIAS } from "./alias.ts";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { buildApp } from "winui-svelte/vite";

const FONT_FILES = ["GoogleSans-Variable.ttf", "MaterialSymbolsRounded.ttf"] as const;
const FONT_DIRECTORY = path.join(import.meta.dirname, "..", "src", "GeminiLive", "Fonts");
const OUT_DIRECTORY = path.join(import.meta.dirname, "dist");

const files = await buildApp({
  root: import.meta.dirname,
  entries: {
    main: path.join(import.meta.dirname, "src", "main.ts"),
    window: path.join(import.meta.dirname, "src", "window.ts")
  },
  outDirectory: OUT_DIRECTORY,
  config: {
    resolve: {
      alias: SRC_ALIAS
    }
  }
});

for (const font of FONT_FILES) {
  await copyFile(path.join(FONT_DIRECTORY, font), path.join(OUT_DIRECTORY, font));
}

process.stdout.write(`${[...files, ...FONT_FILES].join("\n")}\n`);
