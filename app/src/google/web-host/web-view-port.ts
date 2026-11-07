import type { BrowserCookie } from "@gemini-live/protocol/link";

// The part of a live WebView2 (a CoreWebView2 in its own window) the generic host uses, as plain
// shapes. winui-web-view.ts implements it over the generated bindings; the tests implement it with
// a fake, so everything above this file runs without a window.

export const ProcessFailureKind = {
  browserExited: "browserExited",
  other: "other"
} as const;
export type ProcessFailureKind = typeof ProcessFailureKind[keyof typeof ProcessFailureKind];

export const PermissionKind = {
  microphone: "microphone",
  camera: "camera",
  other: "other"
} as const;
export type PermissionKind = typeof PermissionKind[keyof typeof PermissionKind];

export const PermissionDecision = {
  allow: "allow",
  deny: "deny",
  default: "default"
} as const;
export type PermissionDecision = typeof PermissionDecision[keyof typeof PermissionDecision];

export interface WebViewCore {
  readonly source: string;
  navigate(url: string): void;
  reload(): void;
  postMessage(json: string): void;
  onMessage(listener: (json: string) => void): void;
  onProcessFailed(listener: (kind: ProcessFailureKind) => void): void;
  onPermission(decide: (kind: PermissionKind) => PermissionDecision): void;
  onNavigation(isAllowed: (uri: string) => boolean): void;
  injectScript(code: string): Promise<void>;
  // Answers every request matching the filter with an empty 204
  blockRequests(filter: string): void;
  setCookies(cookies: readonly BrowserCookie[]): void;
  // A DevTools protocol call; its result is not needed by any caller
  callDevTools(request: {
    method: string;
    params: object;
  }): Promise<void>;
}

export interface WebViewOptions {
  readonly isDebugging: boolean;
}

// Builds the window and control for one host. Every create() replaces the previous control, which
// a crashed browser process leaves unusable.
export interface WebViewFactory {
  create(options: WebViewOptions): Promise<WebViewCore>;
}
