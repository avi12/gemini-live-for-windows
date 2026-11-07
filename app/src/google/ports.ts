import type { ScreenView } from "./protocols/glic.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";
import type { LinkInfo } from "@gemini-live/protocol/link";

// What the Google engine needs from the rest of the app, as small interfaces: MEDIA, CORE and the
// shell provide the real ones, the tests hand in fakes.

export interface Logger {
  write(message: string): void;
}

export const GrabDetail = {
  sharp: "sharp",
  light: "light"
} as const;
export type GrabDetail = typeof GrabDetail[keyof typeof GrabDetail];

export interface JpegFrame {
  readonly jpeg: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface WebcamPort {
  grab(): JpegFrame | undefined;
  dispose(): Promise<void>;
}

// Pull-style: the page asks for a picture, so nothing is captured until it does
export interface MediaPort {
  grab(request: {
    monitor: Monitor;
    region: Region | undefined;
    detail: GrabDetail;
  }): Promise<JpegFrame | undefined>;
  readScreenText(monitor: Monitor): Promise<ScreenView | undefined>;
  openWebcam(): Promise<WebcamPort>;
}

// DPAPI-style sealing of bytes for the current user (CORE's secrets)
export interface SecretSealer {
  seal(plain: Uint8Array): Promise<Uint8Array>;
  unseal(sealed: Uint8Array): Promise<Uint8Array>;
}

// Where the link is published so the native host can hand the extension its port and token
// (CORE's writeLinkFile)
export interface LinkPublisher {
  publish(link: LinkInfo): Promise<void>;
}

export const MIME_JPEG = "image/jpeg";
