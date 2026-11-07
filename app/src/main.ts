import { shippedFiles } from "@/wiring/main-thread/shipped-files.ts";
import { startApp } from "@/wiring/main-thread/start-app.ts";

await startApp({ files: shippedFiles({ directory: import.meta.dirname }) });
