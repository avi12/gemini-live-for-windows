import { MENU_EXIT_STEPS, menuExitAt, Motion } from "@/ui/motion/motion.ts";
import { elementRef } from "winui-svelte";
import { CompositionBatchTypes } from "winui-svelte/bindings/microsoft/ui/composition/CompositionBatchTypes";
import type { CompositionVisual } from "winui-svelte/bindings/microsoft/ui/composition/Visual";
import type { Flyout } from "winui-svelte/bindings/microsoft/ui/xaml/controls/Flyout";
import type { MenuFlyout } from "winui-svelte/bindings/microsoft/ui/xaml/controls/MenuFlyout";
import type { DependencyObject } from "winui-svelte/bindings/microsoft/ui/xaml/DependencyObject";
import { ElementCompositionPreview } from "winui-svelte/bindings/microsoft/ui/xaml/hosting/ElementCompositionPreview";
import { VisualTreeHelper } from "winui-svelte/bindings/microsoft/ui/xaml/media/VisualTreeHelper";
import type { UIElement } from "winui-svelte/bindings/microsoft/ui/xaml/UIElement";

const TICKS_PER_MILLISECOND = 10_000;
const FIRST_ITEM = 0;
const LEVELS_BELOW_POPUP_ROOT = 2;
const TRANSLATION = "Translation";
const REST_SCALE = {
  x: 1,
  y: 1,
  z: 1
};
const REST_TRANSLATION = {
  x: 0,
  y: 0,
  z: 0
};
const MENU_PROPS = {
  placement: "Top",
  shouldConstrainToRootBounds: false
} as const;

function isCompositionTarget(node: DependencyObject): node is UIElement {
  return typeof node === "object";
}

function firstElementOf(flyout: Flyout | MenuFlyout) {
  const isMenuFlyout = "items" in flyout;
  if (isMenuFlyout) {
    return flyout.items?.getAt(FIRST_ITEM) ?? null;
  }

  return flyout.content ?? null;
}

function menuSurfaceOf(flyout: Flyout | MenuFlyout) {
  const chain: DependencyObject[] = [];
  let node: DependencyObject | null = firstElementOf(flyout);
  while (node !== null) {
    chain.push(node);
    node = VisualTreeHelper.getParent(node);
  }

  const surface = chain.at(-LEVELS_BELOW_POPUP_ROOT);
  const isSurfaceAnimatable = surface !== undefined && isCompositionTarget(surface);
  if (!isSurfaceAnimatable) {
    return null;
  }

  return surface;
}

function progressStops() {
  return Array.from({ length: MENU_EXIT_STEPS + 1 }, (_unused, iStep) => iStep / MENU_EXIT_STEPS);
}

function startExit({ surface, onDone }: {
  surface: UIElement;
  onDone(): void;
}) {
  const visual = ElementCompositionPreview.getElementVisual(surface);
  const { compositor, size } = visual;
  ElementCompositionPreview.setIsTranslationEnabled(surface, true);
  const linear = compositor.createLinearEasingFunction();
  const duration = { duration: BigInt(Motion.menuExitMilliseconds * TICKS_PER_MILLISECOND) };
  const fade = compositor.createScalarKeyFrameAnimation();
  const shrink = compositor.createVector3KeyFrameAnimation();
  const sink = compositor.createVector3KeyFrameAnimation();
  for (const progress of progressStops()) {
    const pose = menuExitAt(progress);
    fade.insertKeyFrame(progress, pose.opacity, linear);
    shrink.insertKeyFrame(progress, {
      ...REST_SCALE,
      x: pose.scale,
      y: pose.scale
    }, linear);
    sink.insertKeyFrame(progress, {
      ...REST_TRANSLATION,
      y: pose.sink
    }, linear);
  }

  for (const animation of [fade, shrink, sink]) {
    animation.duration = duration;
  }

  visual.centerPoint = {
    x: size.x / 2,
    y: size.y,
    z: 0
  };
  const batch = compositor.createScopedBatch(CompositionBatchTypes.Animation);
  visual.startAnimation("Opacity", fade);
  visual.startAnimation("Scale", shrink);
  visual.startAnimation(TRANSLATION, sink);
  batch.end();
  batch.onCompleted(onDone);
  return visual;
}

function restore(visual: CompositionVisual) {
  visual.opacity = 1;
  visual.scale = REST_SCALE;
  visual.properties.insertVector3(TRANSLATION, REST_TRANSLATION);
}

export function menuOf() {
  const flyout = elementRef<Flyout | MenuFlyout>();
  let isLeaving = false;
  let leaving: CompositionVisual | null = null;

  function onclosing(...[, args]: [unknown, { cancel: boolean }]) {
    const control = flyout.current;
    const isIgnored = isLeaving || control === undefined;
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
    leaving = startExit({
      surface,
      onDone: () => control.hide()
    });
  }

  function onclosed() {
    isLeaving = false;

    const visual = leaving;
    const isIdle = visual === null;
    if (isIdle) {
      return;
    }

    restore(visual);
    leaving = null;
  }

  return {
    props: {
      ...MENU_PROPS,
      onclosing,
      onclosed
    },
    attach: flyout.attach
  };
}
