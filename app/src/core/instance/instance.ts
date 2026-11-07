import { ActivationMessage, keyTriggerSchema } from "./activation-protocol.ts";
import type { ActivationProtocolMap } from "./activation-protocol.ts";
import { KeyTrigger } from "./key-trigger.ts";
import { socketTransport } from "@/lib/transport/socket-transport.ts";
import { defineMessaging } from "@gemini-live/messaging";
import net from "node:net";

const ACTIVATE_PIPE = String.raw`\\.\pipe\GeminiLive.Activate`;
const CONNECT_TIMEOUT_MS = 150;
const REPLY_TIMEOUT_MS = 1000;

function messagingOver(socket: net.Socket) {
  socket.on("error", () => undefined);
  return defineMessaging<ActivationProtocolMap>(socketTransport(socket), { timeoutMs: REPLY_TIMEOUT_MS });
}

// Connects to whoever serves the pipe; undefined when nobody answers in time
function connectToInstance(pipePath: string) {
  return new Promise<net.Socket | undefined>(resolve => {
    const socket = net.connect(pipePath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(undefined);
    }, CONNECT_TIMEOUT_MS);
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

async function askInstance({ pipePath, ask }: {
  pipePath: string;
  ask: (messaging: ReturnType<typeof messagingOver>) => Promise<unknown>;
}) {
  const socket = await connectToInstance(pipePath);
  if (!socket) {
    return false;
  }

  try {
    await ask(messagingOver(socket));
    return true;
  } catch {
    return false;
  } finally {
    socket.destroy();
  }
}

// Whether the app is running, asked without starting anything
export function isInstanceRunning({ pipePath = ACTIVATE_PIPE }: { pipePath?: string } = {}) {
  return askInstance({
    pipePath,
    ask: messaging => messaging.sendMessage(ActivationMessage.ping)
  });
}

function forwardTrigger({ pipePath = ACTIVATE_PIPE, trigger }: {
  pipePath?: string;
  trigger: KeyTrigger;
}) {
  return askInstance({
    pipePath,
    ask: messaging => messaging.sendMessage(ActivationMessage.trigger, trigger)
  });
}

function listen({ server, pipePath }: {
  server: net.Server;
  pipePath: string;
}) {
  return new Promise<boolean>((resolve, reject) => {
    server.once("error", error => {
      const isTaken = "code" in error && error.code === "EADDRINUSE";
      if (isTaken) {
        resolve(false);
        return;
      }

      reject(error);
    });
    server.listen(pipePath, () => resolve(true));
  });
}

function serve({ pipePath, onTrigger }: {
  pipePath: string;
  onTrigger: (trigger: KeyTrigger) => void;
}) {
  const server = net.createServer(socket => {
    const messaging = messagingOver(socket);
    messaging.onMessage(ActivationMessage.ping, () => undefined);
    messaging.onMessage(ActivationMessage.trigger, message => {
      onTrigger(keyTriggerSchema.parse(message.data));
    });
  });
  return {
    server,
    isListening: listen({
      server,
      pipePath
    })
  };
}

export type InstanceClaim =
  | {
    isPrimary: true;
    close(): Promise<void>;
  }
  | {
    isPrimary: false;
    isForwarded: boolean;
  };

// The pipe is the lock: the first process to serve it is the app. A later launch hands its trigger
// to that one and is told to exit.
export async function claimInstance({ trigger = KeyTrigger.tap, onTrigger, pipePath = ACTIVATE_PIPE }: {
  trigger?: KeyTrigger;
  onTrigger: (trigger: KeyTrigger) => void;
  pipePath?: string;
}) {
  const { server, isListening } = serve({
    pipePath,
    onTrigger
  });
  if (await isListening) {
    server.on("error", () => undefined);
    return {
      isPrimary: true as const,
      close: () => new Promise<void>(resolve => {
        server.close(() => resolve());
      })
    };
  }

  const isForwarded = await forwardTrigger({
    pipePath,
    trigger
  });
  return {
    isPrimary: false as const,
    isForwarded
  };
}
