import { stripSignature } from "./pe-signature.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const PE_OFFSET = 0x80;
const PE_SIGNATURE_BYTES = 4;
const COFF_HEADER_BYTES = 20;
const OPTIONAL_HEADER_START = PE_OFFSET + PE_SIGNATURE_BYTES + COFF_HEADER_BYTES;
const DATA_DIRECTORIES_OFFSET = 112;
const SECURITY_DIRECTORY_INDEX = 4;
const DIRECTORY_ENTRY_BYTES = 8;
const SIZE_OFFSET = 4;
const SECURITY_ENTRY = OPTIONAL_HEADER_START
  + DATA_DIRECTORIES_OFFSET
  + SECURITY_DIRECTORY_INDEX * DIRECTORY_ENTRY_BYTES;
const SECURITY_SIZE = SECURITY_ENTRY + SIZE_OFFSET;
const CODE_BYTES = 0x200;
const CERTIFICATE_BYTES = 0x40;
const DOS_MAGIC = 0x5a4d;
const PE_OFFSET_POSITION = 0x3c;
const PE_MAGIC = 0x00004550;
const PE32_PLUS_MAGIC = 0x20b;

function signedImage() {
  const image = Buffer.alloc(CODE_BYTES + CERTIFICATE_BYTES);
  image.writeUInt16LE(DOS_MAGIC, 0);
  image.writeUInt32LE(PE_OFFSET, PE_OFFSET_POSITION);
  image.writeUInt32LE(PE_MAGIC, PE_OFFSET);
  image.writeUInt16LE(PE32_PLUS_MAGIC, OPTIONAL_HEADER_START);
  image.writeUInt32LE(CODE_BYTES, SECURITY_ENTRY);
  image.writeUInt32LE(CERTIFICATE_BYTES, SECURITY_SIZE);
  return image;
}

describe("pe signature", () => {
  it("drops the certificate table and the bytes it covers", () => {
    const stripped = stripSignature(signedImage());
    assert.equal(stripped.length, CODE_BYTES);
    assert.equal(stripped.readUInt32LE(SECURITY_ENTRY), 0);
    assert.equal(stripped.readUInt32LE(SECURITY_SIZE), 0);
  });

  it("leaves an unsigned image as it is", () => {
    const image = signedImage();
    image.writeUInt32LE(0, SECURITY_ENTRY);
    const stripped = stripSignature(image);
    assert.equal(stripped.length, CODE_BYTES + CERTIFICATE_BYTES);
  });
});
