import {
  guidBytes,
  numberVariantBytes,
  propertyKeyBytes,
  readNumberVariant,
  VariantType
} from "./property-store.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const FORMAT_ID = "38652BCA-4329-4E74-86F9-39CF29345EEA";
const FORMAT_ID_BYTES = "ca2b65382943744e86f939cf29345eea";
const PROPERTY_ID = 2;
const GUID_BYTES = 16;
const KEY_BYTES = 20;
const VARIANT_BYTES = 24;
const VARIANT_VALUE_OFFSET = 8;
const VALUE = 0x8001;
const UINT_TYPE = 23;

describe("guidBytes", () => {
  it("stores the first three groups little-endian", () => {
    assert.equal(guidBytes(FORMAT_ID).toString("hex"), FORMAT_ID_BYTES);
  });

  it("accepts braces and refuses junk", () => {
    assert.equal(guidBytes(`{${FORMAT_ID}}`).toString("hex"), FORMAT_ID_BYTES);
    assert.throws(() => guidBytes("nope"), /Not a GUID/);
  });
});

describe("propertyKeyBytes", () => {
  it("is 20 bytes: the GUID then the property id", () => {
    const bytes = propertyKeyBytes({
      formatId: FORMAT_ID,
      propertyId: PROPERTY_ID
    });
    assert.equal(bytes.length, KEY_BYTES);
    assert.equal(bytes.subarray(0, GUID_BYTES).toString("hex"), FORMAT_ID_BYTES);
    assert.equal(bytes.readUInt32LE(GUID_BYTES), PROPERTY_ID);
  });
});

describe("numberVariantBytes", () => {
  it("is 24 bytes with the type at 0 and the value at 8", () => {
    const bytes = numberVariantBytes({
      type: VariantType.uint,
      value: VALUE
    });
    assert.equal(bytes.length, VARIANT_BYTES);
    assert.equal(bytes.readUInt16LE(0), UINT_TYPE);
    assert.equal(bytes.readUInt32LE(VARIANT_VALUE_OFFSET), VALUE);
    assert.deepEqual(readNumberVariant(bytes), {
      type: UINT_TYPE,
      value: VALUE
    });
  });
});
