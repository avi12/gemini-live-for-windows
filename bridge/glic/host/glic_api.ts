// Glic host API enums we answer with, values from Chromium's glic_api_generated.ts, and the panel
// state both the host and its bootstrap report.

enum PanelStateKind {
  ATTACHED = 2
}
/** LINUX is what the original port reported; kept as is. */
export enum Platform {
  LINUX = 3
}
export enum FormFactor {
  DESKTOP = 1
}
export enum HostCapability {
  MULTI_INSTANCE = 3,
  PDF_ZERO_STATE = 7,
  INVOKE = 8
}

export const TAB_ID = "desktop";
export const PANEL_STATE = {
  kind: PanelStateKind.ATTACHED,
  windowId: TAB_ID
};
