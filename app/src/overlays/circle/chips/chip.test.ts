import { ChipActionKind, chipActions, ChipKind, createChip } from "./chip.ts";
import { isOpenableUri, mailtoUri, webAddress } from "./open-uri.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function chip({ kind, value }: {
  kind: ChipKind;
  value: string;
}) {
  return createChip({
    kind,
    label: value,
    value
  });
}

describe("webAddress", () => {
  it("accepts http and https and nothing else", () => {
    assert.equal(webAddress("https://example.com"), "https://example.com/");
    assert.equal(webAddress(" http://example.com/a "), "http://example.com/a");
    assert.equal(webAddress("javascript:alert(1)"), undefined);
    assert.equal(webAddress("file:///C:/Windows/notepad.exe"), undefined);
    assert.equal(webAddress("ms-settings:network"), undefined);
    assert.equal(webAddress("calc.exe"), undefined);
    assert.equal(webAddress("just words"), undefined);
  });
});

describe("isOpenableUri", () => {
  it("lets a web page or a new message through and nothing else", () => {
    assert.equal(isOpenableUri("https://example.com"), true);
    assert.equal(isOpenableUri(mailtoUri("a@b.co")), true);
    assert.equal(isOpenableUri("javascript:alert(1)"), false);
    assert.equal(isOpenableUri("file:///C:/x.exe"), false);
    assert.equal(isOpenableUri("tel:+972501234567"), false);
    assert.equal(isOpenableUri("not an address"), false);
  });
});

describe("chipActions", () => {
  it("opens a link and an e-mail address", () => {
    assert.deepEqual(
      chipActions(
        chip({
          kind: ChipKind.url,
          value: "https://example.com/"
        })
      ), [{
        kind: ChipActionKind.open,
        target: "https://example.com/"
      }]
    );
    assert.deepEqual(
      chipActions(
        chip({
          kind: ChipKind.email,
          value: "a@b.co"
        })
      ), [{
        kind: ChipActionKind.open,
        target: "mailto:a@b.co"
      }]
    );
  });

  it("only copies a phone number", () => {
    assert.deepEqual(
      chipActions(
        chip({
          kind: ChipKind.phone,
          value: "0501234567"
        })
      ), [{
        kind: ChipActionKind.copy,
        target: "0501234567"
      }]
    );
  });

  it("copies a code, and opens it only when it is a web address", () => {
    assert.deepEqual(
      chipActions(
        chip({
          kind: ChipKind.qr,
          value: "https://example.com"
        })
      ).map(action => action.kind),
      [ChipActionKind.copy, ChipActionKind.open]
    );
    for (const text of ["javascript:alert(1)", "WIFI:S:home;P:x;;", "file:///C:/a.exe", "hello"]) {
      assert.deepEqual(
        chipActions(
          chip({
            kind: ChipKind.qr,
            value: text
          })
        ), [{
          kind: ChipActionKind.copy,
          target: text
        }]
      );
    }
  });
});
