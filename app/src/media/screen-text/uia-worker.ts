import { startUiaWorker } from "./uia-worker-main.ts";
import { parentPort } from "node:worker_threads";

startUiaWorker({ port: parentPort });
