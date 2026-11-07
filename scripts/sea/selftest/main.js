import { Worker } from "node:worker_threads";

const worker = new Worker(new URL("./worker.js", import.meta.url));
worker.on("message", line => process.stdout.write(`${line}\n`));
worker.on("error", error => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
