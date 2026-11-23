import { roInitialize } from "@microsoft/dynwinrt";

import { readLines } from "@/media/ocr/ocr.ts";
import { createScreenCapture } from "@/media/screen/screen-capture.ts";

import { serveScreenCapture } from "./screen-capture-worker-host.ts";
import type { CapturePort } from "./screen-capture-worker-host.ts";

// The worker thread's whole job: its own WinRT apartment for the JPEG encoder and OCR, the GDI grab,
// encode and text recognition off the UI thread, then serve the port until a dispose ends the thread. DPI awareness is
// per process, so the main thread's ensureDpiAware already covers this thread's grabs.
export function startScreenCaptureWorker({ port }: { port: CapturePort | null }) {
  const isPortMissing = port === null;
  if (isPortMissing) {
    throw new Error("The screen capture worker runs in a worker thread");
  }

  roInitialize();
  serveScreenCapture({
    port,
    screenCapture: createScreenCapture(),
    // The Hebrew model loads once, at the first read, and stays loaded for the thread's lifetime;
    // its WebAssembly resolves from this bundle's own folder (litert beside it)
    readLines,
    // In a worker thread this ends the thread, not the process
    exit: () => process.exit()
  });
}
