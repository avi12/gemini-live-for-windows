import { PropertyType } from "winui-svelte/bindings/windows/foundation/PropertyType";
import { PropertyValue } from "winui-svelte/bindings/windows/foundation/PropertyValue";
import { BitmapAlphaMode } from "winui-svelte/bindings/windows/graphics/imaging/BitmapAlphaMode";
import { BitmapBufferAccessMode } from "winui-svelte/bindings/windows/graphics/imaging/BitmapBufferAccessMode";
import { BitmapEncoder } from "winui-svelte/bindings/windows/graphics/imaging/BitmapEncoder";
import { BitmapInterpolationMode } from "winui-svelte/bindings/windows/graphics/imaging/BitmapInterpolationMode";
import { BitmapPixelFormat } from "winui-svelte/bindings/windows/graphics/imaging/BitmapPixelFormat";
import { BitmapPropertySet } from "winui-svelte/bindings/windows/graphics/imaging/BitmapPropertySet";
import { BitmapTypedValue } from "winui-svelte/bindings/windows/graphics/imaging/BitmapTypedValue";
import { SoftwareBitmap } from "winui-svelte/bindings/windows/graphics/imaging/SoftwareBitmap";
import { CryptographicBuffer } from "winui-svelte/bindings/windows/security/cryptography/CryptographicBuffer";
import { Buffer as WinRtBuffer } from "winui-svelte/bindings/windows/storage/streams/Buffer";
import { InMemoryRandomAccessStream } from "winui-svelte/bindings/windows/storage/streams/InMemoryRandomAccessStream";
import { InputStreamOptions } from "winui-svelte/bindings/windows/storage/streams/InputStreamOptions";

import { withBufferBytes } from "@/media/winrt/buffer-access.ts";
import { releaseNative } from "@/media/winrt/release.ts";
import { argAddress, argU64, bindFunction, Win32Type } from "@/win32/bind.ts";

import type { PixelSize } from "./capture-geometry.ts";
import type { CapturedPixels } from "./gdi-capture.ts";

const IMAGE_QUALITY = "ImageQuality";
const STREAM_START = 0n;

const moveMemory = bindFunction({
  library: "kernel32.dll",
  entryPoint: "RtlMoveMemory",
  parameters: [Win32Type.POINTER, Win32Type.POINTER, Win32Type.U64],
  returns: Win32Type.VOID
});

export interface EncodedFrame {
  readonly jpeg: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface EncodeRequest {
  pixels: CapturedPixels;
  quality: number;
}

// The quality of a JPEG is an `ImageQuality` option, a boxed single, handed to the encoder as a list
// of key/value pairs (proven on this machine: the encoded size follows the value)
function qualityOptions(quality: number) {
  const options = new BitmapPropertySet();
  options.insert(IMAGE_QUALITY, BitmapTypedValue.create(PropertyValue.createSingle(quality), PropertyType.Single));
  return [...options];
}

async function readStream(stream: InMemoryRandomAccessStream) {
  const size = Number(stream.size);
  stream.seek(STREAM_START);
  const buffer = await stream.readAsync(new WinRtBuffer(size), size, InputStreamOptions.None);
  return new Uint8Array(CryptographicBuffer.copyToByteArray(buffer));
}

// The JPEG of a SoftwareBitmap, scaled to `size` by WIC (Fant) when that differs from the bitmap. The
// encoder keeps a shared lock on the bitmap it was given, so it is released here, before the caller
// closes or reuses the bitmap; WIC's own scaling holds a source-sized buffer until a collection, so
// shrink before this where the source is large (the screen does, the camera frames are small).
export async function encodeBitmap({
  bitmap,
  quality,
  size
}: {
  bitmap: SoftwareBitmap;
  quality: number;
  size?: PixelSize | undefined;
}) {
  const outputSize = size ?? {
    width: bitmap.pixelWidth,
    height: bitmap.pixelHeight
  };
  const stream = new InMemoryRandomAccessStream();
  let encoder: BitmapEncoder | undefined;
  try {
    encoder = await BitmapEncoder.createAsync(BitmapEncoder.jpegEncoderId, stream, qualityOptions(quality));
    encoder.setSoftwareBitmap(bitmap);
    const isScaled = outputSize.width !== bitmap.pixelWidth || outputSize.height !== bitmap.pixelHeight;
    if (isScaled) {
      encoder.bitmapTransform.scaledWidth = outputSize.width;
      encoder.bitmapTransform.scaledHeight = outputSize.height;
      encoder.bitmapTransform.interpolationMode = BitmapInterpolationMode.Fant;
    }

    await encoder.flushAsync();
    return {
      jpeg: await readStream(stream),
      ...outputSize
    };
  } finally {
    const releasedEncoder = encoder;
    if (releasedEncoder) {
      releaseNative(releasedEncoder);
    }

    stream.close();
    releaseNative(stream);
  }
}

function fill({ target, pixels }: { target: SoftwareBitmap; pixels: CapturedPixels }) {
  withBufferBytes({
    buffer: target.lockBuffer(BitmapBufferAccessMode.Write),
    use({ address, capacity }) {
      const isCapacityBelowByteLength = capacity < pixels.byteLength;
      if (isCapacityBelowByteLength) {
        throw new Error(`The bitmap holds ${capacity} bytes, the capture has ${pixels.byteLength}`);
      }

      moveMemory([argAddress(address), argAddress(pixels.address), argU64(BigInt(pixels.byteLength))]);
    }
  });
}

// The one JPEG encoder every screen frame goes through, whole screen or circled part. The BGRA pixels
// are copied once, native to native, into a fresh SoftwareBitmap per frame (a bitmap the encoder has
// seen refuses the next write, 0x80070005).
export function createJpegEncoder() {
  async function encode({ pixels, quality }: EncodeRequest) {
    const target = new SoftwareBitmap(BitmapPixelFormat.Bgra8, pixels.width, pixels.height, BitmapAlphaMode.Ignore);
    try {
      fill({
        target,
        pixels
      });
      return await encodeBitmap({
        bitmap: target,
        quality
      });
    } finally {
      target.close();
      releaseNative(target);
    }
  }

  return { encode };
}
