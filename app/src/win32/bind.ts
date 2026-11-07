import { DynComRawMemory } from "@microsoft/dynwinrt/com/unsafe/raw";
import { DynWin32, DynWin32Unsafe } from "@microsoft/dynwinrt/win32/unsafe";
import type { DynWin32Value } from "@microsoft/dynwinrt/win32/unsafe";

/**
 * The one seam over dynwinrt's Win32 binding. Every flat Win32 call of the app (user32, kernel32, gdi32,
 * advapi32, shell32, ...) goes through here; nothing else imports `@microsoft/dynwinrt/win32/unsafe`.
 * Importing this file does no work: a function binds when `bindFunction` is called, so bind at module
 * scope in the file that uses it (one `const getTickCount = bindFunction({...})`).
 *
 * Bind a function, then call it with typed arguments:
 *
 *   const getDpiForWindow = bindFunction({
 *     library: "user32.dll",
 *     entryPoint: "GetDpiForWindow",
 *     parameters: [Win32Type.handle],
 *     returns: Win32Type.u32
 *   });
 *   const dpi = getDpiForWindow([argHandle(hwnd)]).number;
 *
 * - `Win32Type`: the closed set of parameter and return types: `handle` (HWND, HDC, HANDLE...), `pointer`,
 *   `i32`, `u32`, `i64`, `u64`, `bool32` (BOOL), `void`. Use `i64`/`u64`/`pointer` for LPARAM, WPARAM and
 *   LONG_PTR; BOOL parameters are `bool32`, never `i32`.
 * - Argument builders (one per type): `argI32`, `argU32`, `argI64`, `argU64`, `argBool`, `argHandle`
 *   (bigint address, null allowed), `argPointer(memory | null)`, `argAddress(bigint)`, `argWideString(text)`
 *   (a null-terminated UTF-16 `LPCWSTR`, valid for the call), `argNull()`.
 * - The result of a call is `Win32Result`: `.number` (i32/u32/bool32 returns), `.bigint` (i64/u64),
 *   `.address` (pointer/handle returns, 0n for null), `.isSuccess`, `.lastError` (only when bound with
 *   `shouldCaptureLastError: true`, null otherwise).
 * - Memory for structs and out buffers: `withMemory({ size, use })` allocates zeroed memory, hands it to
 *   `use` and always releases it. Read and write fields with the `DynComRawMemory` accessors
 *   (`readI32(offset)`, `writeU32(offset, value)`, `readPointer`, `readBytes`, `writeBytes`...); struct
 *   offsets are yours to compute from the Win32 header (mind the padding on x64). `zeroMemory(memory)`
 *   clears it. `wideMemory(text)` is a null-terminated UTF-16 buffer you release yourself;
 *   `readWideString({ memory, offset, maxChars })` decodes a null-terminated UTF-16 string out of memory.
 * - `toPointer(memory)` is the pointer value of memory for a struct field (`writePointer`);
 *   `memoryAddress(memory)` is its numeric address.
 * - Window handles are `bigint` everywhere in the app (an HWND as a bigint address).
 * - The app runs per-monitor DPI v2: coordinates from user32 are physical pixels.
 */

export const Win32Type = {
  handle: "handle",
  pointer: "pointer",
  i32: "i32",
  u32: "u32",
  i64: "i64",
  u64: "u64",
  bool32: "bool32",
  void: "void"
} as const;

export type Win32Type = (typeof Win32Type)[keyof typeof Win32Type];

export type Win32Argument = DynWin32Value;

export interface Win32Result {
  number: number;
  bigint: bigint;
  address: bigint;
  isSuccess: boolean;
  lastError: number | null;
}

const WIDE_CHAR_BYTES = 2;
const POINTER_ALIGNMENT = 8;
const NO_ADDRESS = 0n;
const NO_NUMBER = 0;
const NULLABLE_TYPES: readonly Win32Type[] = [Win32Type.pointer, Win32Type.handle];
const NUMBER_TYPES: readonly Win32Type[] = [Win32Type.i32, Win32Type.u32, Win32Type.bool32];
const BIGINT_TYPES: readonly Win32Type[] = [Win32Type.i64, Win32Type.u64];
const ADDRESS_TYPES: readonly Win32Type[] = [Win32Type.pointer, Win32Type.handle];

function toNumber({ value, type }: {
  value: DynWin32Value | null;
  type: Win32Type;
}) {
  const isAbsent = value === null || !NUMBER_TYPES.includes(type);
  if (isAbsent) {
    return NO_NUMBER;
  }

  return DynWin32.toNumber(value);
}

function toBigint({ value, type }: {
  value: DynWin32Value | null;
  type: Win32Type;
}) {
  const isAbsent = value === null || !BIGINT_TYPES.includes(type);
  if (isAbsent) {
    return NO_ADDRESS;
  }

  return DynWin32.toBigint(value);
}

function toAddress({ value, type }: {
  value: DynWin32Value | null;
  type: Win32Type;
}) {
  const isAbsent = value === null || !ADDRESS_TYPES.includes(type);
  if (isAbsent) {
    return NO_ADDRESS;
  }

  const isHandle = type === Win32Type.handle;
  if (!isHandle) {
    return DynWin32Unsafe.pointerAddress(value);
  }

  const handle = DynWin32.toResourceOrHandle(value);
  return typeof handle === "bigint" ? handle : NO_ADDRESS;
}

export function bindFunction({
  library,
  entryPoint,
  parameters,
  returns,
  shouldCaptureLastError = false
}: {
  library: string;
  entryPoint: string;
  parameters: readonly Win32Type[];
  returns: Win32Type;
  shouldCaptureLastError?: boolean;
}) {
  const bound = DynWin32Unsafe.bind({
    dll: library,
    entryPoint,
    parameters: parameters.map(type => ({
      type,
      direction: "in",
      nullable: NULLABLE_TYPES.includes(type)
    })),
    returnType: returns,
    captureLastError: shouldCaptureLastError
  });

  return function call(args: readonly Win32Argument[]) {
    const result = bound.invoke([...args]);
    // `returnValue` hands its value over once; a second read is null
    const value = result.returnValue;
    return {
      number: toNumber({
        value,
        type: returns
      }),
      bigint: toBigint({
        value,
        type: returns
      }),
      address: toAddress({
        value,
        type: returns
      }),
      isSuccess: result.succeeded,
      lastError: result.lastError
    };
  };
}

export function argI32(value: number) {
  return DynWin32.i32(value);
}

export function argU32(value: number) {
  return DynWin32.u32(value);
}

export function argI64(value: bigint) {
  return DynWin32.i64(value);
}

export function argU64(value: bigint) {
  return DynWin32.u64(value);
}

export function argBool(isTrue: boolean) {
  return DynWin32.bool32(isTrue);
}

export function argHandle(value: bigint | null) {
  return DynWin32.handle(value, true);
}

export function argAddress(value: bigint) {
  return DynWin32Unsafe.pointer(value);
}

export function argPointer(memory: DynComRawMemory | null) {
  return DynWin32Unsafe.pointer(memory === null ? null : memory.pointer().address);
}

export function argNull() {
  return DynWin32Unsafe.pointer(null);
}

export function argWideString(text: string) {
  return DynWin32.wideString(text);
}

export function toPointer(memory: DynComRawMemory) {
  return memory.pointer();
}

export function memoryAddress(memory: DynComRawMemory) {
  return memory.pointer().address;
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

export function readWideString({ memory, offset = 0, maxChars }: {
  memory: DynComRawMemory;
  offset?: number;
  maxChars: number;
}) {
  const available = Math.floor((Number(memory.size) - offset) / WIDE_CHAR_BYTES);
  const text = memory.readBytes(offset, Math.min(maxChars, available) * WIDE_CHAR_BYTES).toString("utf16le");
  const end = text.indexOf("\0");
  return end === -1 ? text : text.slice(0, end);
}

export function withMemory<T>({ size, alignment = POINTER_ALIGNMENT, use }: {
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
