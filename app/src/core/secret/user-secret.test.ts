import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { DataProtectionError, userSecret } from "./user-secret.ts";

const SMALL = 37;
const ONE_MEBIBYTE = 1_048_576;
const SIZES = [0, 1, SMALL, ONE_MEBIBYTE];
const FILL = 7;
const FLIP_ALL_BITS = 0xff;
const PLAIN = "gemini-live dpapi test";

function powerShell(script: string) {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  }).trim();
}

const LOAD_ASSEMBLY = "Add-Type -AssemblyName System.Security;";

function sealWithDotNet({ text, entropyBase64 }: { text: string; entropyBase64?: string }) {
  const entropy = entropyBase64 ? `[Convert]::FromBase64String('${entropyBase64}')` : "$null";
  return powerShell(
    `${LOAD_ASSEMBLY}[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect(` +
      `[Text.Encoding]::UTF8.GetBytes('${text}'), ${entropy}, 'CurrentUser'))`
  );
}

function unsealWithDotNet({ sealedBase64, entropyBase64 }: { sealedBase64: string; entropyBase64?: string }) {
  const entropy = entropyBase64 ? `[Convert]::FromBase64String('${entropyBase64}')` : "$null";
  return powerShell(
    `${LOAD_ASSEMBLY}[Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect(` +
      `[Convert]::FromBase64String('${sealedBase64}'), ${entropy}, 'CurrentUser'))`
  );
}

describe("userSecret", () => {
  it("round-trips empty, small and large input", () => {
    for (const size of SIZES) {
      const plain = Buffer.alloc(size, FILL);
      const sealed = userSecret.seal({ plain });
      assert.notDeepEqual(Buffer.from(sealed), plain);
      assert.deepEqual(Buffer.from(userSecret.unseal({ sealed })), plain);
    }
  });

  it("needs the same entropy to unseal", () => {
    const entropy = Buffer.from("pepper");
    const sealed = userSecret.seal({
      plain: Buffer.from(PLAIN),
      entropy
    });
    assert.equal(
      Buffer.from(
        userSecret.unseal({
          sealed,
          entropy
        })
      ).toString(),
      PLAIN
    );
    assert.throws(
      () =>
        userSecret.unseal({
          sealed,
          entropy: Buffer.from("other")
        }),
      DataProtectionError
    );
    assert.throws(() => userSecret.unseal({ sealed }), DataProtectionError);
  });

  it("refuses a corrupted blob", () => {
    const sealed = Buffer.from(userSecret.seal({ plain: Buffer.from(PLAIN) }));
    sealed[sealed.length - 1] = (sealed.at(-1) ?? 0) ^ FLIP_ALL_BITS;
    assert.throws(() => userSecret.unseal({ sealed }), DataProtectionError);
  });

  it("unseals a blob sealed by .NET ProtectedData for the current user", () => {
    const sealed = Buffer.from(sealWithDotNet({ text: PLAIN }), "base64");
    assert.equal(Buffer.from(userSecret.unseal({ sealed })).toString(), PLAIN);
  });

  it("unseals a .NET blob that used entropy", () => {
    const entropy = Buffer.from("pepper");
    const sealed = Buffer.from(
      sealWithDotNet({
        text: PLAIN,
        entropyBase64: entropy.toString("base64")
      }),
      "base64"
    );
    assert.equal(
      Buffer.from(
        userSecret.unseal({
          sealed,
          entropy
        })
      ).toString(),
      PLAIN
    );
  });

  it("makes blobs .NET can unseal", () => {
    const sealed = Buffer.from(userSecret.seal({ plain: Buffer.from(PLAIN) })).toString("base64");
    assert.equal(unsealWithDotNet({ sealedBase64: sealed }), PLAIN);
  });
});
