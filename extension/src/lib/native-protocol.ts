// Every message between this extension and the app's native messaging host (GeminiLiveHost), which
// is how the extension finds the app wherever the browser installed it from. The app's side is
// src/GeminiLive/Glic/NativeProtocol.cs.

/** The name the browser knows the host by (NativeProtocol.HostName in C#). */
export const NATIVE_HOST = "com.avi12.gemini_live";

export enum NativeMessage {
  Link = "link"
}

/** Where this run of the app listens, and the token its Hello carries. */
export interface LinkInfo {
  port: number;
  token: string;
}

export interface NativeProtocolMap {
  /** The running app's link; null when the app isn't running. */
  [NativeMessage.Link](): LinkInfo | null;
}
