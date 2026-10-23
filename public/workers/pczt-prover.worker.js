// Web Worker (ES Module) for Offscreen Halo 2 Proof computation (ZIP-374 / ZIP-370)
// Runs in background thread without blocking the browser UI thread (60 FPS maintained).

import init, { client_prove_escrow_pczt, client_prewarm_prover, initThreadPool } from '/wasm/veilx_wallet.js';

let wasmInitialized = false;
let proverWarmed = false;
let threadPoolInitialized = false;

async function initWasm() {
  if (wasmInitialized) return;

  try {
    // Fetch the raw wasm bytes and initialize the module
    const wasmResponse = await fetch('/wasm/veilx_wallet_bg.wasm');
    const wasmArrayBuffer = await wasmResponse.arrayBuffer();

    await init({ module_or_path: wasmArrayBuffer });
    wasmInitialized = true;

    // Initialize Rayon thread pool for multi-threaded Halo2 proving
    if (!threadPoolInitialized && typeof initThreadPool === 'function') {
      try {
        if (self.crossOriginIsolated) {
          const threadCount = Math.min(navigator.hardwareConcurrency || 4, 8);
          console.log(`[ProverWorker] Initializing Rayon thread pool with ${threadCount} threads...`);
          await initThreadPool(threadCount);
          threadPoolInitialized = true;
          console.log(`[ProverWorker] Rayon thread pool initialized successfully with ${threadCount} threads.`);
        } else {
          console.warn('[ProverWorker] Environment is not crossOriginIsolated; Rayon multi-threading cannot start workers. Proof will run on single thread.');
        }
      } catch (poolErr) {
        console.warn('[ProverWorker] Failed to start Rayon thread pool (fallback to single thread):', poolErr);
      }
    }
  } catch (err) {
    throw new Error('Failed to initialize VeilX Wasm Prover: ' + (err.message || err));
  }
}

async function prewarmProver() {
  if (proverWarmed) return;
  await initWasm();
  try {
    if (typeof client_prewarm_prover === 'function') {
      client_prewarm_prover();
      proverWarmed = true;
    }
  } catch (e) {
    console.warn('[ProverWorker] Prover prewarm notice:', e);
  }
}

self.onmessage = async (event) => {
  const { id, type, params } = event.data;

  if (type === 'PING') {
    self.postMessage({ id, type: 'PONG' });
    return;
  }

  if (type === 'PREWARM') {
    prewarmProver()
      .then(() => self.postMessage({ id, type: 'WARMED' }))
      .catch((err) => self.postMessage({ id, type: 'WARM_ERROR', error: err.message }));
    return;
  }

  if (type === 'PROVE_ESCROW_PCZT') {
    try {
      self.postMessage({
        id,
        type: 'PROGRESS',
        stage: 'INITIALIZING_PROVER',
        percent: 15,
        message: 'Preparing secure transfer engine...',
      });

      await initWasm();

      self.postMessage({
        id,
        type: 'PROGRESS',
        stage: 'BUILDING_CIRCUIT',
        percent: 35,
        message: 'Preparing secure transfer...',
      });

      // Small tick to allow event loop dispatch
      await new Promise((r) => setTimeout(r, 50));

      const isMultiThreaded = threadPoolInitialized;
      console.log(`[ProverWorker] Starting Orchard Halo 2 proof computation (Multi-threading: ${isMultiThreaded ? 'ACTIVE' : 'INACTIVE'})...`);

      self.postMessage({
        id,
        type: 'PROGRESS',
        stage: 'COMPUTING_PROOF',
        percent: 50,
        message: isMultiThreaded
          ? 'Securing payment on your device (Multi-threaded ZK Prover)...'
          : 'Securing payment on your device...',
      });

      const startTime = Date.now();
      const provedResult = client_prove_escrow_pczt(params);
      const elapsedMs = Date.now() - startTime;

      self.postMessage({
        id,
        type: 'PROGRESS',
        stage: 'PROOF_COMPLETE',
        percent: 100,
        message: 'Transfer secured in ' + Math.round(elapsedMs / 1000) + 's!',
      });

      self.postMessage({
        id,
        type: 'SUCCESS',
        result: provedResult,
        elapsedMs,
      });
    } catch (error) {
      self.postMessage({
        id,
        type: 'ERROR',
        error: error.message || String(error),
      });
    }
  }
};
