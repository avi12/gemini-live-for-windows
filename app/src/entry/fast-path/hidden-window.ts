import "@microsoft/dynwinrt";

import { argHandle, argI32, argNull, argU32, argWideString, bindFunction, Win32Type } from "@/win32/bind.ts";

const STATIC_CLASS = "STATIC";
const NO_EXTENDED_STYLE = 0;
// Not WS_VISIBLE: the window exists for the shell and is never shown. It is a top-level window,
// not a message-only one, because the shell finds the Copilot key target among top-level windows.
const HIDDEN_STYLE = 0;
const NO_POSITION = 0;
const NO_SIZE = 0;
const NO_WINDOW = 0n;

let createWindow: ReturnType<typeof bindCreateWindow> | undefined;
let destroyWindow: ReturnType<typeof bindDestroyWindow> | undefined;

function bindCreateWindow() {
  return bindFunction({
    library: "user32.dll",
    entryPoint: "CreateWindowExW",
    parameters: [
      Win32Type.U32,
      Win32Type.POINTER,
      Win32Type.POINTER,
      Win32Type.U32,
      Win32Type.I32,
      Win32Type.I32,
      Win32Type.I32,
      Win32Type.I32,
      Win32Type.HANDLE,
      Win32Type.HANDLE,
      Win32Type.HANDLE,
      Win32Type.POINTER
    ],
    returns: Win32Type.HANDLE,
    shouldCaptureLastError: true
  });
}

function bindDestroyWindow() {
  return bindFunction({
    library: "user32.dll",
    entryPoint: "DestroyWindow",
    parameters: [Win32Type.HANDLE],
    returns: Win32Type.BOOL32
  });
}

/**
 * A never-shown top-level window. Call it on the thread whose message pump will serve the window, and
 * destroy it on that same thread.
 */
export function createHiddenWindow(title: string) {
  createWindow ??= bindCreateWindow();
  destroyWindow ??= bindDestroyWindow();
  const result = createWindow([
    argU32(NO_EXTENDED_STYLE),
    argWideString(STATIC_CLASS),
    argWideString(title),
    argU32(HIDDEN_STYLE),
    argI32(NO_POSITION),
    argI32(NO_POSITION),
    argI32(NO_SIZE),
    argI32(NO_SIZE),
    argHandle(null),
    argHandle(null),
    argHandle(null),
    argNull()
  ]);
  const isCreationFailed = result.address === NO_WINDOW;
  if (isCreationFailed) {
    throw new Error(`CreateWindowExW failed (error ${result.lastError})`);
  }

  const hwnd = result.address;
  return {
    hwnd,
    destroy() {
      destroyWindow?.([argHandle(hwnd)]);
    }
  };
}
