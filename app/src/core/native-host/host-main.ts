import { stdioTransport } from "./stdio-transport.ts";
import { readLinkFile } from "@/core/link/link-file.ts";
import { log } from "@/core/log/log.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { defineMessaging } from "@gemini-live/messaging";
import { type LinkInfo, NativeMessage, type NativeProtocolMap } from "@gemini-live/protocol/link";
import type { Readable, Writable } from "node:stream";

const REPLY_TIMEOUT_MS = 10_000;

// Answers the extension's requests until the browser lets go of our input. Stdout carries frames
// only, so anything else goes to the log file. Resolves with why the input ended badly, if it did.
export async function serveNativeHost({ input, output, readLink }: {
  input: Readable;
  output: Writable;
  readLink: () => Promise<LinkInfo | undefined>;
}) {
  const { transport, closed } = stdioTransport({
    input,
    output
  });
  const messaging = defineMessaging<NativeProtocolMap>(transport, { timeoutMs: REPLY_TIMEOUT_MS });
  messaging.onMessage(NativeMessage.link, async () => await readLink() ?? null);
  return closed;
}

// Host mode: the browser started us with the extension's origin as the first argument
export async function runNativeHost() {
  const reason = await serveNativeHost({
    input: process.stdin,
    output: process.stdout,
    readLink: () => readLinkFile()
  });
  const hasFailed = reason !== undefined;
  if (hasFailed) {
    log.write(`native host: ${errorMessage(reason)}`);
  }
}
