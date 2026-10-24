/**
 * Client-Side Web Worker Prover Client (ZIP-374 / ZIP-225)
 * Dispatches Halo 2 Zero-Knowledge proving tasks to the background Web Worker
 * without freezing the browser UI thread (maintaining 60 FPS).
 */

import {
  ShieldingPcztParams,
  ProverWorkerProgressOutput,
  ProverWorkerSuccessOutput,
  ProverWorkerMessageOutput,
  OrchardActionBundle,
} from "@/types/pczt";

let globalProverWorker: Worker | null = null;
let isWarming = false;
let isWarmed = false;

export function getSharedWorker(): Worker | null {
  if (typeof window === "undefined" || !window.Worker) return null;
  if (!globalProverWorker) {
    try {
      globalProverWorker = new Worker("/workers/pczt-prover.worker.js", {
        type: "module",
      });
    } catch (e) {
      console.warn("[PCZT Prover Client] Failed to instantiate shared worker:", e);
    }
  }
  return globalProverWorker;
}

/**
 * Pre-warms the proving key in the background during idle time (e.g. on page load)
 * so that when proof computation is triggered, memory allocation is already warm.
 */
export function prewarmProverInBackground(): void {
  if (typeof window === "undefined" || isWarmed || isWarming) return;
  const worker = getSharedWorker();
  if (!worker) return;

  isWarming = true;
  const warmId = "warm_" + Math.random().toString(36).substring(2, 7);

  const handler = (event: MessageEvent) => {
    if (event.data?.id === warmId) {
      worker.removeEventListener("message", handler);
      isWarming = false;
      if (event.data.type === "WARMED") {
        isWarmed = true;
      }
    }
  };

  worker.addEventListener("message", handler);
  worker.postMessage({ id: warmId, type: "PREWARM" });
}

/**
 * Execute client-side Halo 2 proving for Shielding ($t \to z$) transactions via Web Worker.
 * Follows Contract B: accepts ShieldingPcztParams, emits progress, and returns ProverWorkerSuccessOutput.
 */
export async function proveShieldingInWorker(
  params: ShieldingPcztParams,
  onProgress?: (progress: ProverWorkerProgressOutput) => void
): Promise<ProverWorkerSuccessOutput> {
  return new Promise((resolve, reject) => {
    const worker = getSharedWorker();
    if (!worker) {
      return reject(new Error("Web Workers are not supported in this environment"));
    }

    const taskId = "shield_" + Math.random().toString(36).substring(2, 9);

    // 600s (10-minute) safety timeout for Halo 2 proof
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error("Halo 2 proof generation timed out after 600s"));
    }, 600000);

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      worker.removeEventListener("message", messageHandler);
      worker.removeEventListener("error", errorHandler);
    };

    const messageHandler = (event: MessageEvent<any>) => {
      const data = event.data;
      if (!data || data.id !== taskId) return;

      if (data.type === "PROGRESS") {
        if (onProgress) {
          onProgress({
            type: "PROGRESS",
            stage: data.stage,
            percent: data.percent,
            message: data.message,
          });
        }
      } else if (data.type === "SUCCESS") {
        cleanup();
        isWarmed = true;
        resolve({
          type: "SUCCESS",
          orchardActionBundle: data.orchardActionBundle,
          pcztSignedHex: data.pcztSignedHex,
        });
      } else if (data.type === "ERROR") {
        cleanup();
        reject(new Error(data.error || "Unknown worker error during proof generation"));
      }
    };

    const errorHandler = (err: ErrorEvent) => {
      cleanup();
      reject(new Error("Worker error: " + (err.message || "Failed to execute worker")));
    };

    worker.addEventListener("message", messageHandler);
    worker.addEventListener("error", errorHandler);

    // Initial progress tick
    if (onProgress) {
      onProgress({
        type: "PROGRESS",
        stage: "INIT",
        percent: 5,
        message: "Starting client-side proving worker...",
      });
    }

    // Dispatch proving request to Web Worker conforming to Contract B
    worker.postMessage({
      id: taskId,
      action: "PROVE_SHIELDING",
      type: "PROVE_SHIELDING",
      params,
    });
  });
}

/**
 * Legacy compatibility adapter for existing callers of proveEscrowPcztInWorker.
 */
export async function proveEscrowPcztInWorker(
  params: any,
  onProgress?: (progress: { stage: string; percent: number; message: string }) => void
): Promise<{ result: any; elapsedMs: number }> {
  // If params look like ShieldingPcztParams, route through proveShieldingInWorker
  if (params && (params.transparentUtxo || params.recipientRawOrchardHex || params.payoutValueZats)) {
    const start = Date.now();
    const res = await proveShieldingInWorker(params, (p) => {
      if (onProgress) {
        onProgress({ stage: p.stage, percent: p.percent, message: p.message });
      }
    });
    return {
      result: res.orchardActionBundle,
      elapsedMs: Date.now() - start,
    };
  }

  // Otherwise, use legacy message type
  return new Promise((resolve, reject) => {
    const worker = getSharedWorker();
    if (!worker) {
      return reject(new Error("Web Workers are not supported in this environment"));
    }

    const taskId = "pczt_" + Math.random().toString(36).substring(2, 9);
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error("Halo 2 proof generation timed out after 600s"));
    }, 600000);

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      worker.removeEventListener("message", messageHandler);
      worker.removeEventListener("error", errorHandler);
    };

    const messageHandler = (event: MessageEvent) => {
      const { id, type, stage, percent, message, result, elapsedMs, error } = event.data || {};
      if (id !== taskId) return;

      if (type === "PROGRESS") {
        if (onProgress) {
          onProgress({ stage, percent, message });
        }
      } else if (type === "SUCCESS") {
        cleanup();
        isWarmed = true;
        resolve({ result, elapsedMs: elapsedMs || 0 });
      } else if (type === "ERROR") {
        cleanup();
        reject(new Error(error || "Unknown worker error during proof generation"));
      }
    };

    const errorHandler = (err: ErrorEvent) => {
      cleanup();
      reject(new Error("Worker error: " + (err.message || "Failed to execute worker")));
    };

    worker.addEventListener("message", messageHandler);
    worker.addEventListener("error", errorHandler);

    worker.postMessage({
      id: taskId,
      type: "PROVE_ESCROW_PCZT",
      params,
    });
  });
}
