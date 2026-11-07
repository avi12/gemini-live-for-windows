import type { WebViewCore } from "./web-view-port.ts";

const DISPATCH_KEY = "Input.dispatchKeyEvent";
const DISPATCH_MOUSE = "Input.dispatchMouseEvent";

const MouseEventType = {
  pressed: "mousePressed",
  released: "mouseReleased"
} as const;

// Types text as trusted key events, one key down and up per character: synthetic input never
// enables Glic's Submit, and page scripts cannot make events trusted
export async function typeText({ core, text }: {
  core: WebViewCore;
  text: string;
}) {
  for (const key of text) {
    await core.callDevTools({
      method: DISPATCH_KEY,
      params: {
        type: "keyDown",
        text: key,
        unmodifiedText: key,
        key
      }
    });
    await core.callDevTools({
      method: DISPATCH_KEY,
      params: {
        type: "keyUp",
        key
      }
    });
  }
}

// The Home tiles ignore synthetic DOM clicks, so a click is a trusted mouse press and release
export async function clickAt({ core, x, y }: {
  core: WebViewCore;
  x: number;
  y: number;
}) {
  for (const type of Object.values(MouseEventType)) {
    await core.callDevTools({
      method: DISPATCH_MOUSE,
      params: {
        type,
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1
      }
    });
  }
}
