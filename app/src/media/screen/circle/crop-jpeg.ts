import type { Region } from "@/contracts/monitor.ts";
import { clipToSurface, DETAIL_SETTINGS, fitToEdge } from "@/media/screen/capture-geometry.ts";
import type { ScreenDetail } from "@/media/screen/capture-geometry.ts";
import { encodeBitmap } from "@/media/screen/jpeg-encoder.ts";
import { openImage } from "@/media/winrt/decoded-image.ts";
import { releaseNative } from "@/media/winrt/release.ts";

// `region` (in the picture's own pixels; the whole picture when it misses it) cut out of an encoded
// frame and encoded again at `detail`: the circled part, as the frame Gemini sees.
export async function cropJpeg({ jpeg, region, detail }: { jpeg: Uint8Array; region: Region; detail: ScreenDetail }) {
  const picture = await openImage(jpeg);
  try {
    const area = clipToSurface({
      region,
      size: picture.size
    }) ?? {
      x: 0,
      y: 0,
      ...picture.size
    };
    const { maxEdge, quality } = DETAIL_SETTINGS[detail];
    const size = fitToEdge({
      size: area,
      maxEdge
    });
    const bitmap = await picture.crop({
      area,
      scale: size.width / area.width
    });
    try {
      return await encodeBitmap({
        bitmap,
        quality
      });
    } finally {
      bitmap.close();
      releaseNative(bitmap);
    }
  } finally {
    picture.close();
  }
}
