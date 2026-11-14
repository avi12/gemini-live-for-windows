import type { CursorApi } from "@/overlays/ports.ts";
import { readCursorPosition } from "@/win32/user32.ts";

const ORIGIN = {
  x: 0,
  y: 0
};

export function createCursorApi() {
  return {
    cursorPosition: () => readCursorPosition() ?? ORIGIN
  } satisfies CursorApi;
}
