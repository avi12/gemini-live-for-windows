import { DynComRawMemory } from "@microsoft/dynwinrt/com/unsafe/raw";

/**
 * Native memory for Win32 structs and out buffers, the counterpart of the calls bound in `bind.ts`.
 *
 * - `withMemory({ size, use })` allocates zeroed memory, hands it to `use` and always releases it. Read and
 *   write fields with the `DynComRawMemory` accessors (`readI32(offset)`, `writeU32(offset, value)`,
 *   `readPointer`, `readBytes`, `writeBytes`...); struct offsets are yours to compute from the Win32 header
 *   (mind the padding on x64). `zeroMemory(memory)` clears it.
 * - `wideMemory(text)` is a null-terminated UTF-16 buffer you release yourself;
 *   `readWideString({ memory, offset, maxChars })` decodes a null-terminated UTF-16 string out of memory.
 * - `toPointer(memory)` is the pointer value of memory for a struct field (`writePointer`).
 */

const WIDE_CHAR_BYTES = 2;
const POINTER_ALIGNMENT = 8;

export function toPointer(memory: DynComRawMemory) {
  return memory.pointer();
}

export function zeroMemory(memory: DynComRawMemory) {
  memory.writeBytes(0, Buffer.alloc(Number(memory.size)));
}

export function wideMemory(text: string) {
  const bytes = Buffer.from(`${text}\0`, "utf16le");
  const memory = DynComRawMemory.allocate(bytes.length, WIDE_CHAR_BYTES);
  memory.writeBytes(0, bytes);
  return memory;
}

export function readWideString({
  memory,
  offset = 0,
  maxChars
}: {
  memory: DynComRawMemory;
  offset?: number;
  maxChars: number;
}) {
  const available = Math.floor((Number(memory.size) - offset) / WIDE_CHAR_BYTES);
  const text = memory.readBytes(offset, Math.min(maxChars, available) * WIDE_CHAR_BYTES).toString("utf16le");
  const end = text.indexOf("\0");
  return end === -1 ? text : text.slice(0, end);
}

export function withMemory<T>({
  size,
  alignment = POINTER_ALIGNMENT,
  use
}: {
  size: number;
  alignment?: number;
  use: (memory: DynComRawMemory) => T;
}) {
  const memory = DynComRawMemory.allocate(size, alignment);
  try {
    zeroMemory(memory);
    return use(memory);
  } finally {
    memory.release();
  }
}
