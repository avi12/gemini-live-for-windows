import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChipKind } from "./chip.ts";
import { detectChips, detectTextChips } from "./detect-text-chips.ts";

const TEXT_CHIP_LIMIT = 6;

function found(text: string) {
  return detectTextChips(text).map(chip => [chip.kind, chip.value]);
}

describe("detectTextChips", () => {
  it("finds a web address with its scheme, bare or after www", () => {
    assert.deepEqual(found("see https://example.com/a?b=1 now"), [[ChipKind.URL, "https://example.com/a?b=1"]]);
    assert.deepEqual(found("www.example.org"), [[ChipKind.URL, "https://www.example.org/"]]);
    assert.deepEqual(found("visit example.com/docs"), [[ChipKind.URL, "https://example.com/docs"]]);
  });

  it("leaves file names and abbreviations alone", () => {
    assert.deepEqual(found("open notes.txt e.g. today i.e. later"), []);
  });

  it("drops the punctuation around an address", () => {
    assert.deepEqual(found("(https://example.com/x)."), [[ChipKind.URL, "https://example.com/x"]]);
    assert.deepEqual(found('"example.com",'), [[ChipKind.URL, "https://example.com/"]]);
  });

  it("finds an address inside Hebrew text, with or without a joined prefix letter", () => {
    assert.deepEqual(found("בקרו באתר example.com היום"), [[ChipKind.URL, "https://example.com/"]]);
    assert.deepEqual(found("ראו ב-example.com."), [[ChipKind.URL, "https://example.com/"]]);
    assert.deepEqual(found("שלחו ל־dana@example.co.il"), [[ChipKind.EMAIL, "dana@example.co.il"]]);
  });

  it("ignores the direction marks around an address", () => {
    assert.deepEqual(found("‏https://example.com‎"), [[ChipKind.URL, "https://example.com/"]]);
  });

  it("finds e-mail addresses and does not take them for links", () => {
    assert.deepEqual(found("write to a.b+c@mail.example.com, please"), [[ChipKind.EMAIL, "a.b+c@mail.example.com"]]);
    assert.deepEqual(found("not@anemail and @handle"), []);
  });

  it("finds phone numbers written with separators, a plus or a leading zero", () => {
    assert.deepEqual(found("call 050-123-4567 today"), [[ChipKind.PHONE, "0501234567"]]);
    assert.deepEqual(found("+972 50 123 4567"), [[ChipKind.PHONE, "+972501234567"]]);
    assert.deepEqual(found("(555) 123-4567"), [[ChipKind.PHONE, "5551234567"]]);
    assert.deepEqual(found("התקשרו 03 123 4567 עכשיו"), [[ChipKind.PHONE, "031234567"]]);
    assert.deepEqual(found("התקשרו 0501234567 עכשיו"), [[ChipKind.PHONE, "0501234567"]]);
  });

  it("leaves dates, short numbers and number runs alone", () => {
    assert.deepEqual(found("on 2026-11-12 and 12.11.2026"), []);
    assert.deepEqual(found("room 12345"), []);
    assert.deepEqual(found("100 200 300 400"), []);
    assert.deepEqual(found("1234567890123456789"), []);
  });

  it("does not read the digits of an address as a phone number", () => {
    assert.deepEqual(found("https://example.com/1234567890"), [[ChipKind.URL, "https://example.com/1234567890"]]);
  });
});

describe("detectChips", () => {
  it("puts a decoded code before what the words say and keeps each once", () => {
    const chips = detectChips({
      lines: ["go to example.com", "example.com"],
      codes: ["https://qr.example/x", "", "https://qr.example/x"]
    });
    assert.deepEqual(
      chips.map(chip => [chip.kind, chip.value]),
      [
        [ChipKind.QR, "https://qr.example/x"],
        [ChipKind.URL, "https://example.com/"]
      ]
    );
  });

  it("offers at most a handful of text chips", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `a${i}.example.com`);
    assert.equal(
      detectChips({
        lines,
        codes: []
      }).length,
      TEXT_CHIP_LIMIT
    );
  });
});
