type FoldListener = (isCollapsed: boolean) => void;

// Plain callbacks, not state: who is told of a fold is never rendered
const foldListeners = new Set<FoldListener>();

// Told the moment a fold or unfold is applied, before layout, so the capsule's glide can start in
// the same frame as the change of contents
export function onFoldChange(listener: FoldListener) {
  foldListeners.add(listener);
  return () => {
    foldListeners.delete(listener);
  };
}

export function announceFold(isCollapsed: boolean) {
  for (const listener of foldListeners) {
    listener(isCollapsed);
  }
}
