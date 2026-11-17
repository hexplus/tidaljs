/**
 * The SuperCollider importer in a worker: the editor's page stays responsive
 * while a file converts, and client.ts can stop a conversion (cancelled, or
 * past its time limit) by ending the worker. One worker converts one file.
 */
import type { WorkerReply, WorkerRequest } from "./client.ts";
import { convertSuperCollider } from "./index.ts";

// The worker's global scope (the project's types are the page's, so it is typed here).
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(reply: WorkerReply): void;
};

scope.onmessage = (event) => {
  const { source, fileName, timeLimitMs } = event.data;
  let reply: WorkerReply;
  try {
    reply = { ok: true, result: convertSuperCollider(source, fileName, { timeLimitMs }) };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  scope.postMessage(reply);
};
