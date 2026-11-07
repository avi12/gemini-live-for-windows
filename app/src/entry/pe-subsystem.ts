const DOS_MAGIC = 0x5a4d;
const PE_MAGIC = 0x00004550;
const PE_OFFSET_POSITION = 0x3c;
const COFF_HEADER_BYTES = 20;
const PE_SIGNATURE_BYTES = 4;
const PE_OFFSET_FIELD_BYTES = 4;
const SUBSYSTEM_FIELD_BYTES = 2;
// The Subsystem field sits 68 bytes into the optional header in both PE32 and PE32+.
const SUBSYSTEM_OFFSET_IN_OPTIONAL_HEADER = 68;

export const PeSubsystem = {
  windowsGui: 2,
  windowsConsole: 3
} as const;
export type PeSubsystem = typeof PeSubsystem[keyof typeof PeSubsystem];

function subsystemOffsetOf(image: Buffer) {
  const isTooShort = image.length < PE_OFFSET_POSITION + PE_OFFSET_FIELD_BYTES;
  const isInvalidDos = isTooShort || image.readUInt16LE(0) !== DOS_MAGIC;
  if (isInvalidDos) {
    throw new Error("Not a PE file: no MZ header");
  }

  const peOffset = image.readUInt32LE(PE_OFFSET_POSITION);
  const offset = peOffset + PE_SIGNATURE_BYTES + COFF_HEADER_BYTES + SUBSYSTEM_OFFSET_IN_OPTIONAL_HEADER;
  const isInvalidPe = offset + SUBSYSTEM_FIELD_BYTES > image.length || image.readUInt32LE(peOffset) !== PE_MAGIC;
  if (isInvalidPe) {
    throw new Error("Not a PE file: no PE signature");
  }

  return offset;
}

export function readSubsystem(image: Buffer) {
  return image.readUInt16LE(subsystemOffsetOf(image));
}

// Node's exe has the console subsystem, which flashes a console window on a Start menu or
// protocol launch. The GUI subsystem keeps stdin and stdout pipes working.
export function setSubsystem({ image, subsystem }: {
  image: Buffer;
  subsystem: PeSubsystem;
}) {
  image.writeUInt16LE(subsystem, subsystemOffsetOf(image));
}
