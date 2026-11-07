export const GlicHostEventKind = {
  state: "state",
  caption: "caption",
  notice: "notice",
  failed: "failed",
  extensionNeeded: "extensionNeeded"
} as const;

export type GlicHostEvent =
  | {
    readonly kind: typeof GlicHostEventKind.state;
    readonly isListening: boolean;
  }
  | {
    readonly kind: typeof GlicHostEventKind.caption;
    readonly text: string;
    readonly isUser: boolean;
    readonly index: number;
  }
  | {
    readonly kind: typeof GlicHostEventKind.notice;
    readonly notice: string;
  }
  | {
    readonly kind: typeof GlicHostEventKind.failed;
    readonly message: string;
  }
  // True while a session is wanted but the companion extension has never connected
  | {
    readonly kind: typeof GlicHostEventKind.extensionNeeded;
    readonly isNeeded: boolean;
  };
