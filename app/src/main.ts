import { shippedFiles } from "@/wiring/shipped-files.ts";
import { startApp } from "@/wiring/start-app.ts";

await startApp({ files: shippedFiles({ directory: import.meta.dirname }) });
