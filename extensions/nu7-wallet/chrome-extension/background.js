/**
 * VeilX Shielded Wallet — Background Service Worker (Manifest V3)
 * Provides hybrid on-chain capabilities:
 * 1. WebAssembly Halo 2 zk-SNARK prover via Offscreen Document for shielded (Orchard / Sapling).
 * 2. Real ZIP-225 v5 transaction engine with Consensus Branch ID 0x37A5165B for transparent (P2PKH).
 * 3. Complete @noir-wallet/sdk drop-in compatibility.
 */

try {
  importScripts("wallet-core.bundle.js");
} catch (e) {
  console.error("[VeilX Background] Failed to importScripts wallet-core.bundle.js:", e);
}

const NETWORKS = {
  testnet: {
    name: "testnet",
    ticker: "TAZ",
    consensusBranchId: 0x37a5165b,
    consensusBranchHex: "0x37a5165b",
    upgrade: "NU6.3 / Ironwood (NU7 Active)",
    activationHeight: 3428143,
    p2pkhPrefix: new Uint8Array([0x1d, 0x25]), // tm...
    explorerBaseUrl: "https://zexplorer.app/api/v1/testnet",
    defaultBirthday: 3518000,
  },
  mainnet: {
    name: "mainnet",
    ticker: "ZEC",
    consensusBranchId: 0xc2d6d0b4,
    consensusBranchHex: "0xc2d6d0b4",
    upgrade: "NU5 / Orchard",
    activationHeight: 1687104,
    p2pkhPrefix: new Uint8Array([0x1c, 0xb8]), // t1...
    explorerBaseUrl: "https://zexplorer.app/api/v1/mainnet",
    defaultBirthday: 2275000,
  },
};

const ACTIVE_TESTNET_BRANCH_ID = 0x37a5165b;

let offscreenCreationPromise = null;

async function hasOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    return chrome.offscreen.hasDocument();
  }
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen.html")],
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  if (offscreenCreationPromise) {
    await offscreenCreationPromise;
    return;
  }

  if (chrome.offscreen && chrome.offscreen.createDocument) {
    offscreenCreationPromise = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS", "BLOBS"],
      justification: "Generate Halo 2 zero-knowledge proofs and sync shielded notes for Zcash testnet",
    });
    await offscreenCreationPromise;
    offscreenCreationPromise = null;
  }
}

async function sendOffscreenMessage(action, payload) {
  await ensureOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ target: "VEILX_OFFSCREEN", action, payload }, (response) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr) return reject(new Error(lastErr.message));
      if (response && response.error) return reject(new Error(response.error));
      resolve(response?.result);
    });
  });
}

let activeSessionVault = null;

async function getVaultData() {
  if (activeSessionVault) return activeSessionVault;
  return new Promise((resolve) => {
    chrome.storage.local.get(["veilxVault"], (data) => {
      const stored = data?.veilxVault || null;
      if (stored && stored.isEncrypted) {
        // Vault is locked on disk; requires password unlock
        resolve(null);
      } else {
        resolve(stored);
      }
    });
  });
}

async function getWalletState() {
  const vault = await getVaultData();
  if (vault && vault.account) {
    const netKey = vault.network === "mainnet" ? "mainnet" : "testnet";
    const netCfg = NETWORKS[netKey];
    return {
      address: vault.account.address,
      unifiedAddress: vault.account.unifiedAddress,
      saplingAddress: vault.account.saplingAddress,
      publicKey: vault.account.publicKey || vault.account.publicKeyHex,
      network: netCfg.name,
      consensusBranchId: netCfg.consensusBranchHex,
      rpcUrl: vault.rpcUrl || "http://127.0.0.1:18232",
    };
  }

  // If vault is locked on disk, check for publicView
  const rawData = await new Promise((resolve) => {
    chrome.storage.local.get(["veilxVault"], (d) => resolve(d?.veilxVault || null));
  });
  if (rawData && rawData.publicView) {
    const netKey = rawData.publicView.network === "mainnet" ? "mainnet" : "testnet";
    const netCfg = NETWORKS[netKey];
    return {
      address: rawData.publicView.address,
      unifiedAddress: rawData.publicView.unifiedAddress,
      saplingAddress: rawData.publicView.saplingAddress,
      publicKey: rawData.publicView.publicKey || rawData.publicView.publicKeyHex,
      network: netCfg.name,
      consensusBranchId: netCfg.consensusBranchHex,
      rpcUrl: rawData.publicView.rpcUrl || "http://127.0.0.1:18232",
    };
  }

  // Strictly fail closed: no dummy keypair fallbacks
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return false;

  // Session Vault Management from Popup
  if (message.type === "VEILX_SESSION_UNLOCK") {
    activeSessionVault = message.vault;
    if (chrome.action && chrome.action.setBadgeText) {
      chrome.action.setBadgeText({ text: "" });
    }
    console.log("[VeilX Background] ✓ Unlocked vault received in worker session memory.");
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "VEILX_SESSION_LOCK") {
    activeSessionVault = null;
    if (chrome.action && chrome.action.setBadgeText) {
      chrome.action.setBadgeText({ text: "LOCK" });
      chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    }
    console.log("[VeilX Background] 🔒 Vault session locked; keys wiped from worker memory.");
    sendResponse({ success: true });
    return true;
  }

  // Handle Shielded Prover requests from popup or internal callers
  if (message.type === "VEILX_SHIELDED_SEND") {
    (async () => {
      const vault = await getVaultData();
      if (!vault || !vault.mnemonic) {
        throw new Error("Vault is locked or uninitialized. Missing mnemonic for shielded proof.");
      }
      return sendOffscreenMessage("SEND_SHIELDED", {
        mnemonic: vault.mnemonic,
        toAddress: message.to,
        amountZatoshis: String(message.amountZatoshis),
        birthdayHeight: message.birthdayHeight || vault.birthdayHeight,
      });
    })()
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_INIT_ACCOUNT") {
    (async () => {
      if (!message.mnemonic) {
        throw new Error("Missing mnemonic for account initialization.");
      }
      return sendOffscreenMessage("INIT_WALLET_ACCOUNT", {
        mnemonic: message.mnemonic,
        birthdayHeight: message.birthdayHeight,
        forceRecreate: message.forceRecreate,
      });
    })()
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_SHIELDED_SYNC") {
    (async () => {
      const vault = await getVaultData();
      if (!vault || !vault.mnemonic) {
        throw new Error("Vault is locked or uninitialized.");
      }
      return sendOffscreenMessage("SYNC_SHIELDED", {
        mnemonic: vault.mnemonic,
        birthdayHeight: message.birthdayHeight || vault.birthdayHeight || 4500400,
        forceRecreate: message.forceRecreate,
      });
    })()
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_RESET_SHIELDED_DB") {
    (async () => {
      const vault = await getVaultData();
      if (!vault || !vault.mnemonic) {
        throw new Error("Vault is locked or uninitialized.");
      }
      return sendOffscreenMessage("RESET_SHIELDED_DB", {
        mnemonic: vault.mnemonic,
        birthdayHeight: message.birthdayHeight || vault.birthdayHeight || 4500400,
      });
    })()
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_GET_TRANSACTION_HISTORY") {
    (async () => {
      const mnemonic = message.mnemonic || vault?.mnemonic;
      if (!mnemonic) {
        return { success: true, transactions: [] };
      }
      return sendOffscreenMessage("GET_TRANSACTION_HISTORY", {
        mnemonic,
        limit: message.limit || 20,
        offset: message.offset || 0,
      });
    })()
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  // Native VeilX Orchard Tree & Shielded Spend Proxy
  if (message.type === "VEILX_NATIVE_SHIELDED_SPEND") {
    (async () => {
      const vault = await getVaultData();
      if (!vault || !vault.mnemonic) {
        throw new Error("Vault is locked or uninitialized.");
      }
      return sendOffscreenMessage("BUILD_NATIVE_SHIELDED_SPEND", {
        ...message.payload,
        spending_key_hex: message.payload.spending_key_hex,
      });
    })()
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_GET_SPENDABLE_NOTES") {
    sendOffscreenMessage("GET_SPENDABLE_NOTES", {})
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_TREE_STATE") {
    sendOffscreenMessage("TREE_GET_STATE", {})
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_EXPORT_UFVK") {
    (async () => {
      const vault = await getVaultData();
      if (!vault || !vault.mnemonic) {
        throw new Error("Vault is locked or uninitialized.");
      }
      return sendOffscreenMessage("EXPORT_UFVK", {
        mnemonic: vault.mnemonic,
        account_index: message.account_index || 0,
        network: message.network || "testnet",
      });
    })()
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_GET_SENT_HISTORY") {
    sendOffscreenMessage("GET_SENT_HISTORY", {})
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "VEILX_GET_LATEST_BLOCK") {
    (async () => {
      // 1. Try querying offscreen worker
      try {
        const res = await sendOffscreenMessage("GET_LATEST_BLOCK", {});
        if (res && res.latestBlockHeight) {
          const h = Number(res.latestBlockHeight);
          if (h > 0) return { height: h };
        }
      } catch (e) {}

      // 2. Try public testnet explorer / API
      try {
        const resp = await fetch("https://testnet.zcash.guru/api/v1/network-info");
        if (resp.ok) {
          const json = await resp.json();
          if (json?.data?.tip?.height) return { height: Number(json.data.tip.height) };
          if (json?.height) return { height: Number(json.height) };
        }
      } catch (e) {}

      // 3. Try local Zebra RPC if available
      try {
        const zebraResp = await fetch("http://127.0.0.1:18232", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getblockcount", params: [] }),
        });
        if (zebraResp.ok) {
          const zJson = await zebraResp.json();
          if (typeof zJson.result === "number" && zJson.result > 0) {
            return { height: zJson.result };
          }
        }
      } catch (e) {}

      // Default to known recent testnet block height
      return { height: 3518000 };
    })()
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  // Handle Web3 RPC (from inpage via content script)
  if (message.type !== "VEILX_RPC") return false;

  (async () => {
    const state = await getWalletState();
    const vault = await getVaultData();
    const { method, params } = message;
    const txParam = Array.isArray(params) ? params[0] : (params || {});

    if (!state && method !== "zcash_disconnect") {
      throw new Error("VeilX wallet is locked or uninitialized. Please open and unlock your VeilX extension.");
    }

    const netKey = (state && state.network === "mainnet") ? "mainnet" : "testnet";
    const netCfg = NETWORKS[netKey];

    switch (method) {
      case "zcash_connect":
      case "zcash_requestAccounts":
      case "zcash_getAccounts": {
        const primaryShielded = state.unifiedAddress || state.address;
        return {
          transparent: state.address,
          shielded: primaryShielded,
          accounts: [
            {
              id: "veilx-0",
              label: "VeilX Account 1",
              walletId: "veilx",
              accountId: "0",
              addresses: {
                transparent: state.address,
                shielded: primaryShielded,
              },
            },
          ],
        };
      }

      case "zcash_getAddresses": {
        return {
          transparent: state.address,
          shielded: state.unifiedAddress || state.address,
          unified: state.unifiedAddress || state.address,
        };
      }

      case "zcash_getBalance": {
        let confirmedZec = 0;
        try {
          const res = await fetch(
            `${netCfg.explorerBaseUrl}/transparent-addresses/${encodeURIComponent(state.address)}`
          );
          if (res.ok) {
            const json = await res.json();
            if (json.data) {
              const confirmedZat = Number(json.data.confirmed_zat || 0);
              confirmedZec = confirmedZat / 1e8;
            }
          }
        } catch (e) {
          console.warn("[VeilX Background] Balance fetch error:", e);
        }

        let shieldedZec = 0;
        if (vault) {
          if (typeof vault.shieldedBalance === "number" && vault.shieldedBalance > 0) {
            shieldedZec = vault.shieldedBalance;
          } else if (vault.shieldedClaims && vault.shieldedClaims.length > 0) {
            shieldedZec = vault.shieldedClaims.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
          }
        }

        const totalZec = confirmedZec + shieldedZec;
        const totalStr = totalZec.toFixed(8);
        const transStr = confirmedZec.toFixed(8);
        const shieldStr = shieldedZec.toFixed(8);

        return {
          total: totalStr,
          transparent: transStr,
          shielded: shieldStr,
          confirmed: totalStr,
          spendable: totalStr,
          available: totalStr,
          accounts: [
            {
              id: "veilx-0",
              walletId: "veilx",
              accountId: "0",
              balance: {
                total: totalStr,
                transparent: transStr,
                shielded: shieldStr,
                confirmed: totalStr,
                spendable: totalStr,
                available: totalStr,
              },
              synced: true,
            },
          ],
        };
      }

      case "zcash_getConsensusInfo": {
        return {
          upgrade: netCfg.upgrade,
          consensusBranchId: netCfg.consensusBranchHex,
          activationHeight: netCfg.activationHeight,
          blockSpacingSeconds: 75,
          txVersion: 5,
        };
      }

      case "zcash_sendTransaction": {
        if (!vault || !vault.account) {
          throw new Error("VeilX wallet is locked or uninitialized. Please open and unlock the VeilX extension popup to approve transactions.");
        }

        const to = txParam.to;
        const amount = parseFloat(txParam.amount);
        if (!to) throw new Error("Invalid parameters: 'to' recipient address is required.");
        if (isNaN(amount) || amount <= 0) throw new Error("Invalid parameters: 'amount' must be greater than 0.");
        const amountZatoshis = BigInt(Math.round(amount * 1e8));

        // If recipient is shielded or funding source is explicitly shielded: use WebAssembly Prover!
        const isShieldedRecipient = to.startsWith("u") || to.startsWith("z");
        const isShieldedFunding = txParam.fundingSource === "shielded";

        if (isShieldedRecipient || isShieldedFunding) {
          console.log("[VeilX Background] Delegating shielded transaction to WebAssembly Halo 2 prover...");
          const res = await sendOffscreenMessage("SEND_SHIELDED", {
            mnemonic: vault.mnemonic,
            toAddress: to,
            amountZatoshis: amountZatoshis.toString(),
          });

          // Record in vault transaction history
          if (!vault.transactions) vault.transactions = [];
          vault.transactions.unshift({
            txid: res.txid,
            type: "dapp_shielded_send",
            amount: -amount,
            to,
            timestamp: Date.now(),
            status: "broadcasted",
          });
          await new Promise((r) => chrome.storage.local.set({ veilxVault: vault }, r));

          return res.txid;
        }

        // TRANSPARENT SPEND: ZIP-225 Version 5 on network consensus branch ID
        const core = self.VeilXWalletCore || globalThis.VeilXWalletCore;
        if (!core) {
          throw new Error("Wallet cryptographic core is unavailable in background worker.");
        }

        // 1. Fetch fresh UTXOs from public indexer
        let utxos = [];
        try {
          const res = await fetch(
            `${netCfg.explorerBaseUrl}/transparent-addresses/${encodeURIComponent(vault.account.address)}`
          );
          if (res.ok) {
            const json = await res.json();
            if (json.data && json.data.utxos) {
              utxos = json.data.utxos;
            }
          }
        } catch (e) {
          console.warn("[VeilX Background] UTXO fetch failed:", e);
        }

        if (utxos.length === 0 && vault.utxos && vault.utxos.length > 0) {
          utxos = vault.utxos;
        }

        if (!utxos || utxos.length === 0) {
          throw new Error(
            `No confirmed UTXOs found on ${netCfg.name} for address ${vault.account.address}. Please fund your wallet.`
          );
        }

        // 2. Fetch current block height
        let currentHeight = netCfg.defaultBirthday;
        try {
          const tipRes = await fetch(`${netCfg.explorerBaseUrl}/blocks?limit=1`);
          if (tipRes.ok) {
            const tipJson = await tipRes.json();
            if (tipJson.data && tipJson.data.length > 0 && tipJson.data[0].height) {
              currentHeight = Number(tipJson.data[0].height);
            }
          }
        } catch (e) {
          console.warn("[VeilX Background] Block height fetch error:", e);
        }

        // Resolve destination address: if Unified Address with P2PKH receiver, extract transparent address
        let destAddress = to;
        if (to.startsWith("utest1") || to.startsWith("u1")) {
          try {
            const decoded = core.decodeUnifiedAddress(to);
            const p2pkhRecv = decoded.receivers.find((r) => r.typecode === 0x00);
            if (p2pkhRecv) {
              destAddress = core.base58CheckEncode(netCfg.p2pkhPrefix, p2pkhRecv.data);
            }
          } catch {}
        }

        // 3. Build and Sign real ZIP-225 Version 5 Transaction with dynamic Branch ID
        const signed = core.buildAndSignNU7Transaction({
          account: vault.account,
          utxos,
          toAddress: destAddress,
          amountZatoshis,
          currentBlockHeight: currentHeight,
          consensusBranchId: netCfg.consensusBranchId,
        });

        // 4. Broadcast to public node
        const bRes = await fetch(`${netCfg.explorerBaseUrl}/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            network: netCfg.name,
            raw_transaction_hex: signed.rawHex,
          }),
        });
        const bJson = await bRes.json();

        if (
          bJson.data &&
          (bJson.data.transaction_id || bJson.data.outcome === "accepted" || bJson.data.outcome === "success")
        ) {
          const confirmedTxId = bJson.data.transaction_id || signed.txid;

          if (!vault.transactions) vault.transactions = [];
          vault.transactions.unshift({
            txid: confirmedTxId,
            type: "dapp_send",
            amount: -amount,
            fee: Number(signed.feeZatoshis) / 1e8,
            to,
            timestamp: Date.now(),
            blockHeight: currentHeight,
            status: "broadcasted",
          });
          await new Promise((r) => chrome.storage.local.set({ veilxVault: vault }, r));

          return confirmedTxId;
        }

        throw new Error(
          `Node rejected transaction: ${bJson.data?.upstream_message || "Failed to broadcast to mempool"}`
        );
      }

      case "zcash_signMessage": {
        if (!vault || !vault.account) {
          throw new Error("VeilX wallet is locked. Please unlock the extension to sign messages.");
        }
        const core = self.VeilXWalletCore || globalThis.VeilXWalletCore;
        if (!core || typeof core.signZcashMessage !== "function") {
          throw new Error("Cryptographic core does not support message signing.");
        }
        const rawMsg = txParam.message !== undefined ? txParam.message : (typeof txParam === "string" ? txParam : "");
        if (!rawMsg) throw new Error("Invalid parameters: 'message' is required for signing.");
        const privKey = vault.account.privateKey || vault.account.private_key || vault.account.privateKeyHex;
        if (!privKey) throw new Error("Vault is missing private key for account.");
        const signed = core.signZcashMessage(rawMsg, privKey);
        return {
          address: vault.account.address,
          signature: signed.signatureBase64,
          signatureHex: signed.signatureHex,
          hash: signed.hashHex,
        };
      }

      case "zcash_disconnect": {
        return true;
      }

      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  })()
    .then((result) => sendResponse({ result }))
    .catch((err) => sendResponse({ error: err.message || String(err) }));

  return true;
});
