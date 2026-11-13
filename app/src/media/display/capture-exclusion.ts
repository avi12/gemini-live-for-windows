import { argHandle, argU32, bindFunction, Win32Type } from "@/win32/bind.ts";

const WDA_NONE = 0x0;
const WDA_EXCLUDEFROMCAPTURE = 0x11;

const setWindowDisplayAffinity = bindFunction({
  library: "user32.dll",
  entryPoint: "SetWindowDisplayAffinity",
  parameters: [Win32Type.HANDLE, Win32Type.U32],
  returns: Win32Type.BOOL32
});

// The window is blank in every screen capture (GDI and Graphics Capture alike) while still showing
// on the screen: how the pill and the overlays stay out of the frames Gemini sees. Returns whether
// Windows accepted it; only a window of this process can be changed.
export function excludeFromCapture({ hwnd, isExcluded = true }: { hwnd: bigint; isExcluded?: boolean }) {
  const affinity = isExcluded ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;
  return setWindowDisplayAffinity([argHandle(hwnd), argU32(affinity)]).number !== 0;
}
