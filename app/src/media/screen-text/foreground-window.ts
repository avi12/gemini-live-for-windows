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
import { foregroundWindowHandle, processIdOfWindow } from "@/win32/user32.ts";

const TITLE_CHARS = 1024;
const IMAGE_PATH_CHARS = 1024;
const WIDE_CHAR_BYTES = 2;
const DWORD_BYTES = 4;
const RECT_BYTES = 16;
const RECT_RIGHT_OFFSET = 8;
const RECT_BOTTOM_OFFSET = 12;
const NO_HANDLE = 0n;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const NO_FLAGS = 0;
const EXECUTABLE_SUFFIX = /\.exe$/i;
const PATH_SEPARATOR = /[\\/]/;

const getWindowText = bindFunction({
  library: "user32.dll",
  entryPoint: "GetWindowTextW",
  parameters: [Win32Type.HANDLE, Win32Type.POINTER, Win32Type.I32],
  returns: Win32Type.I32
});

const openProcess = bindFunction({
  library: "kernel32.dll",
  entryPoint: "OpenProcess",
  parameters: [Win32Type.U32, Win32Type.BOOL32, Win32Type.U32],
  returns: Win32Type.HANDLE
});

const queryFullProcessImageName = bindFunction({
  library: "kernel32.dll",
  entryPoint: "QueryFullProcessImageNameW",
  parameters: [Win32Type.HANDLE, Win32Type.U32, Win32Type.POINTER, Win32Type.POINTER],
  returns: Win32Type.BOOL32
});

const closeHandle = bindFunction({
  library: "kernel32.dll",
  entryPoint: "CloseHandle",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.BOOL32
});

// The frame without the invisible resize border and shadow Windows adds to GetWindowRect
const dwmGetWindowAttribute = bindFunction({
  library: "dwmapi.dll",
  entryPoint: "DwmGetWindowAttribute",
  parameters: [Win32Type.HANDLE, Win32Type.U32, Win32Type.POINTER, Win32Type.U32],
  returns: Win32Type.I32
});

export interface ForegroundWindow {
  hwnd: bigint;
  title: string;
  processId: number;
  appName: string;
  // Physical pixels in the virtual screen
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// "C:\Program Files\Microsoft VS Code\Code.exe" is "Code", as Process.ProcessName had it
export function appNameOf(imagePath: string) {
  const fileName = imagePath.split(PATH_SEPARATOR).at(-1) ?? "";
  return fileName.replace(EXECUTABLE_SUFFIX, "");
}

function titleOf(hwnd: bigint) {
  return withMemory({
    size: TITLE_CHARS * WIDE_CHAR_BYTES,
    use(memory) {
      getWindowText([argHandle(hwnd), argPointer(memory), argI32(TITLE_CHARS)]);
      return readWideString({
        memory,
        maxChars: TITLE_CHARS
      });
    }
  });
}

function imagePathOf(processId: number) {
  const process = openProcess([argU32(PROCESS_QUERY_LIMITED_INFORMATION), argBool(false), argU32(processId)]).address;
  const isInaccessible = process === NO_HANDLE;
  if (isInaccessible) {
    return "";
  }

  try {
    return withMemory({
      size: IMAGE_PATH_CHARS * WIDE_CHAR_BYTES,
      use: path =>
        withMemory({
          size: DWORD_BYTES,
          use(length) {
            length.writeU32(0, IMAGE_PATH_CHARS);
            const query = queryFullProcessImageName([
              argHandle(process),
              argU32(NO_FLAGS),
              argPointer(path),
              argPointer(length)
            ]);
            const isRead = query.number !== 0;
            return isRead
              ? readWideString({
                  memory: path,
                  maxChars: IMAGE_PATH_CHARS
                })
              : "";
          }
        })
    });
  } finally {
    closeHandle([argHandle(process)]);
  }
}

function boundsOf(hwnd: bigint) {
  return withMemory({
    size: RECT_BYTES,
    use(memory) {
      const result = dwmGetWindowAttribute([
        argHandle(hwnd),
        argU32(DWMWA_EXTENDED_FRAME_BOUNDS),
        argPointer(memory),
        argU32(RECT_BYTES)
      ]);
      const isRead = result.number >= 0;
      if (!isRead) {
        return undefined;
      }

      const left = memory.readI32(0);
      const top = memory.readI32(DWORD_BYTES);
      return {
        x: left,
        y: top,
        width: memory.readI32(RECT_RIGHT_OFFSET) - left,
        height: memory.readI32(RECT_BOTTOM_OFFSET) - top
      };
    }
  });
}

// The window the user is in, or undefined when there is none (the desktop, a locked screen)
export function readForegroundWindow() {
  const hwnd = foregroundWindowHandle();
  const isNoWindow = hwnd === NO_HANDLE;
  if (isNoWindow) {
    return undefined;
  }

  const bounds = boundsOf(hwnd);
  const isBoundsMissing = bounds === undefined;
  if (isBoundsMissing) {
    return undefined;
  }

  const processId = processIdOfWindow(hwnd);
  return {
    hwnd,
    title: titleOf(hwnd),
    processId,
    appName: appNameOf(imagePathOf(processId)),
    bounds
  };
}
