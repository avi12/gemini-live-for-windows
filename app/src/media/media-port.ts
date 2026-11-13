import type { MediaPort, WebcamPort } from "@/google/ports.ts";

import type { ScreenTextReader } from "./screen-text/screen-text.ts";
import type { ScreenCapture } from "./screen/screen-capture.ts";

export interface CameraHandle {
  grab():
    | {
        jpeg: Uint8Array;
        width: number;
        height: number;
      }
    | undefined;
  dispose(): Promise<void>;
}

// The Google engine's pull-style view of the screen and the camera: nothing is captured until the page
// asks for a picture. A frame is a JPEG at the asked detail (`light` or `sharp`).
export function createMediaPort({
  screenCapture,
  screenText,
  openCamera
}: {
  screenCapture: Pick<ScreenCapture, "grab">;
  screenText: ScreenTextReader;
  openCamera: () => Promise<CameraHandle>;
}) {
  return {
    grab: ({ monitor, region, detail }) =>
      screenCapture.grab({
        monitor,
        region,
        detail
      }),
    readScreenText: monitor => screenText.read(monitor),
    async openWebcam() {
      const camera = await openCamera();
      return {
        grab: () => camera.grab(),
        dispose: () => camera.dispose()
      } satisfies WebcamPort;
    }
  } satisfies MediaPort;
}
