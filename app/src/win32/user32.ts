import { argBool, argHandle, argI32, argI64, argPointer, argU32, bindFunction, Win32Type, withMemory } from "./bind.ts";

const DWORD_BYTES = 4;
const POINT_BYTES = 8;
const POINT_Y_OFFSET = 4;

const getForegroundWindowCall = bindFunction({
  library: "user32.dll",
  entryPoint: "GetForegroundWindow",
  parameters: [],
  returns: Win32Type.HANDLE
});

const getCursorPosCall = bindFunction({
  library: "user32.dll",
  entryPoint: "GetCursorPos",
  parameters: [Win32Type.POINTER],
  returns: Win32Type.BOOL32
});

const getWindowThreadProcessIdCall = bindFunction({
  library: "user32.dll",
  entryPoint: "GetWindowThreadProcessId",
  parameters: [Win32Type.HANDLE, Win32Type.POINTER],
  returns: Win32Type.U32
});

export function foregroundWindowHandle() {
  return getForegroundWindowCall([]).address;
}

/** The pointer in physical screen pixels, or undefined when Windows refuses to say. */
export function readCursorPosition() {
  return withMemory({
    size: POINT_BYTES,
    use(memory) {
      const isRead = getCursorPosCall([argPointer(memory)]).number !== 0;
      if (!isRead) {
        return undefined;
      }

      return {
        x: memory.readI32(0),
        y: memory.readI32(POINT_Y_OFFSET)
      };
    }
  });
}

export function processIdOfWindow(hwnd: bigint) {
  return withMemory({
    size: DWORD_BYTES,
    use(memory) {
      getWindowThreadProcessIdCall([argHandle(hwnd), argPointer(memory)]);
      return memory.readU32(0);
    }
  });
}

const setWindowRgnCall = bindFunction({
  library: "user32.dll",
  entryPoint: "SetWindowRgn",
  parameters: [Win32Type.HANDLE, Win32Type.HANDLE, Win32Type.BOOL32],
  returns: Win32Type.I32
});

const EXTENDED_STYLE_INDEX = -20;
const LAYERED_STYLE = 0x80000n;
const ALPHA_FLAG = 2;
const COLOR_KEY_FLAG = 1;

const getWindowLongPtrCall = bindFunction({
  library: "user32.dll",
  entryPoint: "GetWindowLongPtrW",
  parameters: [Win32Type.HANDLE, Win32Type.I32],
  returns: Win32Type.I64
});

const setWindowLongPtrCall = bindFunction({
  library: "user32.dll",
  entryPoint: "SetWindowLongPtrW",
  parameters: [Win32Type.HANDLE, Win32Type.I32, Win32Type.I64],
  returns: Win32Type.I64
});

const setLayeredWindowAttributesCall = bindFunction({
  library: "user32.dll",
  entryPoint: "SetLayeredWindowAttributes",
  parameters: [Win32Type.HANDLE, Win32Type.U32, Win32Type.U32, Win32Type.U32],
  returns: Win32Type.BOOL32
});

/**
 * How see-through the whole window is, 0 (invisible, but still painting) to 255 (as drawn). A window
 * kept at 0 while it is shown and laid out never shows the blank surface Windows gives a new window.
 */
export function setWindowOpacity({ hwnd, opacity }: { hwnd: bigint; opacity: number }) {
  makeLayered(hwnd);
  setLayeredWindowAttributesCall([argHandle(hwnd), argU32(0), argU32(opacity), argU32(ALPHA_FLAG)]);
}

/**
 * Makes every pixel of exactly `color` (0x00BBGGRR) in the window see-through. A window Windows draws
 * opaque white where it should be clear (its transparent backdrop failing) is made clear this way,
 * by keying out the white.
 */
export function setWindowColorKey({ hwnd, color }: { hwnd: bigint; color: number }) {
  makeLayered(hwnd);
  setLayeredWindowAttributesCall([argHandle(hwnd), argU32(color), argU32(0), argU32(COLOR_KEY_FLAG)]);
}

function makeLayered(hwnd: bigint) {
  const style = getWindowLongPtrCall([argHandle(hwnd), argI32(EXTENDED_STYLE_INDEX)]).bigint;
  setWindowLongPtrCall([argHandle(hwnd), argI32(EXTENDED_STYLE_INDEX), argI64(style | LAYERED_STYLE)]);
}

/** Clips the window to `region`, which Windows then owns; what is outside shows what is beneath and takes no clicks. */
export function setWindowRegion({ hwnd, region }: { hwnd: bigint; region: bigint }) {
  setWindowRgnCall([argHandle(hwnd), argHandle(region), argBool(true)]);
}
