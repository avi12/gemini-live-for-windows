import { parentPort } from "node:worker_threads";

import { startScreenCaptureWorker } from "./worker/screen-capture-worker-main.ts";

startScreenCaptureWorker({ port: parentPort });
