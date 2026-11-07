import { startAudioWorker } from "./worker/audio-worker-main.ts";
import { parentPort } from "node:worker_threads";

startAudioWorker({ port: parentPort });
