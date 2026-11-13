import { parentPort } from "node:worker_threads";

import { startUiaWorker } from "./uia-worker-main.ts";

startUiaWorker({ port: parentPort });
