// Bundles the TypeScript page bridges to the plain JS the app embeds and injects at document-start.
// Each bridge is one self-contained IIFE: its modules and the messaging package are bundled in. Run
// via `pnpm build` (type-checks first) or directly with `node build.mjs`.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../src/GeminiLive/Glic");

const bridges = ["glic_bridge", "home_bridge"];

for (const name of bridges) {
  await build({
    entryPoints: [resolve(here, `${name}.ts`)],
    outfile: resolve(outDir, `${name}.js`),
    bundle: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    legalComments: "none",
    banner: {
      js: `// GENERATED from bridge/${name}.ts - edit the TypeScript, then \`pnpm --dir bridge build\`.`
    }
  });
  console.log(`bundled ${name}.js`);
}
