import { startAudioWorker } from "./audio-worker-main.ts";
import { parentPort } from "node:worker_threads";

startAudioWorker({ port: parentPort });
