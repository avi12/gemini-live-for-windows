import type { Monitor, Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";

import { GrabDetail, type JpegFrame, type Logger, type MediaPort, MIME_JPEG, type WebcamPort } from "./ports.ts";
import type { Picture } from "./protocols/glic.ts";

async function attempt<T>({ label, work, log }: { label: string; work: () => Promise<T>; log: Logger }) {
  try {
    return await work();
  } catch (error) {
    log.write(`${label} failed: ${errorMessage(error)}`);
    return undefined;
  }
}

// The webcam, opened and closed on request. `onSwitch` runs before a real change of source, since
// the other source's picture is no stand-in for the new one.
function createCameraSource({ media, log, onSwitch }: { media: MediaPort; log: Logger; onSwitch: () => void }) {
  let camera: WebcamPort | undefined;

  // False if the camera could not be opened, leaving the screen as the source
  async function use(isOn: boolean) {
    const isUsingCamera = camera !== undefined;
    const isUnchanged = isOn === isUsingCamera;
    if (isUnchanged) {
      return true;
    }

    onSwitch();

    if (isOn) {
      try {
        camera = await media.openWebcam();
        log.write("glic: sharing the camera");
        return true;
      } catch (error) {
        log.write(`camera unavailable: ${errorMessage(error)}`);
        return false;
      }
    }

    const old = camera;
    camera = undefined;
    await old?.dispose();
    log.write("glic: sharing the screen");
    return true;
  }

  return {
    use,
    get current() {
      return camera;
    }
  };
}

interface ViewState {
  lastFrame: JpegFrame | undefined;
  monitor: Monitor;
  region: Region | undefined;
}

interface ViewSources {
  media: MediaPort;
  log: Logger;
  state: ViewState;
  camera: ReturnType<typeof createCameraSource>;
}

function grabScreen({ media, log, state }: Omit<ViewSources, "camera">) {
  return attempt({
    label: "grab",
    log,
    work: () =>
      media.grab({
        monitor: state.monitor,
        region: state.region,
        detail: GrabDetail.SHARP
      })
  });
}

// A picture for the page's pull: the camera's, or a sharp grab of the shared display. A failed
// grab keeps the last good picture rather than leaving Gemini blind for a frame.
async function capturePicture({ media, log, state, camera }: ViewSources) {
  const frame = camera.current
    ? camera.current.grab()
    : await grabScreen({
        media,
        log,
        state
      });
  const shown = frame ?? state.lastFrame;
  state.lastFrame = shown;

  if (!shown) {
    return null;
  }

  const picture: Picture = {
    data: Buffer.from(shown.jpeg).toString("base64"),
    mimeType: MIME_JPEG,
    width: shown.width,
    height: shown.height
  };
  return picture;
}

// An exact text copy of the window on the shared display, which the page hands Gemini as the
// tab's page content next to each picture. None while the camera is shared, or while Gemini sees
// only a circled region: the whole window's text would pull it off that.
async function readScreenText({ media, log, state, camera }: ViewSources) {
  const isOffScreen = camera.current !== undefined || state.region !== undefined;
  if (isOffScreen) {
    return null;
  }

  const view = await attempt({
    label: "screen text",
    log,
    work: () => media.readScreenText(state.monitor)
  });
  return view ?? null;
}

// What Gemini sees through the glic page: the shared display, or the webcam in its place. The page
// pulls a picture, and a text copy of the window, whenever it wants one; this only decides which
// source answers.
export function createSharedView({ media, monitor, log }: { media: MediaPort; monitor: Monitor; log: Logger }) {
  const state: ViewState = {
    lastFrame: undefined,
    monitor,
    region: undefined
  };
  const camera = createCameraSource({
    media,
    log,
    onSwitch() {
      state.lastFrame = undefined;
    }
  });

  return {
    // Shares the webcam instead of the screen, or switches back
    useCamera: camera.use,
    capture: () =>
      capturePicture({
        media,
        log,
        state,
        camera
      }),
    read: () =>
      readScreenText({
        media,
        log,
        state,
        camera
      }),
    get isUsingCamera() {
      return camera.current !== undefined;
    },
    get monitor() {
      return state.monitor;
    },
    set monitor(value: Monitor) {
      state.monitor = value;
    },
    get region() {
      return state.region;
    },
    set region(value: Region | undefined) {
      state.region = value;
    }
  };
}

export type SharedView = ReturnType<typeof createSharedView>;
