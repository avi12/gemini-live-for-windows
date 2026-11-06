import { readHostProcessId, watchHostProcess } from "@/lib/host-process.ts";
import path from "node:path";
import { MessageChannel, Worker } from "node:worker_threads";
import { initWindowsAppSdk } from "winui-svelte/bootstrap";
import type { Json } from "winui-svelte/state/host";
import { createMessagePortTransport, createStdioTransport, reserveStdout } from "winui-svelte/state/host";

const WINDOWS_APP_SDK_MAJOR = 2;
const WINDOWS_APP_SDK_MINOR = 2;

function reportRelayProblem(reason: string) {
  process.stderr.write(`relay: ${reason}\n`);
}

const PACKAGED_VARIABLE = "PILL_IS_PACKAGED";
const NOT_SUPPORTED_HRESULT = "0x80070032";

function startWindowsAppSdk() {
  try {
    initWindowsAppSdk({
      major: WINDOWS_APP_SDK_MAJOR,
      minor: WINDOWS_APP_SDK_MINOR
    });
  } catch (error) {
    const isPackaged = process.env[PACKAGED_VARIABLE] === "1";
    const isRefusedByIdentity = error instanceof Error && error.message.includes(NOT_SUPPORTED_HRESULT);
    const isRuntimeFromPackage = isPackaged && isRefusedByIdentity;
    if (!isRuntimeFromPackage) {
      throw error;
    }
  }
}

function startRelay() {
  reserveStdout();
  startWindowsAppSdk();

  const link = new MessageChannel();
  const worker = new Worker(path.join(import.meta.dirname, "window.js"), {
    workerData: {
      port: link.port2
    },
    transferList: [link.port2]
  });
  const core = createStdioTransport<Json>();
  const window = createMessagePortTransport<Json>({ port: link.port1 });

  core.listen({
    message: value => window.send(value),
    malformed: reportRelayProblem,
    closed: () => process.exit(0)
  });
  window.listen({
    message: value => core.send(value),
    malformed: reportRelayProblem,
    closed: () => process.exit(0)
  });
  worker.on("error", error => {
    process.stderr.write(`${error.stack ?? String(error)}\n`);
    process.exitCode = 1;
  });
  worker.on("exit", code => process.exit(process.exitCode ?? code));

  const hostProcessId = readHostProcessId(process.env["HOST_PID"]);
  const isHostKnown = hostProcessId !== undefined;
  if (isHostKnown) {
    watchHostProcess({
      processId: hostProcessId,
      onGone: () => process.exit(0)
    });
  }
}

startRelay();
