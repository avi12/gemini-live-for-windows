import type { CursorApi, ForegroundApi } from "@/overlays/ports.ts";
import {
  argBool,
  argHandle,
  argI32,
  argPointer,
  argU32,
  bindFunction,
  readWideString,
  Win32Type,
  withMemory
} from "@/win32/bind.ts";
import { foregroundWindowHandle, processIdOfWindow, readCursorPosition, threadIdOfWindow } from "@/win32/user32.ts";

const ORIGIN = {
  x: 0,
  y: 0
};

const CLASS_NAME_CHARS = 64;
const WIDE_CHAR_BYTES = 2;

const isWindow = bindFunction({
  library: "user32.dll",
  entryPoint: "IsWindow",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.BOOL32
});

const getClassName = bindFunction({
  library: "user32.dll",
  entryPoint: "GetClassNameW",
  parameters: [Win32Type.HANDLE, Win32Type.POINTER, Win32Type.I32],
  returns: Win32Type.I32
});

const getCurrentThreadId = bindFunction({
  library: "kernel32.dll",
  entryPoint: "GetCurrentThreadId",
  parameters: [],
  returns: Win32Type.U32
});

const attachThreadInput = bindFunction({
  library: "user32.dll",
  entryPoint: "AttachThreadInput",
  parameters: [Win32Type.U32, Win32Type.U32, Win32Type.BOOL32],
  returns: Win32Type.BOOL32
});

const bringWindowToTop = bindFunction({
  library: "user32.dll",
  entryPoint: "BringWindowToTop",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.BOOL32
});

const setForegroundWindow = bindFunction({
  library: "user32.dll",
  entryPoint: "SetForegroundWindow",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.BOOL32
});

export function createForegroundApi() {
  return {
    foregroundWindow: foregroundWindowHandle,
    isWindow: hwnd => isWindow([argHandle(hwnd)]).number !== 0,
    classNameOf: hwnd =>
      withMemory({
        size: CLASS_NAME_CHARS * WIDE_CHAR_BYTES,
        use(memory) {
          getClassName([argHandle(hwnd), argPointer(memory), argI32(CLASS_NAME_CHARS)]);
          return readWideString({
            memory,
            maxChars: CLASS_NAME_CHARS
          });
        }
      }),
    processIdOf: processIdOfWindow,
    threadIdOf: threadIdOfWindow,
    currentThreadId: () => getCurrentThreadId([]).number,
    attachThreadInput: ({ ours, theirs, isAttached }) =>
      attachThreadInput([argU32(ours), argU32(theirs), argBool(isAttached)]).number !== 0,
    bringWindowToTop(hwnd) {
      bringWindowToTop([argHandle(hwnd)]);
    },
    setForegroundWindow(hwnd) {
      setForegroundWindow([argHandle(hwnd)]);
    }
  } satisfies ForegroundApi;
}

export function createCursorApi() {
  return {
    cursorPosition: () => readCursorPosition() ?? ORIGIN
  } satisfies CursorApi;
}
