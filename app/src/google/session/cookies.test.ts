import {
  authCookies,
  createSessionStore,
  decodeSession,
  encodeSession,
  fingerprint,
  hasSession,
  isAuthCookie,
  sameSiteOf
} from "./cookies.ts";
import type { SecretSealer } from "@/google/ports.ts";
import type { BrowserCookie } from "@gemini-live/protocol/link";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

function cookie(name: string) {
  const result: BrowserCookie = {
    name,
    value: "v",
    domain: ".google.com",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    expirationDate: 1_900_000_000
  };
  return result;
}

const reversingSealer: SecretSealer = {
  seal: async plain => plain.toReversed(),
  unseal: async sealed => sealed.toReversed()
};

describe("auth cookies", () => {
  test("keeps the login family and drops analytics noise", () => {
    const kept = authCookies([cookie("SID"), cookie("_ga"), cookie("__Secure-3PAPISID"), cookie("NID")]);
    assert.deepEqual(kept.map(item => item.name), ["SID", "__Secure-3PAPISID", "NID"]);
    assert.equal(isAuthCookie("__Host-GAPS"), true);
    assert.equal(isAuthCookie("_ga"), false);
  });

  test("a session needs SID or the secure 1PSID", () => {
    assert.equal(hasSession([cookie("SID")]), true);
    assert.equal(hasSession([cookie("__Secure-1PSID")]), true);
    assert.equal(hasSession([cookie("NID")]), false);
  });
});

describe("fingerprint", () => {
  test("ignores order and changes with a value", () => {
    const sid = {
      ...cookie("SID"),
      value: "a"
    };
    const hsid = {
      ...cookie("HSID"),
      value: "b"
    };
    const first = fingerprint([sid, hsid]);
    assert.equal(fingerprint([hsid, sid]), first);
    assert.notEqual(
      fingerprint([{
        ...sid,
        value: "changed"
      }, hsid]), first
    );
  });
});

describe("sameSiteOf", () => {
  test("anything but strict and lax is none", () => {
    assert.equal(sameSiteOf("strict"), "strict");
    assert.equal(sameSiteOf("lax"), "lax");
    assert.equal(sameSiteOf("no_restriction"), "none");
    assert.equal(sameSiteOf(null), "none");
  });
});

describe("session format", () => {
  test("round trips", () => {
    const cookies = [cookie("SID")];
    assert.deepEqual(decodeSession(encodeSession(cookies)), cookies);
  });

  test("reads what the C# app wrote: camelCase, with a null SameSite and expiry", () => {
    const written = "[{\"name\":\"SID\",\"value\":\"x\",\"domain\":\".google.com\",\"path\":\"/\",\"secure\":true,\"httpOnly\":false,\"sameSite\":null,\"expirationDate\":null}]";
    const [first] = decodeSession(new TextEncoder().encode(written));
    assert.equal(first?.name, "SID");
    assert.equal(first?.expirationDate, null);
  });

  test("a malformed file is an empty session", () => {
    assert.deepEqual(decodeSession(new TextEncoder().encode("{\"not\":\"a list\"}")), []);
  });
});

describe("session store", () => {
  test("seals on save and unseals on load", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "google-session-"));
    try {
      const filePath = path.join(folder, "nested", "google-session.bin");
      const messages: string[] = [];
      const store = createSessionStore({
        filePath,
        sealer: reversingSealer,
        log: {
          write: message => messages.push(message)
        }
      });
      assert.deepEqual(await store.load(), []);
      const secret = {
        ...cookie("SID"),
        value: "secret"
      };
      await store.save([secret]);
      const onDisk = await readFile(filePath);
      assert.equal(onDisk.toString().includes("secret"), false);
      assert.deepEqual(await store.load(), [secret]);
      assert.deepEqual(messages, []);
    } finally {
      await rm(folder, {
        recursive: true,
        force: true
      });
    }
  });

  test("an unreadable file is logged and treated as no session", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "google-session-"));
    try {
      const messages: string[] = [];
      const failing: SecretSealer = {
        seal: async plain => plain,
        async unseal() {
          throw new Error("wrong user");
        }
      };
      const filePath = path.join(folder, "google-session.bin");
      await createSessionStore({
        filePath,
        sealer: reversingSealer,
        log: {
          write: () => undefined
        }
      }).save([cookie("SID")]);
      const store = createSessionStore({
        filePath,
        sealer: failing,
        log: {
          write: message => messages.push(message)
        }
      });
      assert.deepEqual(await store.load(), []);
      assert.equal(messages.length, 1);
    } finally {
      await rm(folder, {
        recursive: true,
        force: true
      });
    }
  });
});
