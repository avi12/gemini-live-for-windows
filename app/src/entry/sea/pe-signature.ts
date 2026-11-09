import { optionalHeaderOffsetOf } from "./pe-subsystem.ts";

const OPTIONAL_HEADER_PE32_PLUS_MAGIC = 0x20b;
const DATA_DIRECTORIES_OFFSET_PE32 = 96;
const DATA_DIRECTORIES_OFFSET_PE32_PLUS = 112;
const SECURITY_DIRECTORY_INDEX = 4;
const DIRECTORY_ENTRY_BYTES = 8;
const DIRECTORY_SIZE_OFFSET = 4;

// postject rewrites node.exe, which leaves Node's Authenticode signature pointing at bytes that no
// longer match, and signtool refuses an MSIX that holds such an exe. The package is signed as a whole,
// so the exe is better unsigned than corrupt: this drops the certificate table and the bytes it covers.
export function stripSignature(image: Buffer) {
  const optionalHeader = optionalHeaderOffsetOf(image);
  const isPe32Plus = image.readUInt16LE(optionalHeader) === OPTIONAL_HEADER_PE32_PLUS_MAGIC;
  const directories = optionalHeader + (isPe32Plus ? DATA_DIRECTORIES_OFFSET_PE32_PLUS : DATA_DIRECTORIES_OFFSET_PE32);
  const entry = directories + SECURITY_DIRECTORY_INDEX * DIRECTORY_ENTRY_BYTES;
  const offset = image.readUInt32LE(entry);
  const size = image.readUInt32LE(entry + DIRECTORY_SIZE_OFFSET);
  const isUnsigned = offset === 0 || size === 0;
  if (isUnsigned) {
    return image;
  }

  image.writeUInt32LE(0, entry);
  image.writeUInt32LE(0, entry + DIRECTORY_SIZE_OFFSET);
  const isTrailing = offset + size === image.length;
  return isTrailing ? image.subarray(0, offset) : image;
}
