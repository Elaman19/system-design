/** Pauses for `ms`; resolves early (and `stopped` turns true) when `stop()` is called. */
export class Stoppable {
  private stopped = false;
  private wake?: () => void;

  get isStopped() {
    return this.stopped;
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  sleep(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      this.wake = done;
      function done() {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}

/**
 * Runs `work` until it succeeds, pausing 1 s, 2 s, 4 s ... (capped at `maxDelayMs`)
 * between attempts. For consumers that must not skip a message: the offset stays
 * where it is until the work is done. Returns false if stopped before it succeeded.
 */
export async function retryUntilDone(
  work: () => Promise<void>,
  control: Stoppable,
  onError: (error: unknown, attempt: number) => void,
  maxDelayMs = 30_000,
): Promise<boolean> {
  for (let attempt = 1; !control.isStopped; attempt++) {
    try {
      await work();
      return true;
    } catch (error) {
      onError(error, attempt);
      await control.sleep(Math.min(1000 * 2 ** (attempt - 1), maxDelayMs));
    }
  }
  return false;
}
