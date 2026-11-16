/**
 * Converts a SuperCollider file without blocking the page: in a worker
 * (worker.ts), which is ended when the conversion is cancelled or takes too
 * long. Where there are no workers (Node, the tests), the same conversion runs
 * here, with the same time limit.
 */
import { convertSuperCollider, type Conversion } from "./index.ts";

export interface ConvertAsyncOptions {
  /** Cancels the conversion: the promise rejects and the worker is ended. */
  signal?: AbortSignal;
  /** How long the conversion may take, in milliseconds (30 s by default). */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/** What the page sends the worker. */
export interface WorkerRequest {
  source: string;
  fileName: string;
  /** The conversion's own time limit: a little less than the page's, so it can say where it stopped. */
  timeLimitMs: number;
}

/** What the worker answers: the conversion, or the message of its error. */
export type WorkerReply = { ok: true; result: Conversion } | { ok: false; error: string };

function cancelled(): Error {
  const err = new Error("The SuperCollider import was cancelled.");
  err.name = "AbortError";
  return err;
}

/**
 * Converts SuperCollider code to TidalJS code in a worker. Rejects with an Error that says why: a syntax error,
 * a file too large or too slow to convert, the conversion cancelled (`signal`) or past `timeoutMs` (the worker is
 * ended then), or a worker that could not start.
 */
export function convertSuperColliderAsync(source: string, fileName = "", options: ConvertAsyncOptions = {}): Promise<Conversion> {
  const { signal } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (signal?.aborted) return Promise.reject(cancelled());
  if (typeof Worker === "undefined") {
    return new Promise((resolve) => resolve(convertSuperCollider(source, fileName, { timeLimitMs: timeoutMs })));
  }
  return new Promise<Conversion>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      reject(new Error("The SuperCollider converter could not start: " + (err instanceof Error ? err.message : String(err))));
      return;
    }
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      done();
    };
    const onAbort = () => finish(() => reject(cancelled()));
    const timer = setTimeout(() => finish(() => reject(new Error(
      "The SuperCollider import was stopped: converting the file took longer than " + Math.round(timeoutMs / 1000) + " s.",
    ))), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      finish(() => (reply.ok ? resolve(reply.result) : reject(new Error(reply.error))));
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      finish(() => reject(new Error("The SuperCollider converter stopped: " + (event.message || "its worker failed") + ".")));
    };
    worker.onmessageerror = () => finish(() => reject(new Error("The SuperCollider converter's answer could not be read.")));
    const request: WorkerRequest = { source, fileName, timeLimitMs: Math.max(1000, timeoutMs - 1000) };
    worker.postMessage(request);
  });
}
