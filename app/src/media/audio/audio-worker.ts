import { parentPort } from "node:worker_threads";

import { startAudioWorker } from "./worker/audio-worker-main.ts";

startAudioWorker({ port: parentPort });
