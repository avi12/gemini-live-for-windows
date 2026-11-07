import { nativeOf } from "./native-object.ts";
import { DynComMethodSig, DynComUnsafe, WinGuid } from "@microsoft/dynwinrt/com/unsafe";
import { DynComRawMemory, DynComRawOwnedComPointer } from "@microsoft/dynwinrt/com/unsafe/raw";
import { IClosable } from "winui-svelte/bindings/windows/foundation/IClosable";
import type { IMemoryBufferReference } from "winui-svelte/bindings/windows/foundation/IMemoryBufferReference";

const MEMORY_BUFFER_BYTE_ACCESS = WinGuid.parse("5b0d3235-4dba-4d44-865e-8f1d0e4fd04d");
// IUnknown has three methods, so IMemoryBufferByteAccess.GetBuffer is slot 3
const GET_BUFFER_SLOT = 3;
const POINTER_BYTES = 8;
const CAPACITY_BYTES = 4;
const BYTE_ALIGNMENT = 1;

// Both AudioBuffer (an AudioFrame's samples) and BitmapBuffer (a SoftwareBitmap's pixels) are this
export interface MemoryBuffer {
  createReference(): IMemoryBufferReference;
  close(): void;
}

export interface BufferBytes {
  memory: DynComRawMemory;
  address: bigint;
  capacity: number;
}

function createGetBufferSlot() {
  return DynComUnsafe.registerIUnknownInterface("IMemoryBufferByteAccess", MEMORY_BUFFER_BYTE_ACCESS)
    .addMethodAt(
      GET_BUFFER_SLOT, "GetBuffer", new DynComMethodSig()
        .addIn(DynComUnsafe.unclassifiedPointerType())
        .addIn(DynComUnsafe.unclassifiedPointerType())
    )
    .method(GET_BUFFER_SLOT);
}

let getBufferSlot: ReturnType<typeof createGetBufferSlot> | undefined;

function byteAccessSlot() {
  getBufferSlot ??= createGetBufferSlot();
  return getBufferSlot;
}

function referenceNativeOf(reference: IMemoryBufferReference) {
  const native = nativeOf(reference);
  const isMissing = native === undefined;
  if (isMissing) {
    throw new TypeError("the memory buffer reference is not a WinRT object");
  }

  return native;
}

// A frame or bitmap stays exclusively locked until the byte access, the reference and the buffer are
// all released, and a locked AudioFrame refuses addFrame (0x80070005): so one helper owns the whole
// release chain, the way the C# `using` blocks did.
export function withBufferBytes<T>({ buffer, use }: {
  buffer: MemoryBuffer;
  use: (bytes: BufferBytes) => T;
}) {
  const reference = buffer.createReference();
  const native = referenceNativeOf(reference);
  const managed = DynComRawOwnedComPointer.queryInterface(native, MEMORY_BUFFER_BYTE_ACCESS)
    .intoManaged(MEMORY_BUFFER_BYTE_ACCESS);
  const pointerResult = DynComRawMemory.allocate(POINTER_BYTES, POINTER_BYTES);
  const capacityResult = DynComRawMemory.allocate(CAPACITY_BYTES, CAPACITY_BYTES);
  try {
    byteAccessSlot().invoke(managed, [
      DynComUnsafe.pointer(pointerResult.pointer().address),
      DynComUnsafe.pointer(capacityResult.pointer().address)
    ]);
    const address = pointerResult.readU64(0);
    const capacity = capacityResult.readU32(0);
    return use({
      memory: DynComRawMemory.fromUnsafeAddress(address, capacity, BYTE_ALIGNMENT),
      address,
      capacity
    });
  } finally {
    pointerResult.release();
    capacityResult.release();
    managed.release();
    IClosable.from(native).close();
    buffer.close();
  }
}
