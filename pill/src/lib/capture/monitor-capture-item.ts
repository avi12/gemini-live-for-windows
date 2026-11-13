import { DynWinRtValue, WinGuid } from "@microsoft/dynwinrt";
import type { DynWinRtValue as WinRtValue } from "@microsoft/dynwinrt";
import { DynCom, DynComMethodSig, DynComUnsafe } from "@microsoft/dynwinrt/com/unsafe";
import { DynComRawMemory, DynComRawOwnedComPointer } from "@microsoft/dynwinrt/com/unsafe/raw";
import { DynWin32, DynWin32Unsafe } from "@microsoft/dynwinrt/win32/unsafe";
import { GraphicsCaptureItem } from "winui-svelte/bindings/windows/graphics/capture/GraphicsCaptureItem";

const ITEM_CLASS = "Windows.Graphics.Capture.GraphicsCaptureItem";
const INTEROP_IID = WinGuid.parse("3628e81b-3cac-4c60-b7f4-23ce0e0c3356");
const ITEM_IID = WinGuid.parse("79c3f95b-31f7-4ec2-a464-632ef5d30760");
const CREATE_FOR_MONITOR_METHOD = 4;
const POINTER_BYTES = 8;
const MONITOR_DEFAULT_TO_NEAREST = 2;
const LOW_WORD_MASK = 0xffffffffn;
const WORD_BITS = 32n;
const POINT_BITS = 64;
const NO_MONITOR = 0n;
const NATIVE_WRAPPER = "_fromNative";
export interface ScreenPoint {
  x: number;
  y: number;
}

const monitorFromPoint = DynWin32Unsafe.bind({
  dll: "user32.dll",
  entryPoint: "MonitorFromPoint",
  parameters: [
    {
      type: "i64",
      direction: "in",
      nullable: false
    },
    {
      type: "u32",
      direction: "in",
      nullable: false
    }
  ],
  returnType: "handle",
  captureLastError: false
});

function itemOfNative(value: WinRtValue) {
  const create: unknown = Object.getOwnPropertyDescriptor(GraphicsCaptureItem, NATIVE_WRAPPER)?.value;
  const isWrapperMissing = typeof create !== "function";
  if (isWrapperMissing) {
    throw new TypeError("the capture item binding cannot wrap a native object");
  }

  const item: unknown = create.call(GraphicsCaptureItem, value);
  const isCaptureItem = item instanceof GraphicsCaptureItem;
  if (!isCaptureItem) {
    throw new TypeError("the capture item binding returned something else");
  }

  return item;
}

export function monitorAt({ x, y }: ScreenPoint) {
  const packed = BigInt.asIntN(POINT_BITS, (BigInt(y) << WORD_BITS) | (BigInt(x) & LOW_WORD_MASK));
  const result = monitorFromPoint.invoke([DynWin32.i64(packed), DynWin32.u32(MONITOR_DEFAULT_TO_NEAREST)]);
  const returned = result.returnValue;
  const handle = returned === null ? null : DynWin32.toResourceOrHandle(returned);
  const isFound = typeof handle === "bigint" && handle !== NO_MONITOR;
  return isFound ? handle : undefined;
}

function createForMonitor({
  factory,
  monitor,
  output
}: {
  factory: WinRtValue;
  monitor: bigint;
  output: DynComRawMemory;
}) {
  const interop = DynCom.registerIUnknownInterface("IGraphicsCaptureItemInterop", INTEROP_IID).addMethodAt(
    CREATE_FOR_MONITOR_METHOD,
    "CreateForMonitor",
    new DynComMethodSig().addIn(DynCom.u64Type()).addIn(DynCom.guidType()).addIn(DynCom.pointerType())
  );
  interop
    .method(CREATE_FOR_MONITOR_METHOD)
    .invoke(factory, [
      DynWinRtValue.u64(monitor),
      DynWinRtValue.guid(ITEM_IID),
      DynComUnsafe.pointer(output.pointer().address)
    ]);
}

export function captureItemOfMonitor(monitor: bigint) {
  const owned = DynComRawOwnedComPointer.queryInterface(DynWinRtValue.activationFactory(ITEM_CLASS), INTEROP_IID);
  const output = DynComRawMemory.allocate(POINTER_BYTES, POINTER_BYTES);
  try {
    createForMonitor({
      factory: DynComUnsafe.borrowComPointer(owned.address, INTEROP_IID),
      monitor,
      output
    });
    return itemOfNative(DynComUnsafe.adoptOwnedComPointer(output.readU64(0), ITEM_IID));
  } finally {
    output.release();
    owned.release();
  }
}
