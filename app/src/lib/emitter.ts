// A set of listeners for one event type; subscribe() hands back the way to unsubscribe
export function createEmitter<TEvent>() {
  const listeners = new Set<(event: TEvent) => void>();

  function subscribe(listener: (event: TEvent) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function emit(event: TEvent) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  return {
    subscribe,
    emit
  };
}

// A promise settled from outside. A rejection nobody awaits yet is marked handled, so a failure
// that arrives after the caller stopped waiting does not become an unhandled rejection.
export function createDeferred<T>() {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  promise.catch(() => undefined);
  return {
    promise,
    resolve,
    reject
  };
}
