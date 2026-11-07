import { lineText } from "./ocr-geometry.ts";
import { readLines } from "./ocr.ts";
import { createJpegEncoder } from "@/media/screen/jpeg-encoder.ts";
import {
  argHandle,
  argI32,
  argPointer,
  argU32,
  bindFunction,
  wideMemory,
  Win32Type,
  withMemory
} from "@/win32/bind.ts";
import {
  createCompatibleDC,
  createDIBSection,
  deleteDC,
  deleteObject,
  getDC,
  selectObject
} from "@/win32/gdi.ts";
import { roInitialize } from "@microsoft/dynwinrt";
import { DynComRawMemory } from "@microsoft/dynwinrt/com/unsafe/raw";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_200 = 200;
const NUMBER_32 = 32;
const NUMBER_14 = 14;
const NUMBER_12 = 12;
const NUMBER_8 = 8;
const NUMBER_4 = 4;
const NUMBER_40 = 40;

const IS_WINDOWS = process.platform === "win32";
const WIDTH = 900;
const HEIGHT = 400;
const BYTES_PER_PIXEL = 4;
const WHITE_BYTE = 0xff;
const FONT_HEIGHT = -48;
const FONT_WEIGHT = 400;
const ANTIALIASED_QUALITY = 4;
const TRANSPARENT = 1;
const FIRST_LINE = {
  text: "Gemini Live reads this",
  x: 60,
  y: 50
};
const SECOND_LINE = {
  text: "Second line below",
  x: 60,
  y: 250
};
const POSITION_TOLERANCE = 60;
const JPEG_QUALITY = 0.92;

const createFont = bindFunction({
  library: "gdi32.dll",
  entryPoint: "CreateFontW",
  parameters: [
    Win32Type.i32, Win32Type.i32, Win32Type.i32, Win32Type.i32, Win32Type.i32,
    Win32Type.u32, Win32Type.u32, Win32Type.u32, Win32Type.u32,
    Win32Type.u32, Win32Type.u32, Win32Type.u32, Win32Type.u32,
    Win32Type.pointer
  ],
  returns: Win32Type.handle
});
const setBkMode = bindFunction({
  library: "gdi32.dll",
  entryPoint: "SetBkMode",
  parameters: [Win32Type.handle, Win32Type.i32],
  returns: Win32Type.i32
});
const textOut = bindFunction({
  library: "gdi32.dll",
  entryPoint: "TextOutW",
  parameters: [Win32Type.handle, Win32Type.i32, Win32Type.i32, Win32Type.pointer, Win32Type.i32],
  returns: Win32Type.bool32
});
// White page, black text, drawn by GDI into a DIB, then encoded by the same JPEG encoder the screen uses
async function renderTextJpeg() {
  const screen = getDC([argHandle(null)]).address;
  const memoryDC = createCompatibleDC([argHandle(screen)]).address;
  const name = wideMemory("Arial");
  const font = createFont([
    argI32(FONT_HEIGHT), argI32(0), argI32(0), argI32(0), argI32(FONT_WEIGHT),
    argU32(0), argU32(0), argU32(0), argU32(0), argU32(0), argU32(0), argU32(ANTIALIASED_QUALITY), argU32(0),
    argPointer(name)
  ]).address;
  name.release();
  const bitmap = withMemory({
    size: 40,
    use(header) {
      header.writeU32(0, NUMBER_40);
      header.writeI32(NUMBER_4, WIDTH);
      header.writeI32(NUMBER_8, -HEIGHT);
      header.writeU16(NUMBER_12, 1);
      header.writeU16(NUMBER_14, NUMBER_32);
      return withMemory({
        size: 8,
        use(bitsOut) {
          const handle = createDIBSection([
            argHandle(screen),
            argPointer(header),
            argU32(0),
            argPointer(bitsOut),
            argHandle(null),
            argU32(0)
          ]).address;
          return {
            handle,
            bits: bitsOut.readU64(0)
          };
        }
      });
    }
  });
  try {
    selectObject([argHandle(memoryDC), argHandle(bitmap.handle)]);
    selectObject([argHandle(memoryDC), argHandle(font)]);
    setBkMode([argHandle(memoryDC), argI32(TRANSPARENT)]);
    const pixels = WIDTH * HEIGHT * BYTES_PER_PIXEL;
    DynComRawMemory.fromUnsafeAddress(bitmap.bits, pixels, 1).writeBytes(0, Buffer.alloc(pixels, WHITE_BYTE));
    for (const line of [FIRST_LINE, SECOND_LINE]) {
      const text = wideMemory(line.text);
      try {
        textOut([argHandle(memoryDC), argI32(line.x), argI32(line.y), argPointer(text), argI32(line.text.length)]);
      } finally {
        text.release();
      }
    }
    return await createJpegEncoder().encode({
      pixels: {
        width: WIDTH,
        height: HEIGHT,
        address: bitmap.bits,
        byteLength: pixels
      },
      quality: JPEG_QUALITY
    });
  } finally {
    deleteObject([argHandle(font)]);
    deleteObject([argHandle(bitmap.handle)]);
    deleteDC([argHandle(memoryDC)]);
  }
}

describe("OCR on this machine", { skip: !IS_WINDOWS }, () => {
  it("reads text that GDI drew, with boxes where it was drawn", async () => {
    roInitialize();
    const { jpeg } = await renderTextJpeg();
    const lines = await readLines({ image: jpeg });
    assert.deepEqual(lines.map(line => lineText(line).toLowerCase()), ["gemini live reads this", "second line below"]);
    const first = lines[0]?.words[0]?.bounds;
    assert.ok(first);
    assert.ok(Math.abs(first.x - FIRST_LINE.x) < POSITION_TOLERANCE, `x ${first.x}`);
    assert.ok(Math.abs(first.y - FIRST_LINE.y) < POSITION_TOLERANCE, `y ${first.y}`);
  });

  it("reads only a region, and reports boxes in the whole picture's pixels", async () => {
    roInitialize();
    const { jpeg } = await renderTextJpeg();
    const lines = await readLines({
      image: jpeg,
      region: {
        x: 0,
        y: 200,
        width: WIDTH,
        height: HEIGHT - NUMBER_200
      }
    });
    assert.deepEqual(lines.map(line => lineText(line).toLowerCase()), ["second line below"]);
    const box = lines[0]?.words[0]?.bounds;
    assert.ok(box);
    assert.ok(box.y >= SECOND_LINE.y - POSITION_TOLERANCE, `y ${box.y}`);
    assert.ok(Math.abs(box.x - SECOND_LINE.x) < POSITION_TOLERANCE, `x ${box.x}`);
  });

  it("reads a small crop of one line", async () => {
    roInitialize();
    const { jpeg } = await renderTextJpeg();
    const lines = await readLines({
      image: jpeg,
      region: {
        x: 40,
        y: 44,
        width: 560,
        height: 80
      }
    });
    assert.match(lines.map(line => lineText(line)).join(" ").toLowerCase(), /gemini/);
  });

  it("is empty for a region outside the picture", async () => {
    roInitialize();
    const { jpeg } = await renderTextJpeg();
    assert.deepEqual(
      await readLines({
        image: jpeg,
        region: {
          x: 5000,
          y: 0,
          width: 10,
          height: 10
        }
      }), []
    );
  });
});
