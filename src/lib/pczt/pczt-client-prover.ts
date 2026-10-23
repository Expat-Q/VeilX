/**
 * Client-Side PCZT Halo 2 Prover Service (ZIP-374)
 * Orchestrates background Web Worker execution for shielded escrow claims.
 */

export interface ProverProgress {
  stage: string;
  percent: number;
  message: string;
}

export interface ClientProvedPczt {
  sighash_hex: string;
  proof_hex: string;
  actions: Array<{
    cv_net_hex: string;
    nullifier_hex: string;
    rk_hex: string;
    cmx_hex: string;
    epk_hex: string;
    enc_ciphertext_hex: string;
    out_ciphertext_hex: string;
  }>;
  anchor_hex: string;
  flags: number;
  value_balance_zatoshis: number;
}

// Persistent shared worker instance to retain warmed proving key in WASM memory
let globalProverWorker: Worker | null = null;
let isWarming = false;
let isWarmed = false;

function getSharedWorker(): Worker | null {
  if (typeof window === "undefined" || !window.Worker) return null;
  if (!globalProverWorker) {
    try {
      globalProverWorker = new Worker("/workers/pczt-prover.worker.js", { type: "module" });
    } catch (e) {
      console.warn("[PCZT Prover] Failed to instantiate shared worker:", e);
    }
  }
  return globalProverWorker;
}

/**
 * Pre-warms the proving key in the background during idle time (e.g. on dashboard load)
 * so that when the user clicks 'Claim', the circuit generation phase is already complete.
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

export async function proveEscrowPcztInWorker(
  params: any,
  onProgress?: (progress: ProverProgress) => void
): Promise<{ result: ClientProvedPczt; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = getSharedWorker();
    if (!worker) {
      return reject(new Error("Web Workers are not supported in this environment"));
    }

    const taskId = "pczt_" + Math.random().toString(36).substring(2, 9);

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
        resolve({ result, elapsedMs });
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

    // Dispatch proving request to Web Worker
    worker.postMessage({
      id: taskId,
      type: "PROVE_ESCROW_PCZT",
      params,
    });
  });
}
