// Typed messaging in @webext-core/messaging's style, over channels that library doesn't cover: the
// WebView2 bridge between the app and its hidden pages, and the WebSocket between the app and the
// browser extension. Each channel declares a protocol map keyed by an enum,
//
//   enum GlicMessage { Capture = 'capture' }
//   interface GlicProtocolMap { [GlicMessage.Capture](): Frame | null }
//
// and both ends call sendMessage(type, data) / onMessage(type, handler) as with the library. The
// signatures use the library's own public types. The app's side is Messenger in
// src/GeminiLive/Messaging.cs, speaking the same envelopes.

import type {
  GetDataType,
  GetReturnType,
  MaybePromise,
  Message,
  RemoveListenerCallback
} from "@webext-core/messaging";

export type { RemoveListenerCallback };

/** Any protocol map: message type -> `(data) => return` declaration, as in the library. */
// The library's own constraint; a protocol map's methods aren't assignable to anything narrower.
export type ProtocolMap = Record<string, any>;

/** The library's GenericMessenger, minus its per-transport send arguments. */
export interface Messenger<TProtocolMap extends ProtocolMap> {
  sendMessage<TType extends keyof TProtocolMap>(
    type: TType,
    ...args: GetDataType<TProtocolMap[TType]> extends undefined ? [data?: undefined] : never
  ): Promise<GetReturnType<TProtocolMap[TType]>>;
  sendMessage<TType extends keyof TProtocolMap>(
    type: TType,
    data: GetDataType<TProtocolMap[TType]>,
  ): Promise<GetReturnType<TProtocolMap[TType]>>;
  onMessage<TType extends keyof TProtocolMap>(
    type: TType,
    onReceived: (
      message: Message<TProtocolMap, TType>
    ) => void | MaybePromise<GetReturnType<TProtocolMap[TType]>>,
  ): RemoveListenerCallback;
  removeAllListeners(): void;
}

/** How envelopes cross one channel. */
export interface Transport {
  /** Sends one envelope; a plain JSON-safe object. */
  post(envelope: object): void;
  /** Delivers every envelope that arrives, unparsed and unchecked. */
  listen(receive: (envelope: unknown) => void): void;
}

export interface MessagingConfig {
  /**
   * How long sendMessage waits for the other end before rejecting. Our channels drop messages
   * while a page navigates or a socket reconnects, so nothing waits forever.
   */
  timeoutMs: number;
}

// The two envelopes, shared with Messenger.cs: a request, and the reply to one. Checked by hand
// rather than with zod, which would otherwise ride along in every page bridge's bundle.
interface Request {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

interface Reply {
  replyTo: number;
  res?: unknown;
  err?: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isRequest = (value: unknown): value is Request =>
  isRecord(value) &&
  typeof value.id === "number" &&
  typeof value.type === "string" &&
  typeof value.timestamp === "number";

const isReply = (value: unknown): value is Reply =>
  isRecord(value) &&
  typeof value.replyTo === "number" &&
  (value.err === undefined || value.err === null || typeof value.err === "string");

/** Messages to and from the other end of `transport`, typed by `TProtocolMap`. */
export const defineMessaging = <TProtocolMap extends ProtocolMap>(
  transport: Transport,
  config: MessagingConfig
): Messenger<TProtocolMap> => {
  type Handler = (message: Message<TProtocolMap, keyof TProtocolMap>) => unknown;
  const handlers = new Map<string, Handler>();
  const pending = new Map<number, {
    resolve(res: unknown): void;
    reject(error: Error): void;
  }>();
  let nextId = 1;

  const answer = async (request: Request): Promise<void> => {
    const handler = handlers.get(request.type);
    if (!handler) {
      transport.post({
        replyTo: request.id,
        err: `No listener for "${request.type}"`
      });
      return;
    }

    try {
      const res = await handler(request as Message<TProtocolMap, keyof TProtocolMap>);
      transport.post({
        replyTo: request.id,
        res: res ?? null
      });
    } catch (error) {
      transport.post({
        replyTo: request.id,
        err: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const settle = (reply: Reply): void => {
    const waiting = pending.get(reply.replyTo);
    if (!waiting) {
      return; // timed out already, or not ours
    }

    pending.delete(reply.replyTo);

    if (reply.err != null) {
      waiting.reject(new Error(reply.err));
      return;
    }

    waiting.resolve(reply.res);
  };

  transport.listen(envelope => {
    if (isRequest(envelope)) {
      void answer(envelope);
      return;
    }

    if (isReply(envelope)) {
      settle(envelope);
    }
  });

  const sendMessage = (type: keyof TProtocolMap, data?: unknown): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve,
        reject
      });
      setTimeout(() => {
        if (pending.delete(id)) {
          reject(new Error(`No reply to "${String(type)}" in ${config.timeoutMs} ms`));
        }
      }, config.timeoutMs);
      transport.post({
        id,
        type,
        data: data ?? null,
        timestamp: Date.now()
      });
    });
  };

  return {
    sendMessage: sendMessage as Messenger<TProtocolMap>["sendMessage"],
    onMessage(type, onReceived) {
      const key = String(type);
      if (handlers.has(key)) {
        throw new Error(`"${key}" already has a listener`);
      }

      handlers.set(key, onReceived as Handler);
      return () => handlers.delete(key);
    },
    removeAllListeners: () => handlers.clear()
  };
};
