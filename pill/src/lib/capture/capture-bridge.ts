import { framePeriodMilliseconds } from "./capture-schema.ts";
import type { CaptureConfig } from "./capture-schema.ts";
import { captureItemOfMonitor } from "./monitor-capture-item.ts";
import { CanvasAlphaMode } from "winui-svelte/bindings/microsoft/graphics/canvas/CanvasAlphaMode";
import { CanvasBitmap } from "winui-svelte/bindings/microsoft/graphics/canvas/CanvasBitmap";
import { CanvasDevice } from "winui-svelte/bindings/microsoft/graphics/canvas/CanvasDevice";
import { CanvasImageInterpolation } from "winui-svelte/bindings/microsoft/graphics/canvas/CanvasImageInterpolation";
import { CanvasRenderTarget } from "winui-svelte/bindings/microsoft/graphics/canvas/CanvasRenderTarget";
import type { Direct3D11CaptureFrame } from "winui-svelte/bindings/windows/graphics/capture/Direct3D11CaptureFrame";
import { Direct3D11CaptureFramePool } from "winui-svelte/bindings/windows/graphics/capture/Direct3D11CaptureFramePool";
import type { GraphicsCaptureSession } from "winui-svelte/bindings/windows/graphics/capture/GraphicsCaptureSession";
import { IDirect3DDevice } from "winui-svelte/bindings/windows/graphics/direct-x/direct3-d11/IDirect3DDevice";
import { DirectXPixelFormat } from "winui-svelte/bindings/windows/graphics/direct-x/DirectXPixelFormat";

const POOL_BUFFER_COUNT = 2;
const TARGET_DPI = 96;
const OPAQUE = 1;
const TICKS_PER_MILLISECOND = 10_000;
const MIN_UPDATE_SHARE_OF_PERIOD = 0.75;

export interface WinrtBridgeOptions {
  isSoftwareRendererForced?: boolean;
}

const NATIVE_HANDLE_KEY = "_obj";

function direct3DDeviceOf(device: CanvasDevice) {
  return IDirect3DDevice.from(Object.getOwnPropertyDescriptor(device, NATIVE_HANDLE_KEY)?.value);
}

function configureSession({ session, targetFramesPerSecond }: {
  session: GraphicsCaptureSession;
  targetFramesPerSecond: number;
}) {
  session.isBorderRequired = false;
  session.isCursorCaptureEnabled = false;
  const periodTicks = framePeriodMilliseconds(targetFramesPerSecond) * TICKS_PER_MILLISECOND;
  session.minUpdateInterval = { duration: BigInt(Math.floor(periodTicks * MIN_UPDATE_SHARE_OF_PERIOD)) };
}

function lastFrameOf(pool: Direct3D11CaptureFramePool) {
  let latest = pool.tryGetNextFrame();
  if (!latest) {
    return undefined;
  }

  for (let newer = pool.tryGetNextFrame(); newer; newer = pool.tryGetNextFrame()) {
    latest.close();
    latest = newer;
  }

  return latest;
}

function drawScaled({ device, target, frame }: {
  device: CanvasDevice;
  target: CanvasRenderTarget;
  frame: Direct3D11CaptureFrame;
}) {
  const bitmap = CanvasBitmap.createFromDirect3D11Surface(device, frame.surface);
  const session = target.createDrawingSession();
  try {
    const { width, height } = target.sizeInPixels;
    const source = bitmap.sizeInPixels;
    session.drawImage(
      bitmap,
      {
        x: 0,
        y: 0,
        width,
        height
      },
      {
        x: 0,
        y: 0,
        width: source.width,
        height: source.height
      },
      OPAQUE,
      CanvasImageInterpolation.Linear
    );
  } finally {
    session.close();
    bitmap.close();
  }
}

function openSource({ device, config }: {
  device: CanvasDevice;
  config: CaptureConfig;
}) {
  const item = captureItemOfMonitor(BigInt(config.displayId));

  const pool = Direct3D11CaptureFramePool.createFreeThreaded(
    direct3DDeviceOf(device),
    DirectXPixelFormat.B8G8R8A8UIntNormalized,
    POOL_BUFFER_COUNT,
    item.size
  );
  const session = pool.createCaptureSession(item);
  configureSession({
    session,
    targetFramesPerSecond: config.targetFramesPerSecond
  });
  const target = CanvasRenderTarget.createWithWidthAndHeightAndDpiAndFormatAndAlpha(
    device,
    config.size.width,
    config.size.height,
    TARGET_DPI,
    DirectXPixelFormat.R8G8B8A8UIntNormalized,
    CanvasAlphaMode.Ignore
  );
  session.startCapture();

  function readNextFrame() {
    const frame = lastFrameOf(pool);
    if (!frame) {
      return undefined;
    }

    try {
      drawScaled({
        device,
        target,
        frame
      });
    } finally {
      frame.close();
    }

    return {
      width: config.size.width,
      height: config.size.height,
      pixels: new Uint8Array(target.getPixelBytes())
    };
  }

  function close() {
    session.close();
    pool.close();
    target.close();
  }

  return {
    readNextFrame,
    close
  };
}

export function createWinrtCaptureBridge({ isSoftwareRendererForced = false }: WinrtBridgeOptions = {}) {
  const device = CanvasDevice.getSharedDevice(isSoftwareRendererForced);
  return {
    openSource(config: CaptureConfig) {
      return openSource({
        device,
        config
      });
    }
  };
}
