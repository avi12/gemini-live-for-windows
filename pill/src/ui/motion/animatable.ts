export interface Animatable {
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): { cancel(): void };
}

export function isAnimatable(node: object): node is Animatable {
  return "animate" in node && typeof node.animate === "function";
}
