import assert from "node:assert/strict";
import { test } from "node:test";

import {
  argHandle,
  argPointer,
  argU32,
  bindFunction,
  readWideString,
  wideMemory,
  Win32Type,
  withMemory
} from "./bind.ts";

const MAX_CHARS = 512;
const NO_HANDLE = 0n;
const BYTES_PER_CHAR = 2;

const getTickCount = bindFunction({
  library: "kernel32.dll",
  entryPoint: "GetTickCount",
  parameters: [],
  returns: Win32Type.U32
});

const getCurrentProcessId = bindFunction({
  library: "kernel32.dll",
  entryPoint: "GetCurrentProcessId",
  parameters: [],
  returns: Win32Type.U32
});

const getCurrentDirectory = bindFunction({
  library: "kernel32.dll",
  entryPoint: "GetCurrentDirectoryW",
  parameters: [Win32Type.U32, Win32Type.POINTER],
  returns: Win32Type.U32
});

const getDesktopWindow = bindFunction({
  library: "user32.dll",
  entryPoint: "GetDesktopWindow",
  parameters: [],
  returns: Win32Type.HANDLE
});

const isWindow = bindFunction({
  library: "user32.dll",
  entryPoint: "IsWindow",
  parameters: [Win32Type.HANDLE],
  returns: Win32Type.BOOL32
});

test("GetCurrentProcessId matches process.pid", () => {
  assert.equal(getCurrentProcessId([]).number, process.pid);
});

test("GetTickCount is positive", () => {
  assert.ok(getTickCount([]).number > 0);
});

test("wide strings round trip through memory", () => {
  const memory = wideMemory("Gemini");
  try {
    assert.equal(
      readWideString({
        memory,
        maxChars: 16
      }),
      "Gemini"
    );
  } finally {
    memory.release();
  }
});

test("an out buffer is filled by the call", () => {
  const directory = withMemory({
    size: MAX_CHARS * BYTES_PER_CHAR,
    use(memory) {
      const length = getCurrentDirectory([argU32(MAX_CHARS), argPointer(memory)]).number;
      assert.ok(length > 0);
      return readWideString({
        memory,
        maxChars: MAX_CHARS
      });
    }
  });
  assert.equal(directory.toLowerCase(), process.cwd().toLowerCase());
});

test("a handle return reads as a bigint address that a handle parameter accepts", () => {
  const desktop = getDesktopWindow([]).address;
  assert.ok(desktop > NO_HANDLE);
  assert.notEqual(isWindow([argHandle(desktop)]).number, 0);
  assert.equal(isWindow([argHandle(null)]).number, 0);
});
