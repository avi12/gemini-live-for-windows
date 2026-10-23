type TimerHandle = ReturnType<typeof setTimeout>;

// Wrapped, not referenced: calling a bare setTimeout as a method (e.g. `clock.set(...)`) binds
// `this` to the wrapping object, which the service worker rejects with "Illegal invocation".
const clock = {
  clear: (handle: TimerHandle) => clearTimeout(handle),
  set: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs)
};

/**
 * Owns one connection and one retry timer. In particular, an alarm can reconnect while a
 * close-handler retry is pending; `ensure` cancels that retry so it cannot create a second live
 * socket later. Close events from superseded connections are ignored for the same reason.
 */
export class ReconnectController<Connection> {
  private currentConnection: Connection | undefined;
  private retry: TimerHandle | undefined;

  constructor(
    private readonly connect: () => Connection,
    private readonly isActive: (connection: Connection) => boolean,
    private readonly delayMs: number
  ) {}

  /** The live (or connecting) connection, if any. */
  get current(): Connection | undefined {
    return this.currentConnection;
  }

  /** Connects unless the current connection is still active. Never stacks connections. */
  ensure(): void {
    if (this.currentConnection !== undefined && this.isActive(this.currentConnection)) {
      return;
    }

    this.cancelRetry();
    this.currentConnection = this.connect();
  }

  /** Reports that `connection` closed; schedules one retry if it was the current one. */
  disconnected(connection: Connection): void {
    if (this.currentConnection !== connection) {
      return;
    }

    this.currentConnection = undefined;

    if (this.retry !== undefined) {
      return;
    }

    this.retry = clock.set(() => {
      this.retry = undefined;
      this.ensure();
    }, this.delayMs);
  }

  private cancelRetry(): void {
    if (this.retry === undefined) {
      return;
    }

    clock.clear(this.retry);
    this.retry = undefined;
  }
}
