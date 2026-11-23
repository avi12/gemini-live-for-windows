import { MessagePort, workerData } from "node:worker_threads";

import { z } from "zod";

import { serveModules } from "./module-server.ts";

const workerDataSchema = z.object({
  modules: z.instanceof(MessagePort),
  root: z.string().min(1)
});

const parsedData = workerDataSchema.safeParse(workerData);
if (!parsedData.success) {
  throw new Error("the module server was given no port or root");
}

await serveModules({
  port: parsedData.data.modules,
  root: parsedData.data.root
});
