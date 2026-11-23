// The observables Glic's host API hands out: Glic subscribes to each and expects the current value
// at once, then every change.

type Subscriber<T> = (value: T) => void;
interface Subscription {
  unsubscribe(): void;
}
interface Observable<T> {
  subscribe(change: Subscriber<T>): Subscription;
}

/** Calls a subscriber, isolating us from its errors. */
export function notify<T>({ subscriber, value }: { subscriber: (value: T) => unknown; value: T }) {
  try {
    subscriber(value);
  } catch {
    // A subscriber's error is its own.
  }
}

/** An observable that never changes. */
export function observable<T>(value: T) {
  return {
    subscribe(change: Subscriber<T>) {
      notify({
        subscriber: change,
        value
      });
      return { unsubscribe() {} };
    }
  } satisfies Observable<T>;
}

export function settableObservable<T>(initial: T) {
  let value = initial;
  const subscribers: Subscriber<T>[] = [];
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const subscriber of subscribers) {
        notify({
          subscriber,
          value: next
        });
      }
    },
    subscribe(change: Subscriber<T>) {
      subscribers.push(change);
      notify({
        subscriber: change,
        value
      });
      return {
        unsubscribe() {
          const index = subscribers.indexOf(change);
          if (index >= 0) {
            subscribers.splice(index, 1);
          }
        }
      };
    }
  };
}
