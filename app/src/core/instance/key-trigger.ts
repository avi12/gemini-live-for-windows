// What the Copilot key / Win+C did. The names are the ?state= values declared on the
// copilotkeyprovider extension in package\AppxManifest.xml, and the text a second process sends
// the first over the activation pipe.
export const KeyTrigger = {
  TAP: "Tap",
  HOLD_START: "HoldStart",
  HOLD_STOP: "HoldStop"
} as const;
export type KeyTrigger = (typeof KeyTrigger)[keyof typeof KeyTrigger];

const TRIGGERS: readonly string[] = Object.values(KeyTrigger);

function isKeyTrigger(text: string): text is KeyTrigger {
  return TRIGGERS.includes(text);
}

export function parseKeyTrigger(text: string) {
  return isKeyTrigger(text) ? text : undefined;
}
