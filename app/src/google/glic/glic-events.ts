export const GlicHostEventKind = {
  STATE: "state",
  CAPTION: "caption",
  NOTICE: "notice",
  FAILED: "failed",
  EXTENSION_NEEDED: "extensionNeeded"
} as const;

export type GlicHostEvent =
  | {
      readonly kind: typeof GlicHostEventKind.STATE;
      readonly isListening: boolean;
    }
  | {
      readonly kind: typeof GlicHostEventKind.CAPTION;
      readonly text: string;
      readonly isUser: boolean;
      readonly index: number;
    }
  | {
      readonly kind: typeof GlicHostEventKind.NOTICE;
      readonly notice: string;
    }
  | {
      readonly kind: typeof GlicHostEventKind.FAILED;
      readonly message: string;
    }
  // True while a session is wanted but the companion extension has never connected
  | {
      readonly kind: typeof GlicHostEventKind.EXTENSION_NEEDED;
      readonly isNeeded: boolean;
    };
