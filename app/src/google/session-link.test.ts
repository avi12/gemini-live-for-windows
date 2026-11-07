import { createSessionLink } from "./session-link.ts";
import { createFrameTransport } from "./web-host/transports.ts";
import { defineMessaging } from "@gemini-live/messaging";
import {
  type BrowserCookie,
  EXTENSION_ORIGIN,
  type LinkInfo,
  LinkMessage,
  type LinkProtocolMap
} from "@gemini-live/protocol/link";
import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, describe, test } from "node:test";
import { WebSocket } from "ws";

function cookie(name: string) {
  const result: BrowserCookie = {
    name,
    value: "v",
    domain: ".google.com",
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: null,
    expirationDate: null
  };
  return result;
}

const TOKEN_HEX_LENGTH = 64;
const SETTLE_MS = 100;
const stoppers: Array<() => void> = [];

afterEach(() => {
  for (const stop of stoppers.splice(0)) {
    stop();
  }
});

async function startLink() {
  const published: LinkInfo[] = [];
  const link = createSessionLink({
    log: {
      write: () => undefined
    },
    publisher: {
      publish: async info => void published.push(info)
    },
    pingIntervalMs: 60_000,
    messageTimeoutMs: 2000
  });
  stoppers.push(link.stop);
  const port = await link.start();
  assert.ok(port);
  const [info] = published;
  assert.ok(info);
  assert.equal(info.port, port);
  return {
    link,
    port,
    token: info.token
  };
}

// The extension's side: answers Hello, Query, Refresh and Ping like extension/src/lib/link.ts
function connectExtension({ port, cookies }: {
  port: number;
  cookies: BrowserCookie[];
}) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: EXTENSION_ORIGIN });
  stoppers.push(() => socket.terminate());
  const tokens: string[] = [];
  const seen = {
    tokens,
    refreshes: 0,
    pings: 0
  };
  const messenger = defineMessaging<LinkProtocolMap>(
    createFrameTransport({
      send: json => socket.send(json),
      onFrame: listener => socket.on("message", data => listener(data.toString()))
    }), { timeoutMs: 2000 }
  );
  messenger.onMessage(LinkMessage.hello, message => {
    seen.tokens.push(message.data);
  });
  messenger.onMessage(LinkMessage.query, () => cookies);
  messenger.onMessage(LinkMessage.refresh, () => {
    seen.refreshes += 1;
  });
  messenger.onMessage(LinkMessage.ping, () => {
    seen.pings += 1;
  });
  return {
    socket,
    messenger,
    seen
  };
}

describe("session link", () => {
  test("greets the extension with this run's token and then counts it connected", async () => {
    const { link, port, token } = await startLink();
    const connected = new Promise<void>(resolve => link.source.onConnected(resolve));
    const extension = connectExtension({
      port,
      cookies: []
    });
    await connected;
    assert.deepEqual(extension.seen.tokens, [token]);
    assert.equal(link.source.isExtensionConnected, true);
    assert.equal(token.length, TOKEN_HEX_LENGTH);
  });

  test("refuses any other origin", async () => {
    const { port } = await startLink();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "https://evil.example" });
    stoppers.push(() => socket.terminate());
    const [error] = await once(socket, "error");
    assert.match(String(error), /403/);
  });

  test("delivers only the auth cookies of a push", async () => {
    const { link, port } = await startLink();
    const connected = new Promise<void>(resolve => link.source.onConnected(resolve));
    const extension = connectExtension({
      port,
      cookies: []
    });
    await connected;
    const delivered = new Promise<readonly BrowserCookie[]>(resolve => link.source.onCookies(resolve));
    await extension.messenger.sendMessage(LinkMessage.cookies, [cookie("SID"), cookie("_ga")]);
    assert.deepEqual((await delivered).map(item => item.name), ["SID"]);
  });

  test("asks for the cookies on request and for a refresh", async () => {
    const { link, port } = await startLink();
    const connected = new Promise<void>(resolve => link.source.onConnected(resolve));
    const extension = connectExtension({
      port,
      cookies: [cookie("__Secure-1PSID"), cookie("tracking")]
    });
    await connected;
    const delivered = new Promise<readonly BrowserCookie[]>(resolve => link.source.onCookies(resolve));
    link.source.requestCookies();
    assert.deepEqual((await delivered).map(item => item.name), ["__Secure-1PSID"]);

    link.source.requestRefresh();
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    assert.equal(extension.seen.refreshes, 1);
  });

  test("is no longer connected once the extension leaves", async () => {
    const { link, port } = await startLink();
    const connected = new Promise<void>(resolve => link.source.onConnected(resolve));
    const extension = connectExtension({
      port,
      cookies: []
    });
    await connected;
    extension.socket.close();
    await once(extension.socket, "close");
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    assert.equal(link.source.isExtensionConnected, false);
  });
});
