// WebZjs wasm_thread Worker for Chrome Extension Manifest V3
import init, { wasm_thread_entry_point } from "./webzjs_wallet.js";

self.onmessage = async (event) => {
  const [module, memory, work, thread_key] = event.data;
  try {
    await init(module, memory);
    wasm_thread_entry_point(work);
  } catch (err) {
    console.error("[VeilX Wasm Worker] Thread execution error:", err);
    setTimeout(() => {
      throw err;
    });
    throw err;
  }
};
