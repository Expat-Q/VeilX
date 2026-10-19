import fs from "fs";
import path from "path";

// Types for trial-decrypted notes from the Wasm engine
export interface DecryptedEscrowNote {
  recipient_address_hex: string;
  value_zatoshis: number;
  memo_text: string;
  memo_hex: string;
  rho_hex: string;
  rseed_hex: string;
  is_change: boolean;
  txid?: string;
  block_height?: number;
}

export interface CompactActionInput {
  nullifier_hex: string;
  cmx_hex: string;
  epk_hex: string;
  enc_ciphertext_hex: string;
}

export interface EscrowVerificationResult {
  verified: boolean;
  reason?: string;
  decryptedNote?: DecryptedEscrowNote;
  actualAmountZec?: number;
}

let wasmEngine: any = null;
let initPromise: Promise<any> | null = null;

/**
 * Initializes the native VeilX WebAssembly engine in Node.js runtime.
 */
export async function getWasmEngine() {
  if (wasmEngine) return wasmEngine;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Locate the Wasm binary relative to project root
      const wasmPath = path.resolve(process.cwd(), "crates/veilx-wallet/pkg/veilx_wallet_bg.wasm");
      const jsPath = path.resolve(process.cwd(), "crates/veilx-wallet/pkg/veilx_wallet.js");

      if (!fs.existsSync(wasmPath) || !fs.existsSync(jsPath)) {
        console.warn("[UFVK Watcher] VeilX Wasm artifacts not found at crates/veilx-wallet/pkg");
        return null;
      }

      // Dynamic import of the wasm-pack generated ES module (bypass Webpack static analysis)
      const dynamicImport = new Function("specifier", "return import(specifier)");
      const wasmModule = await dynamicImport(`file://${jsPath.replace(/\\/g, "/")}`);
      const wasmBuffer = fs.readFileSync(wasmPath);
      await wasmModule.default(wasmBuffer);

      wasmEngine = wasmModule;
      console.log("[UFVK Watcher] ✓ Native VeilX Wasm engine initialized for escrow backend");
      return wasmEngine;
    } catch (err: any) {
      console.warn("[UFVK Watcher] Failed to initialize Wasm engine:", err?.message || err);
      return null;
    }
  })();

  return initPromise;
}

/**
 * Event-Driven UFVK Escrow Watcher (ZIP-316 & ZIP-307)
 * Enables watch-only escrow verification using Unified Full Viewing Keys.
 * Zero spending keys are ever stored or exposed on the backend server.
 */
export class UFVKWatcherService {
  private platformUfvk: string | null = null;
  private orchardFvkHex: string | null = null;
  private transparentFvkHex: string | null = null;
  private detectedNotes: Map<string, DecryptedEscrowNote> = new Map();

  constructor() {
    // Read platform watch-only UFVK from environment if present
    const envUfvk = process.env.ESCROW_PLATFORM_UFVK || process.env.ZCASH_ESCROW_UFVK || null;
    if (envUfvk) {
      this.setPlatformUFVK(envUfvk).catch((e) => {
        console.warn("[UFVK Watcher] Failed to parse environment UFVK:", e?.message);
      });
    }
  }

  /**
   * Sets the platform's watch-only Unified Full Viewing Key (Bech32m encoded uview/uviewtest).
   */
  async setPlatformUFVK(ufvk: string): Promise<boolean> {
    const engine = await getWasmEngine();
    if (!engine) {
      throw new Error("Wasm engine unavailable for UFVK parsing");
    }

    try {
      const decoded = engine.decode_unified_full_viewing_key(ufvk);
      if (!decoded.orchard_fvk_hex && !decoded.transparent_fvk_hex) {
        throw new Error("UFVK does not contain valid Orchard or Transparent viewing keys");
      }

      this.platformUfvk = ufvk;
      this.orchardFvkHex = decoded.orchard_fvk_hex || null;
      this.transparentFvkHex = decoded.transparent_fvk_hex || null;

      console.log(`[UFVK Watcher] ✓ Platform UFVK registered: ${ufvk.slice(0, 16)}... (Orchard: ${Boolean(this.orchardFvkHex)}, Transparent: ${Boolean(this.transparentFvkHex)})`);
      return true;
    } catch (e: any) {
      throw new Error(`Failed to decode Unified Full Viewing Key: ${e.message}`);
    }
  }

  getPlatformUFVK(): string | null {
    return this.platformUfvk;
  }

  getOrchardFvkHex(): string | null {
    return this.orchardFvkHex;
  }

  /**
   * Derives a fresh diversified Unified Address directly from the platform UFVK.
   */
  async deriveDiversifiedAddress(diversifierIndex: number, network = process.env.ZCASH_NETWORK || "mainnet"): Promise<string | null> {
    let ufvk = this.getPlatformUFVK();
    if (!ufvk) {
      const envUfvk = process.env.ESCROW_PLATFORM_UFVK || process.env.ZCASH_ESCROW_UFVK;
      if (envUfvk) {
        await this.setPlatformUFVK(envUfvk).catch((e) => {
          console.warn("[UFVK Watcher] Failed to set platform UFVK:", e?.message);
        });
        ufvk = this.getPlatformUFVK();
      }
    }
    if (!ufvk) return null;

    const engine = await getWasmEngine();
    if (!engine) return null;

    try {
      return engine.derive_address_from_ufvk(ufvk, diversifierIndex, network);
    } catch (err: any) {
      console.warn("[UFVK Watcher] Failed to derive diversified address:", err?.message || err);
      return null;
    }
  }

  /**
   * Trial-decrypts an incoming compact or full Orchard action using the platform's Orchard FVK.
   * Returns decrypted note details if note belongs to the platform escrow.
   */
  async trialDecryptAction(action: CompactActionInput): Promise<DecryptedEscrowNote | null> {
    if (!this.orchardFvkHex) {
      const envUfvk = process.env.ESCROW_PLATFORM_UFVK || process.env.ZCASH_ESCROW_UFVK;
      if (envUfvk) {
        await this.setPlatformUFVK(envUfvk).catch((e) => {
          console.warn("[UFVK Watcher] Failed to set platform UFVK:", e?.message);
        });
      }
    }
    if (!this.orchardFvkHex) {
      return null;
    }

    const engine = await getWasmEngine();
    if (!engine) return null;

    try {
      const result = engine.try_decrypt_orchard_output({
        fvk_hex: this.orchardFvkHex,
        nullifier_hex: action.nullifier_hex,
        cmx_hex: action.cmx_hex,
        epk_hex: action.epk_hex,
        enc_ciphertext_hex: action.enc_ciphertext_hex,
      });

      return result as DecryptedEscrowNote | null;
    } catch {
      return null;
    }
  }

  /**
   * Processes a stream or batch of CompactActions from a newly confirmed block.
   */
  async processBlockActions(
    actions: CompactActionInput[],
    blockHeight?: number,
    txid?: string
  ): Promise<DecryptedEscrowNote[]> {
    const decryptedList: DecryptedEscrowNote[] = [];

    for (const action of actions) {
      const note = await this.trialDecryptAction(action);
      if (note) {
        note.txid = txid;
        note.block_height = blockHeight;
        this.detectedNotes.set(action.cmx_hex, note);
        decryptedList.push(note);
      }
    }

    return decryptedList;
  }

  /**
   * Verifies an escrow payment transaction against the platform's UFVK.
   * Supports checking trial-decrypted notes by commitment or matching memo/amount.
   */
  async verifyPayment(params: {
    txid: string;
    expectedAmountZec: number;
    expectedMemo?: string;
    action?: CompactActionInput;
  }): Promise<EscrowVerificationResult> {
    const { txid, expectedAmountZec, expectedMemo, action } = params;
    const expectedZatoshis = Math.round(expectedAmountZec * 1e8);

    // If a specific action was supplied, trial decrypt it directly
    if (action && this.orchardFvkHex) {
      const note = await this.trialDecryptAction(action);
      if (note) {
        if (note.value_zatoshis < expectedZatoshis * 0.999) {
          return {
            verified: false,
            reason: `UNDERPAID: Decrypted ${note.value_zatoshis} zatoshis, expected ${expectedZatoshis}`,
            actualAmountZec: note.value_zatoshis / 1e8,
            decryptedNote: note,
          };
        }

        if (expectedMemo && note.memo_text && !note.memo_text.includes(expectedMemo)) {
          return {
            verified: false,
            reason: `MEMO_MISMATCH: Note memo '${note.memo_text}' does not contain expected '${expectedMemo}'`,
            actualAmountZec: note.value_zatoshis / 1e8,
            decryptedNote: note,
          };
        }

        return {
          verified: true,
          actualAmountZec: note.value_zatoshis / 1e8,
          decryptedNote: note,
        };
      }
    }

    // Check in-memory detected notes cache
    for (const note of this.detectedNotes.values()) {
      if (note.txid === txid || (expectedMemo && note.memo_text.includes(expectedMemo))) {
        if (note.value_zatoshis >= expectedZatoshis * 0.999) {
          return {
            verified: true,
            actualAmountZec: note.value_zatoshis / 1e8,
            decryptedNote: note,
          };
        }
      }
    }

    return {
      verified: false,
      reason: "NOTE_NOT_DECRYPTED: No matching incoming Orchard note found for platform UFVK.",
    };
  }

  /**
   * Searches detected notes by escrow address, expected amount, or memo.
   * Enables autonomous mobile detection (Zashi / Ywallet) without manual txid entry.
   */
  findNoteByAddressOrMemo(params: {
    expectedAmountZec: number;
    expectedMemo?: string;
    depositAddress?: string;
  }): DecryptedEscrowNote | null {
    const expectedZats = Math.round(params.expectedAmountZec * 1e8);
    for (const note of this.detectedNotes.values()) {
      if (!note.txid) continue;
      const amountMatches = note.value_zatoshis >= expectedZats * 0.999;
      const memoMatches = params.expectedMemo && note.memo_text && note.memo_text.includes(params.expectedMemo);
      if (amountMatches && (memoMatches || !params.expectedMemo)) {
        return note;
      }
    }
    return null;
  }
}

// Global Singleton Instance
export const ufvkWatcher = new UFVKWatcherService();
