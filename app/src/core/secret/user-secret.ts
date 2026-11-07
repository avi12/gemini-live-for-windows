import {
  argHandle,
  argNull,
  argPointer,
  argU32,
  bindFunction,
  toPointer,
  Win32Type,
  withMemory,
  zeroMemory
} from "@/win32/bind.ts";
import { DynComRawMemory } from "@microsoft/dynwinrt/com/unsafe/raw";

// DPAPI scoped to this Windows user: anything secret we keep on disk (the API key, the Google
// session) is sealed here, so only this account on this machine can read it back. The blobs are
// the ones .NET's ProtectedData.Protect(..., DataProtectionScope.CurrentUser) makes and reads.

const CRYPTPROTECT_UI_FORBIDDEN = 0x1;
const POINTER_BYTES = 8;
const BLOB_BYTES = 16;
const BLOB_POINTER_OFFSET = 8;
const BYTE_ALIGNMENT = 1;

export class DataProtectionError extends Error {
  readonly code: number;

  constructor({ operation, code }: {
    operation: string;
    code: number;
  }) {
    super(`${operation} failed with Windows error ${code}`);
    this.name = "DataProtectionError";
    this.code = code;
  }
}

export interface UserSecret {
  seal(options: {
    plain: Uint8Array;
    entropy?: Uint8Array;
  }): Uint8Array;
  unseal(options: {
    sealed: Uint8Array;
    entropy?: Uint8Array;
  }): Uint8Array;
}

function bindCrypt(entryPoint: string) {
  return bindFunction({
    library: "crypt32.dll",
    entryPoint,
    parameters: [
      Win32Type.pointer,
      Win32Type.pointer,
      Win32Type.pointer,
      Win32Type.pointer,
      Win32Type.pointer,
      Win32Type.u32,
      Win32Type.pointer
    ],
    returns: Win32Type.bool32,
    shouldCaptureLastError: true
  });
}

let bound: {
  protect: ReturnType<typeof bindCrypt>;
  unprotect: ReturnType<typeof bindCrypt>;
  localFree: ReturnType<typeof bindFunction>;
} | undefined;

function functions() {
  bound ??= {
    protect: bindCrypt("CryptProtectData"),
    unprotect: bindCrypt("CryptUnprotectData"),
    localFree: bindFunction({
      library: "kernel32.dll",
      entryPoint: "LocalFree",
      parameters: [Win32Type.handle],
      returns: Win32Type.handle
    })
  };
  return bound;
}

// A DATA_BLOB (u32 length, 4 bytes of padding, pointer) over a copy of the bytes, zeroed after
function withBlob<T>({ bytes, use }: {
  bytes: Uint8Array;
  use: (blob: DynComRawMemory) => T;
}) {
  return withMemory({
    size: Math.max(bytes.length, 1),
    alignment: BYTE_ALIGNMENT,
    use(data) {
      const copy = Buffer.from(bytes);
      try {
        data.writeBytes(0, copy);
        return withMemory({
          size: BLOB_BYTES,
          use(blob) {
            blob.writeU32(0, bytes.length);
            blob.writePointer(BLOB_POINTER_OFFSET, toPointer(data));
            return use(blob);
          }
        });
      } finally {
        copy.fill(0);
        zeroMemory(data);
      }
    }
  });
}

function withOptionalBlob<T>({ bytes, use }: {
  bytes: Uint8Array | undefined;
  use: (blob: DynComRawMemory | null) => T;
}) {
  if (!bytes) {
    return use(null);
  }

  return withBlob({
    bytes,
    use
  });
}

// Windows allocated the output with LocalAlloc: copy it out, zero it, free it
function takeOutput(out: DynComRawMemory) {
  const length = out.readU32(0);
  const address = out.readUsize(BLOB_POINTER_OFFSET);
  const view = DynComRawMemory.fromUnsafeAddress(address, Math.max(length, 1), BYTE_ALIGNMENT);
  const bytes = Buffer.from(view.readBytes(0, length));
  view.writeBytes(0, Buffer.alloc(length));
  functions().localFree([argHandle(address)]);
  return bytes;
}

function transform({ operation, call, input, entropy }: {
  operation: string;
  call: ReturnType<typeof bindCrypt>;
  input: Uint8Array;
  entropy: Uint8Array | undefined;
}) {
  return withBlob({
    bytes: input,
    use: inBlob => withOptionalBlob({
      bytes: entropy,
      use: entropyBlob => withMemory({
        size: BLOB_BYTES,
        alignment: POINTER_BYTES,
        use(out) {
          const result = call([
            argPointer(inBlob),
            argNull(),
            entropyBlob ? argPointer(entropyBlob) : argNull(),
            argNull(),
            argNull(),
            argU32(CRYPTPROTECT_UI_FORBIDDEN),
            argPointer(out)
          ]);
          const isFailure = result.number === 0;
          if (isFailure) {
            throw new DataProtectionError({
              operation,
              code: result.lastError ?? 0
            });
          }

          return takeOutput(out);
        }
      })
    })
  });
}

export const userSecret: UserSecret = {
  seal: ({ plain, entropy }) => transform({
    operation: "CryptProtectData",
    call: functions().protect,
    input: plain,
    entropy
  }),
  unseal: ({ sealed, entropy }) => transform({
    operation: "CryptUnprotectData",
    call: functions().unprotect,
    input: sealed,
    entropy
  })
};
