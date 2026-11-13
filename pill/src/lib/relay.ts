import { MessageChannel } from "node:worker_threads";
import type { MessagePort, Worker } from "node:worker_threads";

import { initWindowsAppSdk } from "winui-svelte/bootstrap";
import type { Json } from "winui-svelte/state/host";
import { createMessagePortTransport, createStdioTransport, reserveStdout } from "winui-svelte/state/host";

import { readHostProcessId, watchHostProcess } from "./host-process.ts";

const WINDOWS_APP_SDK_MAJOR = 2;
const WINDOWS_APP_SDK_MINOR = 2;
const PACKAGED_VARIABLE = "PILL_IS_PACKAGED";
const HOST_PID_VARIABLE = "HOST_PID";
const NOT_SUPPORTED_HRESULT = "0x80070032";

function reportRelayProblem(reason: string) {
  process.stderr.write(`relay: ${reason}\n`);
}

export function startWindowsAppSdk() {
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

function watchHost() {
  const hostProcessId = readHostProcessId(process.env[HOST_PID_VARIABLE]);
  const isHostKnown = hostProcessId !== undefined;
  if (!isHostKnown) {
    return;
  }

  watchHostProcess({
    processId: hostProcessId,
    onGone: () => process.exit(0)
  });
}

function pipeHostToWindow(link: MessagePort) {
  const core = createStdioTransport<Json>();
  const window = createMessagePortTransport<Json>({ port: link });

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
}

// The sidecar's one job: carry the host's lines on stdio to the window the worker runs, and back.
// `startWindow` gets the window's end of the link and returns the worker that owns the window.
export async function startRelay({ startWindow }: { startWindow: (port: MessagePort) => Worker | Promise<Worker> }) {
  reserveStdout();
  startWindowsAppSdk();

  const link = new MessageChannel();
  const worker = await startWindow(link.port2);
  pipeHostToWindow(link.port1);
  worker.on("error", error => {
    process.stderr.write(`${error.stack ?? String(error)}\n`);
    process.exitCode = 1;
  });
  worker.on("exit", code => process.exit(process.exitCode ?? code));
  watchHost();
}
