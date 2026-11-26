import { loadStartApp } from "@/wiring/dev/source-loader.ts";
import { shippedFiles } from "@/wiring/main-thread/shipped-files.ts";

// While `bun run dev` runs, the app's code comes from the repo's source rather than this bundle
const startApp = await loadStartApp();
await startApp({ files: shippedFiles({ directory: import.meta.dirname }) });
