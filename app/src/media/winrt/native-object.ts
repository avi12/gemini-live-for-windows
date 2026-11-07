import { DynWinRtValue } from "@microsoft/dynwinrt";

// The WinRT object behind a generated binding class, which keeps it in a field the typings do not show
export function nativeOf(projected: object) {
  const hasNative = "_obj" in projected;
  const native = hasNative ? projected._obj : undefined;
  const isNative = native instanceof DynWinRtValue;
  return isNative ? native : undefined;
}
