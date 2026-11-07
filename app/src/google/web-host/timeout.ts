// Gives one send its own, shorter deadline than the messenger's: the messenger has a single
// timeout, while a text action legitimately waits far longer than a readiness poll
export function withinMs<TResult>({ work, durationMs, label }: {
  work: Promise<TResult>;
  durationMs: number;
  label: string;
}) {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`No reply to "${label}" in ${durationMs} ms`)), durationMs);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

export function delay(durationMs: number) {
  return new Promise<void>(resolve => setTimeout(resolve, durationMs));
}
