import { servePillModules } from "./module-server.ts";
import { MessagePort, workerData } from "node:worker_threads";
import { z } from "zod";

const workerDataSchema = z.object({ modules: z.instanceof(MessagePort) });

const parsedData = workerDataSchema.safeParse(workerData);
if (!parsedData.success) {
  throw new Error("the module server was given no port");
}

await servePillModules({ port: parsedData.data.modules });
