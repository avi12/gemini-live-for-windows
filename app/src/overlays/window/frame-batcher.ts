// Applies only the latest value once per frame. A mouse reports far more often than a frame is
// drawn, and every update of the window crosses dynwinrt call by call, so the pointer's moves are
// folded into one update per frame; the reducer still sees every move.
export function createFrameBatcher<T>({
  requestFrame,
  apply
}: {
  requestFrame: (callback: () => void) => void;
  apply: (value: T) => void;
}) {
  let pending: { readonly value: T } | undefined;
  let isScheduled = false;

  function flush() {
    isScheduled = false;

    const current = pending;
    const isNothingPending = current === undefined;
    if (isNothingPending) {
      return;
    }

    pending = undefined;
    apply(current.value);
  }

  function push(value: T) {
    pending = { value };

    if (isScheduled) {
      return;
    }

    isScheduled = true;
    requestFrame(flush);
  }

  return { push };
}
