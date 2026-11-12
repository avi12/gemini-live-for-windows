import { regionSchema } from "@/contracts/monitor.ts";
import type { Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { ChipActionKind } from "@/overlays/circle/chips/chip.ts";
import type { Chip, ChipAction } from "@/overlays/circle/chips/chip.ts";
import { isOpenableUri } from "@/overlays/circle/chips/open-uri.ts";
import { createSelectionScan } from "@/overlays/circle/chips/selection-scan.ts";
import {
  CircleHint,
  GestureEffectKind,
  GestureEventKind,
  initialGesture,
  reduceGesture
} from "@/overlays/circle/gesture/gesture.ts";
import type { GestureEffect, GestureEvent, GestureState } from "@/overlays/circle/gesture/gesture.ts";
import { ocrWords } from "@/overlays/circle/gesture/ocr-words.ts";
import type { OcrLine, OverlayLog } from "@/overlays/ports.ts";
import { isSearchAction } from "@/overlays/protocol.ts";
import type { CircleAction, CircleOutcome, SearchCircle } from "@/overlays/protocol.ts";
import type { Rect, Size } from "@/overlays/shapes.ts";
import { pixelRegion, SelectionPhase } from "winui-svelte/selection";

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
  // What the settled selection holds: links, e-mail addresses, phone numbers and QR codes
  readonly chips: readonly Chip[];
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
  // Searches the web for the region (the still's pixels); whether the search page opened
  searchImage(options: SearchCircle): Promise<boolean>;
  // The decoded text of each QR code inside the region (the still's pixels)
  scanCodes(region: Region): Promise<readonly string[]>;
  // Opens a web page or a new message in the app Windows has for it; whether Windows started one
  openUri(uri: string): Promise<boolean>;
  // Runs the callback once after the delay; the returned function cancels it
  schedule(options: {
    callback: () => void;
    milliseconds: number;
  }): () => void;
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
      drawnIn: window,
      picture: still
    });
    return regionSchema.safeParse(region);
  };
}

// The selection worth reading for chips: a settled one, with nothing else going on
function scannableSelection(gesture: GestureState) {
  const isIdle = gesture.selector.phase === SelectionPhase.idle;
  const isBusy = gesture.isFinished || gesture.isTextMode || gesture.isAskOnRelease || gesture.isReading;
  const isScannable = isIdle && !isBusy;
  return isScannable ? gesture.selector.selection : undefined;
}

// Waits for something the overlay hands to another app (a search page, a link): the overlay is
// done once it worked, and a failure is logged and left for the caller to say
async function closeWhenDone({ attempt, failure, world }: {
  attempt: Promise<boolean>;
  failure: string;
  world: CircleWorld;
}) {
  const isDone = await attempt.catch((error: unknown) => {
    world.log.write(`circle: ${failure}: ${errorMessage(error)}`);
    return false;
  });
  if (isDone) {
    world.close({ isCancelled: true });
  }

  return isDone;
}

function createCircleTasks({ window, still, world, regionOf, dispatch }: {
  window: Size;
  still: Size;
  world: CircleWorld;
  regionOf: ReturnType<typeof createRegionParser>;
  dispatch: (event: GestureEvent) => void;
}) {
  async function search(options: SearchCircle) {
    const isDone = await closeWhenDone({
      attempt: world.searchImage(options),
      failure: "the image search failed",
      world
    });
    if (isDone) {
      return;
    }

    dispatch({ kind: GestureEventKind.searchFailed });
  }

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

    if (isSearchAction(action)) {
      void search({
        action,
        region: parsed.data
      });
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
      return undefined;
    });
    const isFailed = lines === undefined;
    if (isFailed) {
      dispatch({ kind: GestureEventKind.textFailed });
      return;
    }

    dispatch({
      kind: GestureEventKind.textRead,
      words: ocrWords({
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
  let chips: readonly Chip[] = [];
  const regionOf = createRegionParser({
    window,
    still
  });
  const tasks = createCircleTasks({
    window,
    still,
    world,
    regionOf,
    dispatch
  });

  function emit() {
    onView({
      gesture,
      hint: hint.view(),
      chips,
      landing: landings.current()
    });
  }

  const selectionScan = createSelectionScan({
    world,
    regionOf(selection) {
      const parsed = regionOf(selection);
      return parsed.success ? parsed.data : undefined;
    },
    onChips(found) {
      chips = found;
      emit();
    }
  });

  function publish() {
    selectionScan.watch(scannableSelection(gesture));
    emit();
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

  async function openChipTarget(uri: string) {
    const isOpenable = isOpenableUri(uri);
    if (!isOpenable) {
      world.log.write("circle: refused to open a link that is not a web page or a message");
      return;
    }

    const isDone = await closeWhenDone({
      attempt: world.openUri(uri),
      failure: "opening failed",
      world
    });
    if (isDone) {
      return;
    }

    hint.say({
      message: CircleHint.openFailed,
      isLasting: false
    });
    publish();
  }

  // A click on a chip's button: nothing opens or is copied before it
  function pressChip(action: ChipAction) {
    const isCopy = action.kind === ChipActionKind.copy;
    if (isCopy) {
      void tasks.copyText(action.target);
      return;
    }

    void openChipTarget(action.target);
  }

  publish();
  return {
    dispatch,
    pressChip,
    deactivated: () => cancelOnDeactivation({
      world,
      openedAt,
      dispatch
    })
  };
}
