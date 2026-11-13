import { BitmapAlphaMode } from "winui-svelte/bindings/windows/graphics/imaging/BitmapAlphaMode";
import { BitmapDecoder } from "winui-svelte/bindings/windows/graphics/imaging/BitmapDecoder";
import { BitmapInterpolationMode } from "winui-svelte/bindings/windows/graphics/imaging/BitmapInterpolationMode";
import { BitmapPixelFormat } from "winui-svelte/bindings/windows/graphics/imaging/BitmapPixelFormat";
import { BitmapTransform } from "winui-svelte/bindings/windows/graphics/imaging/BitmapTransform";
import { ColorManagementMode } from "winui-svelte/bindings/windows/graphics/imaging/ColorManagementMode";
import { ExifOrientationMode } from "winui-svelte/bindings/windows/graphics/imaging/ExifOrientationMode";
import { CryptographicBuffer } from "winui-svelte/bindings/windows/security/cryptography/CryptographicBuffer";
import { InMemoryRandomAccessStream } from "winui-svelte/bindings/windows/storage/streams/InMemoryRandomAccessStream";

import type { PixelRect, PixelSize } from "@/media/screen/capture-geometry.ts";

import { releaseNative } from "./release.ts";

const STREAM_START = 0n;

// A JPEG, PNG or BMP held open for decoding parts of it. Always `close()` it.
export async function openImage(encoded: Uint8Array) {
  const stream = new InMemoryRandomAccessStream();
  await stream.writeAsync(CryptographicBuffer.createFromByteArray(encoded));
  stream.seek(STREAM_START);
  const decoder = await BitmapDecoder.createAsync(stream);
  const size: PixelSize = {
    width: decoder.pixelWidth,
    height: decoder.pixelHeight
  };

  // `area` (in the picture's pixels) as a BGRA bitmap, scaled by `scale` in the same decode. WIC scales
  // first and crops the scaled picture, so the bounds are scaled with it. The caller closes the bitmap.
  function crop({ area, scale }: { area: PixelRect; scale: number }) {
    const transform = new BitmapTransform();
    transform.scaledWidth = Math.round(size.width * scale);
    transform.scaledHeight = Math.round(size.height * scale);
    transform.interpolationMode = BitmapInterpolationMode.Fant;
    transform.bounds = {
      x: Math.round(area.x * scale),
      y: Math.round(area.y * scale),
      width: Math.max(1, Math.round(area.width * scale)),
      height: Math.max(1, Math.round(area.height * scale))
    };
    return decoder.getSoftwareBitmapAsync(
      BitmapPixelFormat.Bgra8,
      BitmapAlphaMode.Premultiplied,
      transform,
      ExifOrientationMode.IgnoreExifOrientation,
      ColorManagementMode.DoNotColorManage
    );
  }

  function close() {
    stream.close();
    releaseNative(decoder);
    releaseNative(stream);
  }

  return {
    size,
    crop,
    close
  };
}
