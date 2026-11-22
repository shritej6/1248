import type { RehearsalResult } from "@vision/core";

export class RehearsalWorkerError extends Error {
  constructor(readonly detail: string) {
    super(`The rehearsal worker failed: ${detail}`);
    this.name = "RehearsalWorkerError";
  }
}

export type RunRehearsal = (seed: number) => Promise<RehearsalResult>;

export const runInWorker: RunRehearsal = (seed) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./rehearsal.worker.ts", import.meta.url), { type: "module" });
    const fail = (detail: string) => {
      worker.terminate();
      reject(new RehearsalWorkerError(detail));
    };
    worker.onmessage = (event: MessageEvent<RehearsalResult>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      fail(event.message);
    };
    worker.onmessageerror = () => {
      fail("the result could not be read");
    };
    worker.postMessage({ seed });
  });
