/**
 * VeilX Shielded Prover & Sync Engine (Offscreen Document)
 * Powered by WebZjs WebAssembly (librustzcash / Halo 2 / Orchard / Sapling).
 * Computes zero-knowledge proofs and syncs compact blocks without blocking popup UI.
 */

import init, { WebWallet } from "./webzjs_wallet.js";
import initVeilX, * as veilxEngine from "./veilx_wallet.js";

const TESTNET_GRPC_WEB_URL = "https://tee.testnet.unsafe.zec.rocks";
const MAINNET_GRPC_WEB_URL = "https://tee.unsafe.zec.rocks";
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
async function acquireWalletLock(timeoutMs = 5000) {
  const start = Date.now();
  while (isOperating) {
    if (Date.now() - start > timeoutMs) {
      console.warn("[VeilX Offscreen] Wallet lock acquisition timed out after " + timeoutMs + "ms; forcing release.");
      isOperating = false;
      break;
    }
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
function processOrchardActions(actions, candidateFvks, blockHeight, spendableNotes, sentHistory) {
  if (!actions || actions.length === 0) return { notesChanged: false, sentChanged: false };

  const fvks = Array.isArray(candidateFvks) ? candidateFvks : [candidateFvks];
  let notesChanged = false;
  let sentChanged = false;

  for (const act of actions) {
    for (const fvkHex of fvks) {
      if (!fvkHex) continue;
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

          if (!spendableNotes.some((n) => n.cmx_hex === act.cmx_hex)) {
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
              txid: act.txid || "",
            });
            notesChanged = true;
            console.log(`[VeilX Offscreen] ✓ Decrypted incoming note: ${dec.value_zatoshis} zats at height ${blockHeight}`);
          }
          break; // Output decrypted successfully with this FVK!
        }
      } catch (decErr) {
        // Decryption failure expected for outputs not belonging to this wallet
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
              txid: act.txid || "",
            });
            sentChanged = true;
            console.log(`[VeilX Offscreen] ✓ Recovered outgoing send: ${rec.value_zatoshis} zats at height ${blockHeight}`);
            break;
          }
        } catch {
          // OVK recovery failure expected for non-owned sends
        }
      }
    }
  }

  return { notesChanged, sentChanged };
}

// Byte and protobuf parsing helpers for single-threaded compact block streaming
function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function decodeVarint(buf, offset) {
  let res = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buf.length) {
    const b = BigInt(buf[pos++]);
    res |= (b & 0x7fn) << shift;
    if ((b & 0x80n) === 0n) break;
    shift += 7n;
  }
  return { val: res, nextOffset: pos };
}

function encodeVarint(val) {
  const bytes = [];
  let current = val;
  while (current > 0x7f) {
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  bytes.push(current);
  return bytes;
}

function parseCompactOrchardAction(buf) {
  let pos = 0;
  const action = {};
  while (pos < buf.length) {
    const { val: tagVal, nextOffset: p1 } = decodeVarint(buf, pos);
    const fieldNum = Number(tagVal >> 3n);
    const wireType = Number(tagVal & 7n);
    pos = p1;
    if (wireType === 2) {
      const { val: len, nextOffset: p2 } = decodeVarint(buf, pos);
      const start = p2;
      const end = start + Number(len);
      const bytes = buf.subarray(start, end);
      pos = end;
      if (fieldNum === 1) action.nullifier_hex = bytesToHex(bytes);
      if (fieldNum === 2) action.cmx_hex = bytesToHex(bytes);
      if (fieldNum === 3) action.epk_hex = bytesToHex(bytes);
      if (fieldNum === 4) action.enc_ciphertext_hex = bytesToHex(bytes);
      if (fieldNum === 5) action.out_ciphertext_hex = bytesToHex(bytes);
      if (fieldNum === 6) action.cv_net_hex = bytesToHex(bytes);
    } else {
      break;
    }
  }
  return action;
}

function parseCompactTx(buf) {
  let pos = 0;
  const tx = { actions: [] };
  let rawHashBytes = null;
  while (pos < buf.length) {
    const { val: tagVal, nextOffset: p1 } = decodeVarint(buf, pos);
    const fieldNum = Number(tagVal >> 3n);
    const wireType = Number(tagVal & 7n);
    pos = p1;
    if (wireType === 0) {
      const { val, nextOffset: p2 } = decodeVarint(buf, pos);
      pos = p2;
      if (fieldNum === 1) tx.index = Number(val);
      if (fieldNum === 3) tx.fee = Number(val);
    } else if (wireType === 2) {
      const { val: len, nextOffset: p2 } = decodeVarint(buf, pos);
      const start = p2;
      const end = start + Number(len);
      const bytes = buf.subarray(start, end);
      pos = end;
      if (fieldNum === 2) {
        rawHashBytes = bytes;
        tx.hash = bytesToHex(bytes);
      }
      if (fieldNum === 6 || fieldNum === 9) {
        const act = parseCompactOrchardAction(bytes);
        tx.actions.push(act);
      }
    } else {
      break;
    }
  }

  const displayTxid = rawHashBytes
    ? Array.from(rawHashBytes).reverse().map((b) => b.toString(16).padStart(2, "0")).join("")
    : "";
  for (const act of tx.actions) {
    act.txid = displayTxid;
  }

  return tx;
}

function parseCompactBlock(buf) {
  let pos = 0;
  const block = { vtx: [] };
  while (pos < buf.length) {
    const { val: tagVal, nextOffset: p1 } = decodeVarint(buf, pos);
    const fieldNum = Number(tagVal >> 3n);
    const wireType = Number(tagVal & 7n);
    pos = p1;
    if (wireType === 0) {
      const { val, nextOffset: p2 } = decodeVarint(buf, pos);
      pos = p2;
      if (fieldNum === 1) block.protoVersion = Number(val);
      if (fieldNum === 2) block.height = Number(val);
      if (fieldNum === 5) block.time = Number(val);
    } else if (wireType === 2) {
      const { val: len, nextOffset: p2 } = decodeVarint(buf, pos);
      const start = p2;
      const end = start + Number(len);
      const bytes = buf.subarray(start, end);
      pos = end;
      if (fieldNum === 3) block.hash = bytesToHex(bytes);
      if (fieldNum === 4) block.prevHash = bytesToHex(bytes);
      if (fieldNum === 6) block.header = bytesToHex(bytes);
      if (fieldNum === 7) block.vtx.push(parseCompactTx(bytes));
    } else {
      break;
    }
  }
  return block;
}

function parseGrpcWebBlocks(u8Array) {
  let pos = 0;
  const blocks = [];
  while (pos + 5 <= u8Array.length) {
    const flags = u8Array[pos];
    const len = (u8Array[pos + 1] << 24) | (u8Array[pos + 2] << 16) | (u8Array[pos + 3] << 8) | u8Array[pos + 4];
    pos += 5;
    if (flags === 0x00 && len > 0) {
      const msgBytes = u8Array.subarray(pos, pos + len);
      blocks.push(parseCompactBlock(msgBytes));
    }
    pos += len;
  }
  return blocks;
}

async function fetchLatestBlockHeight(grpcUrl) {
  const body = new Uint8Array([0, 0, 0, 0, 0]);
  const res = await fetch(grpcUrl + "/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock", {
    method: "POST",
    headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP error ${res.status} fetching latest block`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 5) throw new Error("Invalid gRPC-Web response from GetLatestBlock");
  const len = (buf[1] << 24) | (buf[2] << 16) | (buf[3] << 8) | buf[4];
  const msg = buf.subarray(5, 5 + len);
  let pos = 0;
  let height = 0;
  let hash = "";
  while (pos < msg.length) {
    const { val: tagVal, nextOffset: p1 } = decodeVarint(msg, pos);
    const fieldNum = Number(tagVal >> 3n);
    const wireType = Number(tagVal & 7n);
    pos = p1;
    if (wireType === 0) {
      const { val, nextOffset: p2 } = decodeVarint(msg, pos);
      pos = p2;
      if (fieldNum === 1) height = Number(val);
    } else if (wireType === 2) {
      const { val: l, nextOffset: p2 } = decodeVarint(msg, pos);
      pos = p2 + Number(l);
      if (fieldNum === 2) hash = bytesToHex(msg.subarray(p2, pos));
    } else {
      break;
    }
  }
  return { height, hash };
}

async function fetchCompactBlockRange(startHeight, endHeight, grpcUrl) {
  const h1 = encodeVarint(startHeight);
  const h2 = encodeVarint(endHeight);
  const blockId1 = [0x08, ...h1];
  const blockId2 = [0x08, ...h2];
  const payload = [0x0a, blockId1.length, ...blockId1, 0x12, blockId2.length, ...blockId2];
  const body = new Uint8Array([0, 0, 0, 0, payload.length, ...payload]);

  const res = await fetch(grpcUrl + "/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlockRange", {
    method: "POST",
    headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP error ${res.status} fetching block range ${startHeight}-${endHeight}`);
  const buf = await res.arrayBuffer();
  return parseGrpcWebBlocks(new Uint8Array(buf));
}

let activeSyncJob = null;

async function syncShieldedNative(payload) {
  if (activeSyncJob) {
    console.log("[VeilX Offscreen] Shielded sync already in flight, returning active job promise.");
    return activeSyncJob;
  }

  activeSyncJob = (async () => {
    try {
      await ensureVeilxReady();
      const { mnemonic, birthdayHeight, forceRecreate, network = "testnet" } = payload;
      const grpcEndpoint = network === "mainnet" ? MAINNET_GRPC_WEB_URL : TESTNET_GRPC_WEB_URL;

      const candidateFvks = [];
      try {
        const a0 = veilxEngine.derive_orchard_account(mnemonic, 0, network);
        if (a0?.fvk_hex) candidateFvks.push(a0.fvk_hex);
      } catch {}
      try {
        const a1 = veilxEngine.derive_orchard_account(mnemonic, 1, network);
        if (a1?.fvk_hex && !candidateFvks.includes(a1.fvk_hex)) candidateFvks.push(a1.fvk_hex);
      } catch {}
      try {
        const aMain = veilxEngine.derive_orchard_account(mnemonic, 0, "mainnet");
        if (aMain?.fvk_hex && !candidateFvks.includes(aMain.fvk_hex)) candidateFvks.push(aMain.fvk_hex);
      } catch {}
      if (payload.extraFvkHex && !candidateFvks.includes(payload.extraFvkHex)) {
        candidateFvks.push(payload.extraFvkHex);
      }
      console.log(`[VeilX Offscreen] Loaded ${candidateFvks.length} candidate Orchard Viewing Keys for note discovery.`);

      const lastScannedKey = `LAST_SCANNED_HEIGHT_${network}`;
      if (forceRecreate) {
        await persistValue(lastScannedKey, null);
        await persistSpendableNotes([]);
      }

      // 1. Fetch live tip height directly from lightwalletd
      const { height: tipHeight } = await fetchLatestBlockHeight(grpcEndpoint);
      if (!tipHeight || tipHeight === 0) {
        throw new Error("Unable to retrieve latest block height from lightwalletd.");
      }

      let lastScanned = await loadPersistedValue(lastScannedKey);
      let startHeight;
      if (birthdayHeight && Number(birthdayHeight) > 0 && (!lastScanned || Number(birthdayHeight) < Number(lastScanned))) {
        startHeight = Number(birthdayHeight);
        const existingNotes = await loadSpendableNotes();
        const filtered = existingNotes.filter((n) => n.block_height < startHeight);
        await persistSpendableNotes(filtered);
      } else if (lastScanned && Number(lastScanned) > 0) {
        startHeight = Number(lastScanned) + 1;
      } else if (birthdayHeight && Number(birthdayHeight) > 0) {
        startHeight = Number(birthdayHeight);
      } else {
        startHeight = Math.max(0, tipHeight - 150);
      }

      console.log(`[VeilX Offscreen] Shielded sync: Scanning blocks ${startHeight} -> ${tipHeight} (${network})...`);

      if (startHeight > tipHeight) {
        // Already fully up to date
        const notes = await loadSpendableNotes();
        const unspent = notes.filter((n) => !n.spent);
        const totalZats = unspent.reduce((sum, n) => sum + BigInt(n.value_zatoshis || 0), 0n);

        chrome.runtime.sendMessage({
          type: "VEILX_SYNC_PROGRESS_UPDATE",
          stage: "synced",
          progressPct: 100,
          scannedHeight: tipHeight,
          tipHeight,
        }).catch(() => {});

        return {
          success: true,
          summary: {
            chainTipHeight: tipHeight,
            fullyScannedHeight: tipHeight,
            progressPercent: 100,
            totalShieldedZats: totalZats.toString(),
            saplingZats: "0",
            orchardZats: totalZats.toString(),
            unshieldedZats: "0",
            totalShieldedTaz: (Number(totalZats) / 1e8).toFixed(4),
          },
        };
      }

      chrome.runtime.sendMessage({
        type: "VEILX_SYNC_PROGRESS_UPDATE",
        stage: "scanning",
        progressPct: 0,
        scannedHeight: startHeight,
        tipHeight,
      }).catch(() => {});

      const chunkSize = 150;
      const totalBlocks = Math.max(1, tipHeight - startHeight);

      for (let chunkStart = startHeight; chunkStart <= tipHeight; chunkStart += chunkSize) {
        const chunkEnd = Math.min(tipHeight, chunkStart + chunkSize - 1);
        const blocks = await fetchCompactBlockRange(chunkStart, chunkEnd, grpcEndpoint);

        const spendableNotes = await loadSpendableNotes();
        const sentHistory = await loadSentHistory();
        let notesChanged = false;
        let sentChanged = false;

        for (const block of blocks) {
          const commitments = [];
          const actions = [];

          for (const tx of (block.vtx || [])) {
            for (const act of (tx.actions || [])) {
              if (act.nullifier_hex) {
                const match = spendableNotes.find((n) => !n.spent && n.nullifier_hex === act.nullifier_hex);
                if (match) {
                  match.spent = true;
                  notesChanged = true;
                  console.log(`[VeilX Offscreen] Note spent at block ${block.height}: ${match.value_zatoshis} zats`);
                }
              }
              if (act.cmx_hex) commitments.push(act.cmx_hex);
              actions.push(act);
            }
          }

          if (commitments.length > 0) {
            veilxEngine.tree_append_commitments(commitments);
          }

          if (actions.length > 0) {
            const res = processOrchardActions(actions, candidateFvks, block.height, spendableNotes, sentHistory);
            if (res.notesChanged) notesChanged = true;
            if (res.sentChanged) sentChanged = true;
          }

          veilxEngine.tree_create_checkpoint(block.height, block.hash || "0".repeat(64));
        }

        if (notesChanged) {
          await persistSpendableNotes(spendableNotes);
        }
        if (sentChanged) {
          await persistSentHistory(sentHistory);
        }

        await persistValue(lastScannedKey, chunkEnd);
        await persistTreeState();

        const completedBlocks = Math.max(0, chunkEnd - startHeight);
        const pct = Math.min(99, Math.max(1, Math.round((completedBlocks / totalBlocks) * 100)));

        chrome.runtime.sendMessage({
          type: "VEILX_SYNC_PROGRESS_UPDATE",
          stage: "scanning",
          progressPct: pct,
          scannedHeight: chunkEnd,
          tipHeight,
        }).catch(() => {});
      }

      await persistValue(lastScannedKey, tipHeight);
      await persistTreeState();

      chrome.runtime.sendMessage({
        type: "VEILX_SYNC_PROGRESS_UPDATE",
        stage: "synced",
        progressPct: 100,
        scannedHeight: tipHeight,
        tipHeight,
      }).catch(() => {});

      const finalNotes = await loadSpendableNotes();
      const unspent = finalNotes.filter((n) => !n.spent);
      const totalZats = unspent.reduce((sum, n) => sum + BigInt(n.value_zatoshis || 0), 0n);

      return {
        success: true,
        summary: {
          chainTipHeight: tipHeight,
          fullyScannedHeight: tipHeight,
          progressPercent: 100,
          totalShieldedZats: totalZats.toString(),
          saplingZats: "0",
          orchardZats: totalZats.toString(),
          unshieldedZats: "0",
          totalShieldedTaz: (Number(totalZats) / 1e8).toFixed(4),
        },
      };
    } catch (err) {
      console.error("[VeilX Offscreen] Sync error:", err);
      chrome.runtime.sendMessage({
        type: "VEILX_SYNC_PROGRESS_UPDATE",
        stage: "failed",
        progressPct: 0,
        error: err?.message || String(err),
      }).catch(() => {});
      return { success: false, error: err?.message || String(err) };
    } finally {
      activeSyncJob = null;
    }
  })();

  return activeSyncJob;
}
async function getOrInitWallet(rawMnemonic, birthdayHeight = null, forceRecreate = false, network = "testnet") {
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

  const netParam = network === "mainnet" ? "main" : "test";
  const grpcUrl = network === "mainnet" ? MAINNET_GRPC_WEB_URL : TESTNET_GRPC_WEB_URL;

  console.log(
    `[VeilX Offscreen] Spawning WebWallet (${network}: ${grpcUrl}, cached DB: ${
      savedDbBytes ? savedDbBytes.length + " bytes" : "none"
    }, forceRecreate: ${forceRecreate})...`
  );

  try {
    activeWallet = new WebWallet(netParam, grpcUrl, 1, 1, savedDbBytes);
    activeMnemonic = mnemonic;
  } catch (wErr) {
    console.warn("[VeilX Offscreen] WebWallet worker initialization deferred (MV3 restricted worker):", wErr?.message || wErr);
    activeWallet = null;
    return null;
  }

  // Sanity check existing database: if anchored to an obsolete birthday with 0 balance, reset it
  if (savedDbBytes && activeWallet) {
    try {
      const summary = await activeWallet.get_wallet_summary();
      const dbBirthday = Number(summary?.birthday_height || 0);
      const isTestnet = network === "testnet";
      const minReasonable = isTestnet ? 4510000 : 3500000;

      if (dbBirthday > 0 && dbBirthday < minReasonable) {
        const { totalShieldedZats } = parseBalancesFromSummary(summary);
        if (totalShieldedZats === 0n) {
          console.log(`[VeilX Offscreen] Detected obsolete wallet birthday in DB (${dbBirthday} < ${minReasonable}). Recreating database with target birthday...`);
          await clearPersistedDbBytes();
          try { activeWallet.free(); } catch {}
          activeWallet = null;
          return getOrInitWallet(rawMnemonic, birthdayHeight, true, network);
        }
      }
    } catch (e) {
      console.warn("[VeilX Offscreen] Birthday sanity check note:", e?.message || e);
    }
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
    const isTestnet = network === "testnet";
    const minReasonable = isTestnet ? 2000000 : 2000000;
    if (!targetBirthday || targetBirthday < minReasonable) {
      try {
        const latest = await activeWallet.get_latest_block();
        const tipNum = Number(latest || 0);
        if (tipNum > 0) {
          targetBirthday = Math.max(0, tipNum - 250);
        }
      } catch {
        targetBirthday = isTestnet ? 4515200 : 3522000;
      }
    }
    if (!targetBirthday || targetBirthday < minReasonable) {
      targetBirthday = isTestnet ? 4515200 : 3522000;
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
        await ensureVeilxReady();
        return { success: true };
      }

      case "INIT_WALLET_ACCOUNT": {
        const { mnemonic, network = "testnet" } = payload;
        await ensureVeilxReady();
        const nativeAcc = veilxEngine.derive_orchard_account(mnemonic, 0, network);

        return {
          success: true,
          accountId: 1,
          unifiedAddress: nativeAcc.unified_address,
          transparentAddress: nativeAcc.transparent_address,
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
        return await syncShieldedNative(payload);
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
        await clearPersistedDbBytes();
        if (activeWallet) {
          try {
            activeWallet.free();
          } catch {}
          activeWallet = null;
        }
        return await syncShieldedNative({
          ...payload,
          forceRecreate: true,
        });
      }

      case "GET_TRANSACTION_HISTORY": {
        try {
          const spendableNotes = await loadSpendableNotes();
          const sentHistory = await loadSentHistory();

          const incomingTxs = spendableNotes.map((n) => ({
            txid: n.txid || ("0x" + (n.cmx_hex || "").slice(0, 16)),
            transactionType: "received",
            status: n.spent ? "spent" : "confirmed",
            valueZats: (n.value_zatoshis || 0).toString(),
            valueTaz: (Number(n.value_zatoshis || 0) / 1e8).toFixed(4),
            blockHeight: n.block_height || 0,
            timestamp: Date.now(),
            memo: n.memo_text || "",
          }));

          const outgoingTxs = sentHistory.map((s) => ({
            txid: s.txid || "sent",
            transactionType: "sent",
            status: "confirmed",
            valueZats: (s.value_zatoshis || 0).toString(),
            valueTaz: (Number(s.value_zatoshis || 0) / 1e8).toFixed(4),
            blockHeight: s.block_height || 0,
            timestamp: s.timestamp || Date.now(),
            memo: s.memo_text || "",
          }));

          const allTxs = [...incomingTxs, ...outgoingTxs];
          allTxs.sort((a, b) => (b.blockHeight || 0) - (a.blockHeight || 0));

          return { success: true, transactions: allTxs };
        } catch (e) {
          console.warn("[VeilX Offscreen] get_transaction_history warning:", e?.message || e);
          return { success: true, transactions: [] };
        }
      }

      case "GET_LATEST_BLOCK": {
        try {
          const net = payload?.network || "testnet";
          const grpcEndpoint = net === "mainnet" ? MAINNET_GRPC_WEB_URL : TESTNET_GRPC_WEB_URL;
          const { height } = await fetchLatestBlockHeight(grpcEndpoint);
          return { latestBlockHeight: height.toString() };
        } catch (e) {
          console.warn("[VeilX Offscreen] get_latest_block warning:", e?.message || e);
          throw e;
        }
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
