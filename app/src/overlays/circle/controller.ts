import { regionSchema } from "@/contracts/monitor.ts";
import type { Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { pixelRegion, textWords } from "@/overlays/circle/gesture/geometry.ts";
import {
  GestureEffectKind,
  GestureEventKind,
  initialGesture,
  reduceGesture
} from "@/overlays/circle/gesture/gesture.ts";
import type { GestureEffect, GestureEvent, GestureState } from "@/overlays/circle/gesture/gesture.ts";
import type { OcrLine, OverlayLog } from "@/overlays/ports.ts";
import type { CircleAction, CircleOutcome } from "@/overlays/protocol.ts";
import type { Rect, Size } from "@/overlays/shapes.ts";

// How long after opening a deactivation is still just Windows settling, not the user leaving
export const CIRCLE_SETTLE_MILLISECONDS = 800;

export interface CircleHintView {
  readonly text: string;
  readonly isVisible: boolean;
  // A lasting hint (the how-to) stays until told otherwise; a notice ("Copied") the window fades itself
  readonly isLasting: boolean;
  // Changes for each hint said, so the window restarts a notice's fade
  readonly revision: number;
}

// Everything the overlay window draws, in one value the window renders
export interface CircleView {
  readonly gesture: GestureState;
  readonly hint: CircleHintView;
  // The selection that just landed, for the sheen and the brackets' settle; the revision changes
  // for each landing so the window replays the motion
  readonly landing: {
    readonly area: Rect;
    readonly revision: number;
  } | undefined;
}

export interface CircleWorld {
  // OCR of the still inside the region (the still's pixels), or all of it
  readText(region: Region | null): Promise<readonly OcrLine[]>;
  // Puts the text on the clipboard; false when another app has it locked
  copyText(text: string): Promise<boolean>;
  // Ctrl+C is held only while words are picked
  holdCopyKey(isHeld: boolean): void;
  // The overlay is done: hide it, release its keys, answer
  close(outcome: CircleOutcome): void;
  now(): number;
  log: OverlayLog;
}

function createHint(text: string) {
  let hint: CircleHintView = {
    text,
    isVisible: true,
    isLasting: true,
    revision: 0
  };

  function hide() {
    hint = {
      ...hint,
      isVisible: false
    };
  }

  function say({ message, isLasting }: {
    message: string;
    isLasting: boolean;
  }) {
    hint = {
      text: message,
      isVisible: true,
      isLasting,
      revision: hint.revision + 1
    };
  }

  return {
    view: () => hint,
    hide,
    say
  };
}

function createRegionParser({ window, still }: {
  window: Size;
  still: Size;
}) {
  return (selection: Rect) => {
    const region = pixelRegion({
      selection,
      window,
      still
    });
    return regionSchema.safeParse(region);
  };
}

function createCircleTasks({ window, still, world, dispatch }: {
  window: Size;
  still: Size;
  world: CircleWorld;
  dispatch: (event: GestureEvent) => void;
}) {
  const regionOf = createRegionParser({
    window,
    still
  });

  function finish({ action, selection }: {
    action: CircleAction;
    selection: Rect;
  }) {
    const parsed = regionOf(selection);
    if (!parsed.success) {
      world.log.write("circle: the selection is off the still");
      world.close({ isCancelled: true });
      return;
    }

    world.close({
      isCancelled: false,
      action,
      region: parsed.data
    });
  }

  async function readText(selection: Rect | undefined) {
    const parsed = selection === undefined ? undefined : regionOf(selection);
    const region = parsed?.success === true ? parsed.data : null;
    const lines = await world.readText(region).catch((error: unknown) => {
      world.log.write(`circle: reading text failed: ${errorMessage(error)}`);
      return [];
    });
    dispatch({
      kind: GestureEventKind.textRead,
      words: textWords({
        lines,
        still,
        window
      })
    });
  }

  async function copyText(text: string) {
    const isCopied = await world.copyText(text);
    dispatch({
      kind: GestureEventKind.copyDone,
      isCopied
    });
  }

  return {
    finish,
    readText,
    copyText
  };
}

function performEffect({ effect, world, tasks, hint, onSnapIn }: {
  effect: GestureEffect;
  world: CircleWorld;
  tasks: ReturnType<typeof createCircleTasks>;
  hint: ReturnType<typeof createHint>;
  onSnapIn: (area: Rect) => void;
}) {
  switch (effect.kind) {
    case GestureEffectKind.cancel:
      world.close({ isCancelled: true });
      return;
    case GestureEffectKind.finish:
      tasks.finish({
        action: effect.action,
        selection: effect.selection
      });
      return;
    case GestureEffectKind.readText:
      void tasks.readText(effect.selection);
      return;
    case GestureEffectKind.copyText:
      void tasks.copyText(effect.text);
      return;
    case GestureEffectKind.say:
      hint.say(effect);
      return;
    case GestureEffectKind.hideHint:
      hint.hide();
      return;
    case GestureEffectKind.snapIn:
      onSnapIn(effect.area);
      return;
    case GestureEffectKind.setCopyKey:
      world.holdCopyKey(effect.isRegistered);
      return;
  }
}

// Switching away cancels: a frozen, topmost screen the user can no longer reach would otherwise
// sit over everything. Not in the first moments, though: the hotkey's own key releases and our
// grab of the foreground make Windows shuffle activation as the overlay opens
function cancelOnDeactivation({ world, openedAt, dispatch }: {
  world: CircleWorld;
  openedAt: number;
  dispatch: (event: GestureEvent) => void;
}) {
  const isSettling = world.now() - openedAt < CIRCLE_SETTLE_MILLISECONDS;
  if (isSettling) {
    world.log.write("circle: ignored a deactivation while opening");
    return;
  }

  world.log.write("circle: cancelled by switching away");
  dispatch({ kind: GestureEventKind.cancel });
}

function createLandings() {
  let landing: CircleView["landing"];
  let revision = 0;

  return {
    current: () => landing,
    snapIn(area: Rect) {
      revision += 1;
      landing = {
        area,
        revision
      };
    }
  };
}

interface CircleControllerOptions {
  // The overlay's size in DIPs: the whole monitor
  window: Size;
  // The frozen still's size in physical pixels
  still: Size;
  isAskOnRelease: boolean;
  // The how-to shown until the first loop starts
  hintText: string;
  world: CircleWorld;
  onView: (view: CircleView) => void;
}

// Owns the circle overlay's state between the window and the world: runs the gesture reducer,
// does what its effects ask (OCR, clipboard, keys, closing) and keeps the hint chip. The window is
// a view of `onView`.
export function createCircleController(options: CircleControllerOptions) {
  const { window, still, isAskOnRelease, hintText, world, onView } = options;
  const openedAt = world.now();
  let gesture: GestureState = initialGesture({
    screen: window,
    isAskOnRelease
  });
  const landings = createLandings();
  const hint = createHint(hintText);
  const tasks = createCircleTasks({
    window,
    still,
    world,
    dispatch
  });

  function publish() {
    onView({
      gesture,
      hint: hint.view(),
      landing: landings.current()
    });
  }

  function dispatch(event: GestureEvent) {
    const step = reduceGesture({
      state: gesture,
      event
    });
    gesture = step.state;
    for (const effect of step.effects) {
      performEffect({
        effect,
        world,
        tasks,
        hint,
        onSnapIn: landings.snapIn
      });
    }

    publish();
  }

  publish();
  return {
    dispatch,
    deactivated: () => cancelOnDeactivation({
      world,
      openedAt,
      dispatch
    })
  };
}
