import { elementRef } from "winui-svelte";
import type { CompositionVisual } from "winui-svelte/bindings/microsoft/ui/composition/Visual";
import type { Flyout } from "winui-svelte/bindings/microsoft/ui/xaml/controls/Flyout";
import type { MenuFlyout } from "winui-svelte/bindings/microsoft/ui/xaml/controls/MenuFlyout";

import { choosableItemsOf } from "./choosable-items.ts";
import { menuSurfaceOf, restoreMenuSurface, startMenuExit } from "./menu-exit.ts";

// A menu closed by choosing an item goes at once, as Windows' own menus do: fading and sinking away
// after a click made it feel as if the click had not landed. Dismissed (a click elsewhere, Escape),
// it leaves with the exit motion.
export function menuOf() {
  const flyout = elementRef<Flyout | MenuFlyout>();
  let isLeaving = false;
  let leaving: CompositionVisual | null = null;
  let isChosen = false;
  let stopListening: (() => void)[] = [];

  function choose() {
    isChosen = true;
  }

  function forgetChoices() {
    for (const stop of stopListening) {
      stop();
    }

    stopListening = [];
  }

  function onopened() {
    forgetChoices();
    const control = flyout.current;
    const isMenu = control !== undefined && "items" in control;
    if (!isMenu) {
      return;
    }

    for (const item of choosableItemsOf(control.items)) {
      stopListening.push(item.onClick(choose));
    }
  }

  function onclosing(...[, args]: [unknown, { cancel: boolean }]) {
    const control = flyout.current;
    const isIgnored = isLeaving || isChosen || control === undefined;
    if (isIgnored) {
      return;
    }

    const surface = menuSurfaceOf(control);
    const isSurfaceMissing = surface === null;
    if (isSurfaceMissing) {
      return;
    }

    args.cancel = true;
    isLeaving = true;
    leaving = startMenuExit({
      surface,
      onDone: () => control.hide()
    });
  }

  function onclosed() {
    isLeaving = false;
    isChosen = false;
    forgetChoices();

    const visual = leaving;
    const isIdle = visual === null;
    if (isIdle) {
      return;
    }

    restoreMenuSurface(visual);
    leaving = null;
  }

  return {
    props: {
      placement: "Top" as const,
      shouldConstrainToRootBounds: false,
      onopened,
      onclosing,
      onclosed
    },
    attach: flyout.attach
  };
}
