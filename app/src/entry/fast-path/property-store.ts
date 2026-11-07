import {
  argHandle,
  argPointer,
  argU32,
  bindFunction,
  Win32Type
} from "@/win32/bind.ts";
import { WinGuid } from "@microsoft/dynwinrt";
import { DynComMethodSig, DynComUnsafe } from "@microsoft/dynwinrt/com/unsafe";
import { DynComRawMemory } from "@microsoft/dynwinrt/com/unsafe/raw";

// IPropertyStore (propsys.h) and the PROPVARIANT / PROPERTYKEY it passes have no WinRT form, so the
// store is declared by hand at its vtable slots: IUnknown has 0-2, then GetCount, GetAt, GetValue,
// SetValue, Commit.
const IID_PROPERTY_STORE_TEXT = "886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99";
const GET_VALUE_SLOT = 5;
const SET_VALUE_SLOT = 6;
const COMMIT_SLOT = 7;
const S_OK = 0;
const GUID_BYTES = 16;
const GUID_ALIGNMENT = 4;
const POINTER_BYTES = 8;
const PROPERTY_KEY_BYTES = 20;
const PROPERTY_KEY_PID_OFFSET = 16;
const PROPVARIANT_BYTES = 24;
const PROPVARIANT_VALUE_OFFSET = 8;
const HEX_RADIX = 16;
const GUID_FIRST_GROUP_END = 4;
const GUID_SECOND_GROUP_END = 6;
const GUID_THIRD_GROUP_END = 8;
const GUID_GROUP_ENDS = [GUID_FIRST_GROUP_END, GUID_SECOND_GROUP_END, GUID_THIRD_GROUP_END] as const;

/** The variant types a window property can hold here (wtypes.h VARENUM). */
export const VariantType = {
  empty: 0,
  uint32: 19,
  uint: 23
} as const;

export interface PropertyKey {
  formatId: string;
  propertyId: number;
}

/** A GUID as the 16 bytes Windows stores: the first three groups little-endian. */
export function guidBytes(guid: string) {
  const hex = guid.replaceAll(/[{}-]/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`Not a GUID: ${guid}`);
  }

  const bytes = Buffer.from(hex, "hex");
  let groupStart = 0;
  for (const groupEnd of GUID_GROUP_ENDS) {
    bytes.subarray(groupStart, groupEnd).reverse();
    groupStart = groupEnd;
  }
  return bytes;
}

/** A PROPERTYKEY: the format GUID, then the property id. */
export function propertyKeyBytes({ formatId, propertyId }: PropertyKey) {
  const bytes = Buffer.alloc(PROPERTY_KEY_BYTES);
  guidBytes(formatId).copy(bytes);
  bytes.writeUInt32LE(propertyId, PROPERTY_KEY_PID_OFFSET);
  return bytes;
}

/** A PROPVARIANT (24 bytes on x64) that holds one 32-bit unsigned number. */
export function numberVariantBytes({ type, value }: {
  type: typeof VariantType.uint | typeof VariantType.uint32;
  value: number;
}) {
  const bytes = Buffer.alloc(PROPVARIANT_BYTES);
  bytes.writeUInt16LE(type, 0);
  bytes.writeUInt32LE(value, PROPVARIANT_VALUE_OFFSET);
  return bytes;
}

/** What a PROPVARIANT read back from a store holds. */
export function readNumberVariant(bytes: Buffer) {
  return {
    type: bytes.readUInt16LE(0),
    value: bytes.readUInt32LE(PROPVARIANT_VALUE_OFFSET)
  };
}

// The window property store keeps values as text (VT_LPWSTR, 31) whatever type was written, so a
// read-back holds a pointer, not the number; PropVariantToUInt32WithDefault converts it back.
const NOT_A_NUMBER = 0xffffffff;
const toUint32WithDefault = bindFunction({
  library: "propsys.dll",
  entryPoint: "PropVariantToUInt32WithDefault",
  parameters: [Win32Type.pointer, Win32Type.u32],
  returns: Win32Type.u32
});

let methodsOfStore: ReturnType<typeof declareStoreMethods> | undefined;

function declareStoreMethods() {
  function pointer() {
    return DynComUnsafe.unclassifiedPointerType();
  }
  return DynComUnsafe.registerIUnknownInterface("IPropertyStore", WinGuid.parse(IID_PROPERTY_STORE_TEXT))
    .addMethodAt(GET_VALUE_SLOT, "GetValue", new DynComMethodSig().addIn(pointer()).addIn(pointer()))
    .addMethodAt(SET_VALUE_SLOT, "SetValue", new DynComMethodSig().addIn(pointer()).addIn(pointer()))
    .addMethodAt(COMMIT_SLOT, "Commit", new DynComMethodSig());
}

function storeMethods() {
  methodsOfStore ??= declareStoreMethods();
  return methodsOfStore;
}

let getStoreForWindow: ReturnType<typeof bindGetStoreForWindow> | undefined;

function bindGetStoreForWindow() {
  return bindFunction({
    library: "shell32.dll",
    entryPoint: "SHGetPropertyStoreForWindow",
    parameters: [Win32Type.handle, Win32Type.pointer, Win32Type.pointer],
    returns: Win32Type.i32
  });
}

function withBytes<T>({ bytes, use }: {
  bytes: Buffer;
  use: (memory: DynComRawMemory) => T;
}) {
  const memory = DynComRawMemory.allocate(bytes.length, POINTER_BYTES);
  try {
    memory.writeBytes(0, bytes);
    return use(memory);
  } finally {
    memory.release();
  }
}

/**
 * The property store of a window (SHGetPropertyStoreForWindow). Call on the thread that owns the window.
 * Release it when done.
 */
export function openWindowPropertyStore(hwnd: bigint) {
  getStoreForWindow ??= bindGetStoreForWindow();
  const iid = WinGuid.parse(IID_PROPERTY_STORE_TEXT);
  const iidMemory = DynComRawMemory.allocate(GUID_BYTES, GUID_ALIGNMENT);
  const outMemory = DynComRawMemory.allocate(POINTER_BYTES, POINTER_BYTES);
  try {
    iidMemory.writeBytes(0, guidBytes(IID_PROPERTY_STORE_TEXT));
    const result = getStoreForWindow([argHandle(hwnd), argPointer(iidMemory), argPointer(outMemory)]).number;
    const isFailed = result !== S_OK;
    if (isFailed) {
      throw new Error(`SHGetPropertyStoreForWindow failed: 0x${(result >>> 0).toString(HEX_RADIX)}`);
    }

    return storeHandle(DynComUnsafe.adoptOwnedComPointer(outMemory.readU64(0), iid));
  } finally {
    iidMemory.release();
    outMemory.release();
  }
}

function storeHandle(store: ReturnType<typeof DynComUnsafe.adoptOwnedComPointer>) {
  const methods = storeMethods();

  return {
    setNumber({ key, type, value }: {
      key: PropertyKey;
      type: typeof VariantType.uint | typeof VariantType.uint32;
      value: number;
    }) {
      withBytes({
        bytes: propertyKeyBytes(key),
        use: keyMemory => withBytes({
          bytes: numberVariantBytes({
            type,
            value
          }),
          use(variantMemory) {
            methods.method(SET_VALUE_SLOT).invoke(store, [
              DynComUnsafe.pointer(keyMemory.pointer().address),
              DynComUnsafe.pointer(variantMemory.pointer().address)
            ]);
          }
        })
      });
      methods.method(COMMIT_SLOT).invoke(store, []);
    },
    read(key: PropertyKey) {
      return withBytes({
        bytes: propertyKeyBytes(key),
        use: keyMemory => withBytes({
          bytes: Buffer.alloc(PROPVARIANT_BYTES),
          use(variantMemory) {
            methods.method(GET_VALUE_SLOT).invoke(store, [
              DynComUnsafe.pointer(keyMemory.pointer().address),
              DynComUnsafe.pointer(variantMemory.pointer().address)
            ]);
            const raw = readNumberVariant(variantMemory.readBytes(0, PROPVARIANT_BYTES));
            const number = toUint32WithDefault([argPointer(variantMemory), argU32(NOT_A_NUMBER)]).number >>> 0;
            return {
              type: raw.type,
              number
            };
          }
        })
      });
    },
    release() {
      store.release();
    }
  };
}
