import { listCameraEntries, pickColorCamera } from "./camera-pick.ts";
import type { CameraGroupInfo } from "./camera-pick.ts";
import { createCameraPump } from "./camera-pump.ts";
import { systemClock } from "@/media/clock.ts";
import type { Clock } from "@/media/clock.ts";
import { DETAIL_SETTINGS, fitToEdge, ScreenDetail } from "@/media/screen/capture-geometry.ts";
import { encodeBitmap } from "@/media/screen/jpeg-encoder.ts";
import { releaseNative } from "@/media/winrt/release.ts";
import { BitmapAlphaMode } from "winui-svelte/bindings/windows/graphics/imaging/BitmapAlphaMode";
import { BitmapPixelFormat } from "winui-svelte/bindings/windows/graphics/imaging/BitmapPixelFormat";
import { SoftwareBitmap } from "winui-svelte/bindings/windows/graphics/imaging/SoftwareBitmap";
import {
  MediaFrameReaderStartStatus
} from "winui-svelte/bindings/windows/media/capture/frames/MediaFrameReaderStartStatus";
import { MediaFrameSourceGroup } from "winui-svelte/bindings/windows/media/capture/frames/MediaFrameSourceGroup";
import { MediaCapture } from "winui-svelte/bindings/windows/media/capture/MediaCapture";
import {
  MediaCaptureInitializationSettings
} from "winui-svelte/bindings/windows/media/capture/MediaCaptureInitializationSettings";
import { MediaCaptureMemoryPreference } from "winui-svelte/bindings/windows/media/capture/MediaCaptureMemoryPreference";
import { MediaCaptureSharingMode } from "winui-svelte/bindings/windows/media/capture/MediaCaptureSharingMode";
import { StreamingCaptureMode } from "winui-svelte/bindings/windows/media/capture/StreamingCaptureMode";

// MediaEncodingSubtypes.Bgra8 (the static class is not in the generated bindings)
const BGRA8_SUBTYPE = "BGRA8";
const CAMERA_DETAIL = ScreenDetail.light;

async function findGroups() {
  const groups = [...await MediaFrameSourceGroup.findAllAsync() ?? []];
  return groups.map(group => ({
    group,
    info: {
      id: group.id,
      name: group.displayName,
      sources: [...group.sourceInfos ?? []].map(source => ({
        id: source.id,
        sourceKind: source.sourceKind,
        mediaStreamType: source.mediaStreamType
      }))
    } satisfies CameraGroupInfo
  }));
}

// The webcams Windows knows, by the id to hand to openCamera. Only lists them; no camera is opened.
export async function listCameras() {
  const groups = await findGroups();
  return listCameraEntries(groups.map(entry => entry.info));
}

function toBgra8(bitmap: SoftwareBitmap) {
  const isBgra8 = bitmap.bitmapPixelFormat === BitmapPixelFormat.Bgra8;
  if (isBgra8) {
    return SoftwareBitmap.copy(bitmap);
  }

  return SoftwareBitmap.convert(bitmap, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
}

function frameFrom(bitmap: SoftwareBitmap) {
  return {
    encode: () => encodeBitmap({
      bitmap,
      quality: DETAIL_SETTINGS[CAMERA_DETAIL].quality,
      size: fitToEdge({
        size: {
          width: bitmap.pixelWidth,
          height: bitmap.pixelHeight
        },
        maxEdge: DETAIL_SETTINGS[CAMERA_DETAIL].maxEdge
      })
    }),
    release() {
      bitmap.close();
      releaseNative(bitmap);
    }
  };
}

async function openReader(cameraId: string | undefined) {
  const groups = await findGroups();
  const choice = pickColorCamera({
    groups: groups.map(entry => entry.info),
    cameraId
  });
  const group = groups.find(entry => entry.info.id === choice?.groupId)?.group;
  const isChoiceMissingOrGroupMissing = choice === undefined || group === undefined;
  if (isChoiceMissingOrGroupMissing) {
    throw new Error("no color camera found");
  }

  const capture = new MediaCapture();
  const settings = new MediaCaptureInitializationSettings();
  settings.sourceGroup = group;
  settings.sharingMode = MediaCaptureSharingMode.ExclusiveControl;
  settings.memoryPreference = MediaCaptureMemoryPreference.Cpu;
  settings.streamingCaptureMode = StreamingCaptureMode.Video;
  await capture.initializeAsync(settings);
  const source = capture.frameSources?.lookup(choice.sourceId);
  const isSourceMissing = source === undefined;
  if (isSourceMissing) {
    capture.close();
    throw new Error("the camera has no such source");
  }

  const reader = await capture.createFrameReaderAsync(source, BGRA8_SUBTYPE);
  const status = await reader.startAsync();
  const isFailure = status !== MediaFrameReaderStartStatus.Success;
  if (isFailure) {
    reader.close();
    capture.close();
    throw new Error(`camera reader start: ${status}`);
  }

  return {
    capture,
    reader
  };
}

// The default webcam, or `cameraId` from listCameras, as a headless MediaFrameReader (no preview element,
// and it works on webcams with no independent photo stream). The reader is polled into a latest-JPEG slot
// that `grab()` reads at once. MediaCapture has thread affinity: open and dispose it on one thread.
// Throws when there is no webcam, or another app holds it exclusively.
export async function openCamera({ cameraId, clock = systemClock, onError }: {
  cameraId?: string | undefined;
  clock?: Clock;
  onError: (error: unknown) => void;
}) {
  const { capture, reader } = await openReader(cameraId);
  const pump = createCameraPump({
    source: {
      acquireLatest() {
        const reference = reader.tryAcquireLatestFrame();
        const bitmap = reference?.videoMediaFrame?.softwareBitmap;
        const copy = bitmap === undefined ? undefined : toBgra8(bitmap);
        reference?.close();
        return copy === undefined ? undefined : frameFrom(copy);
      }
    },
    clock,
    onError
  });

  return {
    grab: () => pump.latest(),
    async dispose() {
      pump.stop();
      await reader.stopAsync();
      reader.close();
      capture.close();
    }
  };
}

export type Camera = Awaited<ReturnType<typeof openCamera>>;
