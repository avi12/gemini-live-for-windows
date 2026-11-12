import type { CircleOutcome } from "@/overlays/protocol.ts";

// How long the overlay window gets to measure itself and start the controller before it is given up
// on. Without a size there is no controller, so none of the keys or buttons could ever close it
export const CIRCLE_START_MILLISECONDS = 5000;

export const CIRCLE_START_FAILURE = "the overlay window never reported a size";

// When the overlay window is up and when it is over. Closing is idempotent: Esc, the controller, the
// start timeout and a failed placement can each ask for it, and the keys go back and the window is
// unmounted exactly once, by whichever asks first
export function createCircleLifecycle({ releaseKeys, unmount, schedule }: {
  // Gives back every key the overlay held
  releaseKeys: () => void;
  unmount: () => void;
  // Runs `callback` once after `milliseconds`; the returned function cancels it
  schedule: (options: {
    callback: () => void;
    milliseconds: number;
  }) => () => void;
}) {
  const answer = Promise.withResolvers<CircleOutcome>();
  let isClosed = false;

  // The keys go back before the answer, so the caller can take Esc for itself the moment it
  // hears it; the window is gone by then too
  function close(outcome: CircleOutcome) {
    if (isClosed) {
      return;
    }

    isClosed = true;
    cancelStart();
    releaseKeys();
    unmount();
    answer.resolve(outcome);
  }

  function fail(error: string) {
    close({
      isCancelled: true,
      error
    });
  }

  const cancelStart = schedule({
    callback: () => fail(CIRCLE_START_FAILURE),
    milliseconds: CIRCLE_START_MILLISECONDS
  });

  return {
    answer: answer.promise,
    close,
    fail,
    // The controller exists: the window is usable, so the start timeout is no longer needed
    started: cancelStart
  };
}
