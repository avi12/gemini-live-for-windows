import { bindFunction, Win32Type } from "./bind.ts";

export const getDC = bindFunction({
  library: "user32.dll",
  entryPoint: "GetDC",
  parameters: [Win32Type.handle],
  returns: Win32Type.handle
});

export const releaseDC = bindFunction({
  library: "user32.dll",
  entryPoint: "ReleaseDC",
  parameters: [Win32Type.handle, Win32Type.handle],
  returns: Win32Type.i32
});

export const createCompatibleDC = bindFunction({
  library: "gdi32.dll",
  entryPoint: "CreateCompatibleDC",
  parameters: [Win32Type.handle],
  returns: Win32Type.handle
});

export const createDIBSection = bindFunction({
  library: "gdi32.dll",
  entryPoint: "CreateDIBSection",
  parameters: [
    Win32Type.handle,
    Win32Type.pointer,
    Win32Type.u32,
    Win32Type.pointer,
    Win32Type.handle,
    Win32Type.u32
  ],
  returns: Win32Type.handle
});

export const selectObject = bindFunction({
  library: "gdi32.dll",
  entryPoint: "SelectObject",
  parameters: [Win32Type.handle, Win32Type.handle],
  returns: Win32Type.handle
});

export const deleteObject = bindFunction({
  library: "gdi32.dll",
  entryPoint: "DeleteObject",
  parameters: [Win32Type.handle],
  returns: Win32Type.bool32
});

export const deleteDC = bindFunction({
  library: "gdi32.dll",
  entryPoint: "DeleteDC",
  parameters: [Win32Type.handle],
  returns: Win32Type.bool32
});
