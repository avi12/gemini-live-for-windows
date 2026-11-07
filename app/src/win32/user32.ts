import {
  argHandle,
  argNull,
  argPointer,
  bindFunction,
  Win32Type,
  withMemory
} from "./bind.ts";

const DWORD_BYTES = 4;
const POINT_BYTES = 8;
const POINT_Y_OFFSET = 4;

const getForegroundWindowCall = bindFunction({
  library: "user32.dll",
  entryPoint: "GetForegroundWindow",
  parameters: [],
  returns: Win32Type.handle
});

const getCursorPosCall = bindFunction({
  library: "user32.dll",
  entryPoint: "GetCursorPos",
  parameters: [Win32Type.pointer],
  returns: Win32Type.bool32
});

const getWindowThreadProcessIdCall = bindFunction({
  library: "user32.dll",
  entryPoint: "GetWindowThreadProcessId",
  parameters: [Win32Type.handle, Win32Type.pointer],
  returns: Win32Type.u32
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

export function threadIdOfWindow(hwnd: bigint) {
  return getWindowThreadProcessIdCall([argHandle(hwnd), argNull()]).number;
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
