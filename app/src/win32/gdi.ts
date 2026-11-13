import { bindFunction, Win32Type } from "./bind.ts";

export const getDC = bindFunction({
  library: "user32.dll",
  entryPoint: "GetDC",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.HANDLE
});

export const releaseDC = bindFunction({
  library: "user32.dll",
  entryPoint: "ReleaseDC",
  parameters: [Win32Type.HANDLE, Win32Type.HANDLE],
  returns: Win32Type.I32
});

export const createCompatibleDC = bindFunction({
  library: "gdi32.dll",
  entryPoint: "CreateCompatibleDC",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.HANDLE
});

export const createDIBSection = bindFunction({
  library: "gdi32.dll",
  entryPoint: "CreateDIBSection",
  parameters: [Win32Type.HANDLE, Win32Type.POINTER, Win32Type.U32, Win32Type.POINTER, Win32Type.HANDLE, Win32Type.U32],
  returns: Win32Type.HANDLE
});

export const selectObject = bindFunction({
  library: "gdi32.dll",
  entryPoint: "SelectObject",
  parameters: [Win32Type.HANDLE, Win32Type.HANDLE],
  returns: Win32Type.HANDLE
});

export const deleteObject = bindFunction({
  library: "gdi32.dll",
  entryPoint: "DeleteObject",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.BOOL32
});

export const deleteDC = bindFunction({
  library: "gdi32.dll",
  entryPoint: "DeleteDC",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.BOOL32
});
