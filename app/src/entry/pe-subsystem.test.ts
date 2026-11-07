import { PeSubsystem, readSubsystem, setSubsystem } from "./pe-subsystem.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const PE_OFFSET = 0x80;
const PE_SIGNATURE_BYTES = 4;
const COFF_HEADER_BYTES = 20;
const SUBSYSTEM_IN_OPTIONAL_HEADER = 68;
const IMAGE_BYTES = 0x200;
const DOS_MAGIC = 0x5a4d;
const PE_OFFSET_POSITION = 0x3c;
const PE_MAGIC = 0x00004550;
const REPEATS = 8;
const OPTIONAL_HEADER_START = PE_OFFSET + PE_SIGNATURE_BYTES + COFF_HEADER_BYTES;
const SUBSYSTEM_POSITION = OPTIONAL_HEADER_START + SUBSYSTEM_IN_OPTIONAL_HEADER;

function fakeImage(subsystem: number) {
  const image = Buffer.alloc(IMAGE_BYTES);
  image.writeUInt16LE(DOS_MAGIC, 0);
  image.writeUInt32LE(PE_OFFSET, PE_OFFSET_POSITION);
  image.writeUInt32LE(PE_MAGIC, PE_OFFSET);
  image.writeUInt16LE(subsystem, SUBSYSTEM_POSITION);
  return image;
}

describe("pe subsystem", () => {
  it("reads the console subsystem of a node-like header", () => {
    assert.equal(readSubsystem(fakeImage(PeSubsystem.windowsConsole)), PeSubsystem.windowsConsole);
  });

  it("flips console to GUI and touches nothing else", () => {
    const image = fakeImage(PeSubsystem.windowsConsole);
    const expected = Buffer.from(image);
    setSubsystem({
      image,
      subsystem: PeSubsystem.windowsGui
    });
    expected.writeUInt16LE(PeSubsystem.windowsGui, SUBSYSTEM_POSITION);
    assert.deepEqual(image, expected);
  });

  it("refuses a file that is not a PE", () => {
    assert.throws(() => readSubsystem(Buffer.from("hello world, this is text".repeat(REPEATS))), /MZ/);
  });

  it("refuses an MZ file without a PE signature", () => {
    const image = fakeImage(PeSubsystem.windowsConsole);
    image.writeUInt32LE(0, PE_OFFSET);
    assert.throws(() => setSubsystem({
      image,
      subsystem: PeSubsystem.windowsGui
    }), /PE signature/);
  });
});
