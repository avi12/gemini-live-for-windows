// Each page bridge runs in the top frame only, and installs once even if it is injected again.

/** The window flag each bridge sets once it is installed. */
export const BridgeFlag = {
  GLIC: "glicBridgeInstalled",
  HOME: "homeBridgeInstalled"
} as const;
type BridgeFlag = (typeof BridgeFlag)[keyof typeof BridgeFlag];

declare global {
  interface Window {
    glicBridgeInstalled?: boolean;
    homeBridgeInstalled?: boolean;
  }
}

/** Claims the page for a bridge: true the first time in the top frame, false anywhere else. */
export function claimTopWindow(flag: BridgeFlag) {
  const isFirstInstallInTopWindow = !window[flag] && window.top === window;
  if (isFirstInstallInTopWindow) {
    window[flag] = true;
  }

  return isFirstInstallInTopWindow;
}
