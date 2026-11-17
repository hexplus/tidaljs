/**
 * Small guards for asynchronous actions: one shared in-flight job, and
 * tickets that tell whether an awaited step is still the latest one asked
 * for (a Stop or a newer Play makes an older one stale).
 */

/** Calls to the returned function share the job in flight; once it settles, the next call starts a new one. */
export function singleFlight<T>(job: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    if (!running) {
      running = job().finally(() => {
        running = null;
      });
    }
    return running;
  };
}

/** A counter of requests: take() starts one, current(t) tells whether it is still the latest. */
export class Tickets {
  private last = 0;
  take(): number {
    return ++this.last;
  }
  /** Makes every ticket taken so far stale. */
  cancel(): void {
    this.last++;
  }
  current(ticket: number): boolean {
    return ticket === this.last;
  }
}
