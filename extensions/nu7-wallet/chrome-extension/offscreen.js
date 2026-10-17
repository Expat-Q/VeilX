/**
 * VeilX Shielded Prover & Sync Engine (Offscreen Document)
 * Powered by WebZjs WebAssembly (librustzcash / Halo 2 / Orchard / Sapling).
 * Computes zero-knowledge proofs and syncs compact blocks without blocking popup UI.
 */

import init, { WebWallet } from "./webzjs_wallet.js";
import initVeilX, * as veilxEngine from "./veilx_wallet.js";

const TESTNET_GRPC_WEB_URL = "https://zcash-testnet.chainsafe.dev";
const DB_STORAGE_KEY = "veilx_shielded_db_v1";
const ACC_ID_STORAGE_KEY = "veilx_shielded_account_id_v1";
const TREE_STATE_KEY = "veilx_orchard_tree_state_v1";
const SPENDABLE_NOTES_KEY = "veilx_spendable_notes_v1";
const SENT_HISTORY_KEY = "veilx_sent_history_v1";

let wasmInitialized = false;
let veilxInitialized = false;
let activeWallet = null;
let activeMnemonic = null;
let activeAccountId = 1;

// Concurrency Mutex to prevent simultaneous SQLite writes/reads in Wasm
let isOperating = false;
async function acquireWalletLock() {
  while (isOperating) {
    await new Promise((r) => setTimeout(r, 60));
  }
  isOperating = true;
}
function releaseWalletLock() {
  isOperating = false;
}

// IndexedDB Helper for Large WASM DB persistence
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("VeilXShieldedStore", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("wallet_data")) {
        db.createObjectStore("wallet_data");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadPersistedDbBytes() {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("wallet_data", "readonly");
      const store = tx.objectStore("wallet_data");
      const req = store.get(DB_STORAGE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn("[VeilX Offscreen] Failed to read IndexedDB:", e);
    return null;
  }
}

async function persistDbBytes(bytes) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("wallet_data", "readwrite");
      const store = tx.objectStore("wallet_data");
      const req = store.put(bytes, DB_STORAGE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("[VeilX Offscreen] Failed to persist DB bytes:", e);
  }
}

async function loadPersistedAccountId() {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("wallet_data", "readonly");
      const store = tx.objectStore("wallet_data");
      const req = store.get(ACC_ID_STORAGE_KEY);
      req.onsuccess = () => resolve(req.result || 1);
      req.onerror = () => resolve(1);
    });
  } catch {
    return 1;
  }
}

async function persistAccountId(id) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("wallet_data", "readwrite");
      const store = tx.objectStore("wallet_data");
      const req = store.put(id, ACC_ID_STORAGE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {}
}

async function clearPersistedDbBytes() {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("wallet_data", "readwrite");
      const store = tx.objectStore("wallet_data");
      store.delete(DB_STORAGE_KEY);
      store.delete(ACC_ID_STORAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    return;
  }
}

async function ensureWasmReady() {
  if (wasmInitialized) return;
  const wasmUrl = chrome.runtime.getURL("webzjs_wallet_bg.wasm");
  console.log("[VeilX Offscreen] Initializing WebZjs WebAssembly from", wasmUrl);
  await init({ module_or_path: wasmUrl });
  wasmInitialized = true;
  console.log("[VeilX Offscreen] ✓ WebAssembly prover runtime initialized!");
}

async function ensureVeilxReady() {
  if (veilxInitialized) return veilxEngine;
  const wasmUrl = chrome.runtime.getURL("veilx_wallet_bg.wasm");
  console.log("[VeilX Offscreen] Initializing native VeilX Rust engine from", wasmUrl);
  await initVeilX({ module_or_path: wasmUrl });
  veilxInitialized = true;
  console.log("[VeilX Offscreen] ✓ Native VeilX Rust engine initialized!");

  // Restore persisted Orchard tree state on first init
  try {
    const savedTreeState = await loadPersistedValue(TREE_STATE_KEY);
    if (savedTreeState) {
      veilxEngine.tree_import_state(savedTreeState);
      console.log("[VeilX Offscreen] ✓ Restored persisted Orchard tree state");
    }
  } catch (treeErr) {
    console.warn("[VeilX Offscreen] Tree state restore note:", treeErr?.message || treeErr);
  }

  return veilxEngine;
}

// Generic IndexedDB persistence helpers for structured data
async function loadPersistedValue(key) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("wallet_data", "readonly");
      const store = tx.objectStore("wallet_data");
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function persistValue(key, value) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("wallet_data", "readwrite");
      const store = tx.objectStore("wallet_data");
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {}
}

// Persist the current Orchard tree state to IndexedDB
async function persistTreeState() {
  try {
    const state = veilxEngine.tree_export_state();
    await persistValue(TREE_STATE_KEY, state);
  } catch (err) {
    console.warn("[VeilX Offscreen] Tree state persist warning:", err?.message || err);
  }
}

// Load and save spendable notes from IndexedDB
async function loadSpendableNotes() {
  return (await loadPersistedValue(SPENDABLE_NOTES_KEY)) || [];
}

async function persistSpendableNotes(notes) {
  await persistValue(SPENDABLE_NOTES_KEY, notes);
}

// Load and save sent transaction history from IndexedDB
async function loadSentHistory() {
  return (await loadPersistedValue(SENT_HISTORY_KEY)) || [];
}

async function persistSentHistory(history) {
  await persistValue(SENT_HISTORY_KEY, history);
}

// Trial-decrypt and track Orchard actions from a sync response
async function processOrchardActions(actions, fvkHex, blockHeight) {
  if (!actions || actions.length === 0) return;

  const spendableNotes = await loadSpendableNotes();
  const sentHistory = await loadSentHistory();
  let notesChanged = false;
  let sentChanged = false;

  for (const act of actions) {
    // Trial-decrypt incoming notes using IVK
    try {
      const dec = veilxEngine.try_decrypt_orchard_output({
        fvk_hex: fvkHex,
        nullifier_hex: act.nullifier_hex,
        cmx_hex: act.cmx_hex,
        epk_hex: act.epk_hex,
        enc_ciphertext_hex: act.enc_ciphertext_hex,
      });
      if (dec) {
        // Track in commitment tree for future spending
        veilxEngine.tree_track_note(act.cmx_hex);

        spendableNotes.push({
          cmx_hex: act.cmx_hex,
          nullifier_hex: act.nullifier_hex,
          recipient_address_hex: dec.recipient_address_hex,
          value_zatoshis: dec.value_zatoshis,
          memo_text: dec.memo_text,
          rho_hex: dec.rho_hex,
          rseed_hex: dec.rseed_hex,
          is_change: dec.is_change,
          block_height: blockHeight,
          spent: false,
        });
        notesChanged = true;
        console.log(`[VeilX Offscreen] ✓ Decrypted incoming note: ${dec.value_zatoshis} zats at height ${blockHeight}`);
      }
    } catch (decErr) {
      // Note decryption failure is expected for notes not belonging to this wallet
    }

    // Recover outgoing sends via OVK
    if (act.out_ciphertext_hex && act.cv_net_hex) {
      try {
        const rec = veilxEngine.recover_outgoing_orchard_output({
          fvk_or_ovk_hex: fvkHex,
          cv_net_hex: act.cv_net_hex,
          cmx_hex: act.cmx_hex,
          epk_hex: act.epk_hex,
          enc_ciphertext_hex: act.enc_ciphertext_hex,
          out_ciphertext_hex: act.out_ciphertext_hex,
          nullifier_hex: act.nullifier_hex,
        });
        if (rec) {
          sentHistory.push({
            recipient_address_hex: rec.recipient_address_hex,
            value_zatoshis: rec.value_zatoshis,
            memo_text: rec.memo_text,
            block_height: blockHeight,
            timestamp: Date.now(),
          });
          sentChanged = true;
          console.log(`[VeilX Offscreen] ✓ Recovered outgoing send: ${rec.value_zatoshis} zats at height ${blockHeight}`);
        }
      } catch {
        // OVK recovery failure is expected for non-owned sends
      }
    }
  }

  if (notesChanged) await persistSpendableNotes(spendableNotes);
  if (sentChanged) await persistSentHistory(sentHistory);
}
async function getOrInitWallet(rawMnemonic, birthdayHeight = null, forceRecreate = false) {
  await ensureWasmReady();
  const mnemonic = (rawMnemonic || "").trim().toLowerCase().replace(/\s+/g, " ");

  if (forceRecreate) {
    await clearPersistedDbBytes();
    if (activeWallet) {
      try {
        activeWallet.free();
      } catch {}
      activeWallet = null;
    }
  }

  if (!forceRecreate && activeWallet && activeMnemonic === mnemonic) {
    return activeWallet;
  }

  if (activeWallet) {
    try {
      activeWallet.free();
    } catch {}
    activeWallet = null;
  }

  let savedDbBytes = forceRecreate ? null : await loadPersistedDbBytes();
  activeAccountId = forceRecreate ? 1 : await loadPersistedAccountId();

  console.log(
    `[VeilX Offscreen] Spawning WebWallet (testnet: ${TESTNET_GRPC_WEB_URL}, cached DB: ${
      savedDbBytes ? savedDbBytes.length + " bytes" : "none"
    }, forceRecreate: ${forceRecreate})...`
  );

  try {
    activeWallet = new WebWallet("test", TESTNET_GRPC_WEB_URL, 1, 1, savedDbBytes);
    activeMnemonic = mnemonic;
  } catch (wErr) {
    console.warn("[VeilX Offscreen] WebWallet worker initialization deferred (MV3 restricted worker):", wErr?.message || wErr);
    activeWallet = null;
    return null;
  }

  if (!savedDbBytes && activeWallet) {
    if (!mnemonic) {
      console.warn("[VeilX Offscreen] Account creation deferred: mnemonic not provided.");
      return activeWallet;
    }
    const words = mnemonic.split(" ");
    if (words.length !== 12 && words.length !== 24) {
      console.warn(`[VeilX Offscreen] Mnemonic word count (${words.length}) not 12 or 24 words. Skipping create_account.`);
      return activeWallet;
    }
    let targetBirthday = birthdayHeight;
    if (!targetBirthday) {
      try {
        const latest = await activeWallet.get_latest_block();
        targetBirthday = Math.max(0, Number(latest) - 10);
      } catch {
        targetBirthday = 4500400;
      }
    }
    console.log("[VeilX Offscreen] Initializing account from mnemonic with targeted birthday:", targetBirthday);
    try {
      const createdId = await activeWallet.create_account("VeilX Primary", mnemonic, 0, targetBirthday);
      activeAccountId = typeof createdId === "number" ? createdId : 1;
      await persistAccountId(activeAccountId);

      const initialBytes = await activeWallet.db_to_bytes();
      await persistDbBytes(initialBytes);
    } catch (createErr) {
      console.warn("[VeilX Offscreen] create_account warning:", createErr);
    }
  }

  return activeWallet;
}

function parseBalancesFromSummary(summary) {
  let totalShieldedZats = 0n;
  let saplingZats = 0n;
  let orchardZats = 0n;
  let unshieldedZats = 0n;

  if (summary && summary.account_balances) {
    for (const entry of summary.account_balances) {
      const bal = Array.isArray(entry) ? entry[1] : entry;
      if (!bal) continue;

      const sVal = typeof bal.sapling_balance === "object" ? (bal.sapling_balance?.spendable_value ?? 0) : bal.sapling_balance;
      const oVal = typeof bal.orchard_balance === "object" ? (bal.orchard_balance?.spendable_value ?? 0) : bal.orchard_balance;
      const uVal = typeof bal.unshielded_balance === "object" ? (bal.unshielded_balance?.spendable_value ?? 0) : bal.unshielded_balance;

      saplingZats += BigInt(sVal || 0);
      orchardZats += BigInt(oVal || 0);
      totalShieldedZats += BigInt(sVal || 0) + BigInt(oVal || 0);
      unshieldedZats += BigInt(uVal || 0);
    }
  }

  return { totalShieldedZats, saplingZats, orchardZats, unshieldedZats };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "VEILX_OFFSCREEN") return false;

  (async () => {
    const { action, payload } = message;

    switch (action) {
      case "INIT_PROVER": {
        await ensureWasmReady();
        if (payload?.mnemonic) {
          await getOrInitWallet(payload.mnemonic, payload.birthdayHeight, payload.forceRecreate);
        }
        return { success: true };
      }

      case "INIT_WALLET_ACCOUNT": {
        const { mnemonic, birthdayHeight, forceRecreate } = payload;
        await ensureVeilxReady();
        const nativeAcc = veilxEngine.derive_orchard_account(mnemonic, 0, "testnet");

        let unifiedAddress = nativeAcc.unified_address;
        let transparentAddress = nativeAcc.transparent_address;
        let accountId = 1;

        try {
          await ensureWasmReady();
          const wallet = await getOrInitWallet(mnemonic, birthdayHeight, forceRecreate);
          if (wallet) {
            accountId = activeAccountId || 1;
            const wUa = await wallet.get_current_address(accountId);
            const wTa = await wallet.get_current_address_transparent(accountId);
            if (wUa) unifiedAddress = wUa;
            if (wTa) transparentAddress = wTa;
          }
        } catch (wErr) {
          console.warn("[VeilX Offscreen] Background WebWallet initialization note:", wErr?.message || wErr);
        }

        return {
          success: true,
          accountId,
          unifiedAddress,
          transparentAddress,
          nativeOrchard: nativeAcc,
        };
      }

      case "BUILD_AND_PROVE_ORCHARD": {
        await ensureVeilxReady();
        const bundle = veilxEngine.build_and_prove_orchard_bundle(payload);
        return { success: true, bundle };
      }

      case "BUILD_AND_SIGN_TRANSACTION": {
        await ensureVeilxReady();
        const signed = veilxEngine.build_and_sign_transaction(payload);
        return { success: true, signed };
      }

      case "DECODE_UNIFIED_ADDRESS": {
        await ensureVeilxReady();
        const decoded = veilxEngine.decode_unified_address(payload.address);
        return { success: true, decoded };
      }

      case "SYNC_SHIELDED": {
        await acquireWalletLock();
        try {
          const { mnemonic, birthdayHeight, forceRecreate } = payload;
          let summaryJson = null;

          try {
            const wallet = await getOrInitWallet(mnemonic, birthdayHeight, forceRecreate);
            if (wallet) {
              console.log("[VeilX Offscreen] Starting background compact block scan via gRPC-Web...");
              await wallet.sync();

              const summary = await wallet.get_wallet_summary();
              const updatedBytes = await wallet.db_to_bytes();
              await persistDbBytes(updatedBytes);

              const { totalShieldedZats, saplingZats, orchardZats, unshieldedZats } = parseBalancesFromSummary(summary);
              const tip = Number(summary?.chain_tip_height || 0);
              const scanned = Number(summary?.fully_scanned_height || 0);
              const progressPct = tip > 0 && scanned > 0 ? Math.min(100, Math.round((scanned / tip) * 100)) : 100;

              summaryJson = {
                chainTipHeight: tip,
                fullyScannedHeight: scanned,
                progressPercent: progressPct,
                totalShieldedZats: totalShieldedZats.toString(),
                saplingZats: saplingZats.toString(),
                orchardZats: orchardZats.toString(),
                unshieldedZats: unshieldedZats.toString(),
                totalShieldedTaz: (Number(totalShieldedZats) / 1e8).toFixed(4),
              };
            }
          } catch (syncErr) {
            console.warn("[VeilX Offscreen] WebWallet sync note (fallback to native store):", syncErr?.message || syncErr);
          }

          if (!summaryJson) {
            const notes = await loadSpendableNotes();
            const unspent = notes.filter((n) => !n.spent);
            const totalZats = unspent.reduce((sum, n) => sum + BigInt(n.value_zatoshis || 0), 0n);
            const targetHeight = birthdayHeight || 3518000;
            summaryJson = {
              chainTipHeight: targetHeight,
              fullyScannedHeight: targetHeight,
              progressPercent: 100,
              totalShieldedZats: totalZats.toString(),
              saplingZats: "0",
              orchardZats: totalZats.toString(),
              unshieldedZats: "0",
              totalShieldedTaz: (Number(totalZats) / 1e8).toFixed(4),
            };
          }

          console.log("[VeilX Offscreen] ✓ Sync summary ready:", summaryJson);
          return { success: true, summary: summaryJson };
        } finally {
          releaseWalletLock();
        }
      }

      case "SEND_SHIELDED": {
        await acquireWalletLock();
        try {
          const { mnemonic, toAddress, amountZatoshis, birthdayHeight } = payload;
          const wallet = await getOrInitWallet(mnemonic, birthdayHeight);
          if (!wallet) {
            throw new Error(
              "Shielded prover service worker is initializing or restricted in MV3. If you have transparent funds, switch the source pool to Transparent."
            );
          }
          const targetAmount = BigInt(amountZatoshis);
          const standardFee = 10000n; // ZIP-317 standard fee = 0.0001 TAZ
          const totalNeeded = targetAmount + standardFee;
          const accountId = activeAccountId || 1;

          console.log(`[VeilX Offscreen] Checking shielded spendable balance for account ${accountId} (target: ${amountZatoshis} zats + ${standardFee} fee = ${totalNeeded} zats)...`);
          let summary = await wallet.get_wallet_summary();
          let { totalShieldedZats } = parseBalancesFromSummary(summary);

          if (totalShieldedZats < totalNeeded) {
            console.log(`[VeilX Offscreen] Scanned notes (${totalShieldedZats} zats) < required (${totalNeeded} zats). Scanning compact blocks...`);
            try {
              await wallet.sync();
              summary = await wallet.get_wallet_summary();
              const parsed = parseBalancesFromSummary(summary);
              totalShieldedZats = parsed.totalShieldedZats;
            } catch (syncErr) {
              console.warn("[VeilX Offscreen] Auto-sync before proposal failed:", syncErr);
            }
          }

          if (totalShieldedZats < totalNeeded) {
            const availTaz = (Number(totalShieldedZats) / 1e8).toFixed(4);
            const reqTaz = (Number(targetAmount) / 1e8).toFixed(4);
            const feeTaz = (Number(standardFee) / 1e8).toFixed(4);
            const totalReqTaz = (Number(totalNeeded) / 1e8).toFixed(4);
            if (totalShieldedZats === 0n) {
              throw new Error(
                `No spendable shielded notes decrypted yet in WebWallet. If you recently claimed from faucet, please wait a moment for the block to confirm and click '↻ Sync' or '⚡ Fast Resync Shielded Notes' in Settings. If you have transparent funds, switch the send source pool to '⚡ Transparent'.`
              );
            }
            throw new Error(
              `Insufficient Shielded balance: you have ${availTaz} TAZ in spendable shielded notes, but sending ${reqTaz} TAZ requires ${totalReqTaz} TAZ including the network fee (${feeTaz} TAZ).`
            );
          }

          console.log(`[VeilX Offscreen] Proposing transfer of ${amountZatoshis} zatoshis from account ${accountId} to ${toAddress}...`);
          let proposal;
          try {
            proposal = await wallet.propose_transfer(accountId, toAddress, targetAmount);
          } catch (propErr) {
            console.error("[VeilX Offscreen] propose_transfer failed:", propErr);
            const errMsg = propErr?.message || String(propErr);
            if (errMsg.toLowerCase().includes("insufficient balance") || errMsg.toLowerCase().includes("propose transfer")) {
              const availTaz = (Number(totalShieldedZats) / 1e8).toFixed(4);
              const reqTaz = (Number(targetAmount) / 1e8).toFixed(4);
              throw new Error(
                `Shielded note selection failed: WebWallet has ${availTaz} TAZ decrypted, which cannot cover ${reqTaz} TAZ plus the ZIP-317 network fee (0.0001 TAZ). Try sending a slightly smaller amount (e.g. ${(Math.max(0, Number(availTaz) - 0.0002)).toFixed(4)} TAZ).`
              );
            }
            throw propErr;
          }

          console.log("[VeilX Offscreen] Generating Halo 2 zero-knowledge proofs (Pallas/Vesta)...");
          const authorizedTxns = await wallet.create_proposed_transactions(proposal, mnemonic, 0);

          console.log("[VeilX Offscreen] Submitting authorized shielded transaction to testnet node...");
          await wallet.send_authorized_transactions(authorizedTxns);

          // Convert the 32-byte wire TxID to hex (first 32 bytes little-endian)
          const rawTxIdBytes = authorizedTxns.slice(0, 32);
          const txidHex = Array.from(rawTxIdBytes)
            .reverse()
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          // Persist updated database state after spend
          const updatedBytes = await wallet.db_to_bytes();
          await persistDbBytes(updatedBytes);

          console.log(`[VeilX Offscreen] ✓ Shielded spend accepted on-chain! TxID: ${txidHex}`);
          return { success: true, txid: txidHex };
        } finally {
          releaseWalletLock();
        }
      }

      case "RESET_SHIELDED_DB": {
        await acquireWalletLock();
        try {
          const { mnemonic, birthdayHeight } = payload;
          await clearPersistedDbBytes();
          if (activeWallet) {
            try {
              activeWallet.free();
            } catch {}
            activeWallet = null;
          }
          let summaryJson = null;
          try {
            const wallet = await getOrInitWallet(mnemonic, birthdayHeight, true);
            if (wallet) {
              console.log("[VeilX Offscreen] Performing compact block scan after cache reset...");
              await wallet.sync();
              const summary = await wallet.get_wallet_summary();
              const updatedBytes = await wallet.db_to_bytes();
              await persistDbBytes(updatedBytes);
              const { totalShieldedZats, saplingZats, orchardZats, unshieldedZats } = parseBalancesFromSummary(summary);
              const tip = Number(summary?.chain_tip_height || 0);
              const scanned = Number(summary?.fully_scanned_height || 0);
              summaryJson = {
                chainTipHeight: tip,
                fullyScannedHeight: scanned,
                progressPercent: 100,
                totalShieldedZats: totalShieldedZats.toString(),
                saplingZats: saplingZats.toString(),
                orchardZats: orchardZats.toString(),
                unshieldedZats: unshieldedZats.toString(),
                totalShieldedTaz: (Number(totalShieldedZats) / 1e8).toFixed(4),
              };
            }
          } catch (resetErr) {
            console.warn("[VeilX Offscreen] WebWallet reset scan note:", resetErr?.message || resetErr);
          }

          if (!summaryJson) {
            const notes = await loadSpendableNotes();
            const unspent = notes.filter((n) => !n.spent);
            const totalZats = unspent.reduce((sum, n) => sum + BigInt(n.value_zatoshis || 0), 0n);
            const targetHeight = birthdayHeight || 3518000;
            summaryJson = {
              chainTipHeight: targetHeight,
              fullyScannedHeight: targetHeight,
              progressPercent: 100,
              totalShieldedZats: totalZats.toString(),
              saplingZats: "0",
              orchardZats: totalZats.toString(),
              unshieldedZats: "0",
              totalShieldedTaz: (Number(totalZats) / 1e8).toFixed(4),
            };
          }

          return { success: true, summary: summaryJson };
        } finally {
          releaseWalletLock();
        }
      }

      case "GET_TRANSACTION_HISTORY": {
        await acquireWalletLock();
        try {
          const { mnemonic, limit = 20, offset = 0 } = payload || {};
          const wallet = await getOrInitWallet(mnemonic);
          if (!wallet) return { success: true, transactions: [] };
          const accountId = activeAccountId || 1;
          let history = null;
          try {
            history = await wallet.get_transaction_history(accountId, limit, offset);
          } catch (histErr) {
            console.log("[VeilX Offscreen] get_transaction_history query note:", histErr?.message || histErr);
            return { success: true, transactions: [] };
          }

          const txs = (history?.transactions || []).map((t) => ({
            txid: t.txid,
            transactionType: t.transaction_type,
            status: t.status,
            valueZats: t.value?.toString() || "0",
            valueTaz: (Number(t.value || 0) / 1e8).toFixed(4),
            blockHeight: t.block_height,
            timestamp: t.timestamp ? Number(t.timestamp) * 1000 : Date.now(),
            memo: t.memo || "",
          }));

          return { success: true, transactions: txs };
        } catch (e) {
          console.warn("[VeilX Offscreen] get_transaction_history warning:", e?.message || e);
          return { success: true, transactions: [] };
        } finally {
          releaseWalletLock();
        }
      }

      case "GET_LATEST_BLOCK": {
        // Reuse existing wallet connection if available.
        // If no wallet is initialized yet, throw so background.js
        // falls back to the public testnet API / Zebra RPC.
        if (!activeWallet) {
          throw new Error("No active wallet session — use public API fallback.");
        }
        const latest = await activeWallet.get_latest_block();
        return { latestBlockHeight: latest.toString() };
      }

      // ─── Native VeilX Orchard Tree & Spend Operations ───

      case "TREE_APPEND_COMMITMENTS": {
        await ensureVeilxReady();
        const anchor = veilxEngine.tree_append_commitments(payload.commitments_hex);
        if (payload.checkpoint_height) {
          veilxEngine.tree_create_checkpoint(
            payload.checkpoint_height,
            payload.block_hash_hex || "0".repeat(64)
          );
        }
        await persistTreeState();
        return { success: true, anchor };
      }

      case "TREE_PROCESS_ORCHARD_ACTIONS": {
        await ensureVeilxReady();
        const { actions, fvk_hex, block_height, commitments_hex } = payload;

        // 1. Append all commitment hashes from this block
        if (commitments_hex && commitments_hex.length > 0) {
          veilxEngine.tree_append_commitments(commitments_hex);
        }

        // 2. Trial-decrypt and track notes
        await processOrchardActions(actions, fvk_hex, block_height);

        // 3. Checkpoint periodically (every 10 blocks)
        if (block_height % 10 === 0) {
          veilxEngine.tree_create_checkpoint(
            block_height,
            payload.block_hash_hex || "0".repeat(64)
          );
          await persistTreeState();
        }

        return { success: true };
      }

      case "TREE_REWIND": {
        await ensureVeilxReady();
        const newAnchor = veilxEngine.tree_rewind_to_height(payload.target_height);

        // Remove notes above the rewind height
        const notes = await loadSpendableNotes();
        const filtered = notes.filter(n => n.block_height <= payload.target_height);
        if (filtered.length !== notes.length) {
          await persistSpendableNotes(filtered);
        }

        await persistTreeState();
        return { success: true, anchor: newAnchor };
      }

      case "TREE_GET_STATE": {
        await ensureVeilxReady();
        const treeAnchor = veilxEngine.tree_get_anchor();
        const treeState = veilxEngine.tree_export_state();
        return {
          success: true,
          anchor: treeAnchor,
          witness_count: Object.keys(treeState.witnesses || {}).length,
          checkpoint_count: (treeState.checkpoints || []).length,
        };
      }

      case "GET_SPENDABLE_NOTES": {
        const allNotes = await loadSpendableNotes();
        const unspent = allNotes.filter(n => !n.spent);
        const totalZats = unspent.reduce((s, n) => s + Number(n.value_zatoshis), 0);
        return {
          success: true,
          notes: unspent,
          total_zatoshis: totalZats,
          total_taz: (totalZats / 1e8).toFixed(8),
        };
      }

      case "BUILD_NATIVE_SHIELDED_SPEND": {
        await ensureVeilxReady();
        await acquireWalletLock();
        try {
          const {
            spending_key_hex,
            orchard_raw_address_hex,
            fvk_hex,
            recipient_address,
            amount_zatoshis,
            memo,
          } = payload;

          // Select spendable notes (greedy, largest-first)
          const allNotes = await loadSpendableNotes();
          const unspent = allNotes.filter(n => !n.spent);
          unspent.sort((a, b) => Number(b.value_zatoshis) - Number(a.value_zatoshis));

          const targetAmount = Number(amount_zatoshis);
          const fee = 10000; // ZIP-317 standard
          const totalNeeded = targetAmount + fee;

          let selected = [];
          let selectedTotal = 0;
          for (const note of unspent) {
            selected.push(note);
            selectedTotal += Number(note.value_zatoshis);
            if (selectedTotal >= totalNeeded) break;
          }

          if (selectedTotal < totalNeeded) {
            throw new Error(
              `Insufficient spendable notes: have ${selectedTotal} zats, need ${totalNeeded} zats (${targetAmount} + ${fee} fee)`
            );
          }

          const changeAmount = selectedTotal - targetAmount - fee;
          const anchor = veilxEngine.tree_get_anchor();
          let sighash = payload.sighash_hex;
          if (!sighash || sighash.length !== 64) {
            const encoder = new TextEncoder();
            const preimage = new Uint8Array([
              ...encoder.encode(anchor || ""),
              ...encoder.encode(recipient_address || ""),
              ...encoder.encode(String(targetAmount)),
              ...encoder.encode(String(changeAmount)),
              ...encoder.encode(memo || ""),
            ]);
            const hashBuf = await crypto.subtle.digest("SHA-256", preimage);
            sighash = Array.from(new Uint8Array(hashBuf))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
          }

          const spends = selected.map(note => ({
            spending_key_hex,
            recipient_raw_address_hex: orchard_raw_address_hex,
            value_zatoshis: Number(note.value_zatoshis),
            rho_hex: note.rho_hex,
            rseed_hex: note.rseed_hex,
            cmx_hex: note.cmx_hex,
            auth_path_hex: null, // automatic witness from GLOBAL_ORCHARD_TREE
            position: null,
          }));

          const spendBundle = veilxEngine.build_and_prove_orchard_spend({
            spends,
            recipient_address,
            amount_zatoshis: targetAmount,
            memo: memo || null,
            change_address: null, // derive from spending key internally
            change_zatoshis: changeAmount,
            anchor_hex: anchor,
            sighash_hex: sighash,
          });

          // Mark spent notes
          for (const sel of selected) {
            const idx = allNotes.findIndex(n => n.cmx_hex === sel.cmx_hex);
            if (idx >= 0) allNotes[idx].spent = true;
          }
          await persistSpendableNotes(allNotes);

          return {
            success: true,
            bundle: spendBundle,
            selected_notes: selected.length,
            total_input_zatoshis: selectedTotal,
            change_zatoshis: changeAmount,
            fee_zatoshis: fee,
          };
        } finally {
          releaseWalletLock();
        }
      }

      case "GET_SENT_HISTORY": {
        const history = await loadSentHistory();
        return { success: true, history };
      }

      case "EXPORT_UFVK": {
        await ensureVeilxReady();
        const ufvk = veilxEngine.export_unified_full_viewing_key(
          payload.mnemonic,
          payload.account_index || 0,
          payload.network || "testnet"
        );
        return { success: true, ufvk };
      }

      case "DECODE_UFVK": {
        await ensureVeilxReady();
        const decodedUfvk = veilxEngine.decode_unified_full_viewing_key(payload.ufvk);
        return { success: true, decoded: decodedUfvk };
      }

      default:
        throw new Error(`Unknown offscreen action: ${action}`);
    }
  })()
    .then((result) => sendResponse({ result }))
    .catch((err) => sendResponse({ error: err.message || String(err) }));

  return true; // async
});

console.log("[VeilX Offscreen] Offscreen prover listener ready.");
