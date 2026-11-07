// Time and timers as a value, so everything that polls can be driven by a fake in tests
export interface Clock {
  now(): number;
  setInterval(tick: () => void, milliseconds: number): () => void;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  setInterval(tick, milliseconds) {
    const timer = setInterval(tick, milliseconds);
    return () => clearInterval(timer);
  }
};
