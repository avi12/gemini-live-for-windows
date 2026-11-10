import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const FONT_FILES = ["GoogleSans-Variable.ttf", "MaterialSymbolsRounded.ttf"] as const;
const FONT_DIRECTORY = path.join(import.meta.dirname, "..", "pill", "fonts");

// winui-svelte resolves every entry with the window's "browser" condition (Svelte's browser build
// is the one that mounts), which also picks a browser-only export for packages that ship both
// (`ws` exports a stub without WebSocketServer). The app runs on Node, so these resolve as Node
// does for the app's own `import`.
const NODE_PACKAGES = new Set(["ws"]);

function nodeResolvePlugin(root: string) {
  const requireFromApp = createRequire(path.join(root, "package.json"));
  return {
    name: "gemini-live-node-resolve",
    enforce: "pre" as const,
    resolveId(source: string) {
      return NODE_PACKAGES.has(source) ? requireFromApp.resolve(source) : null;
    }
  };
}

// `entries` maps each output file's name to its source file, relative to the package's src folder
export async function buildWinuiApp<Config extends object>({ root, entries, config, buildApp }: {
  root: string;
  entries: Readonly<Record<string, string>>;
  config: Config;
  buildApp: (options: {
    root: string;
    entries: Record<string, string>;
    outDirectory: string;
    config: Config;
  }) => Promise<string[]>;
}) {
  const outDirectory = path.join(root, "dist");
  const files = await buildApp({
    root,
    entries: Object.fromEntries(Object.entries(entries).map(([name, source]) => [name, path.join(root, "src", source)])),
    outDirectory,
    config: {
      ...config,
      plugins: [nodeResolvePlugin(root), ..."plugins" in config && Array.isArray(config.plugins) ? config.plugins : []]
    }
  });

  for (const font of FONT_FILES) {
    await copyFile(path.join(FONT_DIRECTORY, font), path.join(outDirectory, font));
  }

  process.stdout.write(`${[...files, ...FONT_FILES].join("\n")}\n`);
}
