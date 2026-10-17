/**
 * VeilX NU7 Wallet — Injected Inpage Provider (`window.veilx`, `window.zcash`, & `window.noirwallet`)
 * Provides 100% drop-in compatibility with @noir-wallet/sdk and standard Zcash Web3 dApps.
 * Active Consensus Branch ID: 0x37A5165B (NU6.3 / Ironwood on Testnet)
 */
(function () {
  if (window.veilx) return;

  const pendingRequests = new Map();
  let reqCounter = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.target !== "VEILX_NU7_INPAGE") {
      return;
    }
    const { id, result, error } = event.data;
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);
    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
  });

  function sendBridgeRequest(method, params = []) {
    return new Promise((resolve, reject) => {
      const id = `nu7-${++reqCounter}-${Date.now()}`;
      pendingRequests.set(id, { resolve, reject });
      window.postMessage(
        {
          target: "VEILX_NU7_CONTENT",
          id,
          method,
          params: Array.isArray(params) ? params : [params],
        },
        "*"
      );
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`VeilX Wallet request timed out: ${method}`));
        }
      }, 45000);
    });
  }

  const veilxProvider = {
    isZcash: true,
    isVeilX: true,
    isNoirWallet: true,
    version: "1.0.2",
    consensusBranchId: "0x37a5165b",
    network: "testnet",

    connect: async () => sendBridgeRequest("zcash_connect", []),
    getAccounts: async () => sendBridgeRequest("zcash_getAccounts", []),
    getAddresses: async () => sendBridgeRequest("zcash_getAddresses", []),
    getBalance: async (accountId) => sendBridgeRequest("zcash_getBalance", accountId ? [{ accountId }] : []),
    sendTransaction: async (txParams) => sendBridgeRequest("zcash_sendTransaction", [txParams]),
    signMessage: async (msg, opts) => sendBridgeRequest("zcash_signMessage", [msg, opts || {}]),
    disconnect: async () => sendBridgeRequest("zcash_disconnect", []),

    request: async (args) => {
      if (!args || !args.method) throw new Error("Invalid request: missing method");
      return sendBridgeRequest(args.method, args.params || []);
    },

    on: (event, handler) => {
      window.addEventListener(`veilx:${event}`, (e) => handler(e.detail));
    },
    removeListener: (event, handler) => {
      window.removeEventListener(`veilx:${event}`, handler);
    },
  };

  // 1. Primary VeilX namespace
  Object.defineProperty(window, "veilx", {
    value: veilxProvider,
    writable: false,
    configurable: true,
  });

  // 2. Generic Zcash Web3 Provider
  if (!window.zcash) {
    window.zcash = veilxProvider;
  }

  // 3. Official @noir-wallet/sdk Drop-In Provider
  if (!window.noirwallet) {
    window.noirwallet = {
      isNoirWallet: true,
      version: "1.0.2",
      zcash: veilxProvider,
    };
  }

  // 4. Legacy window.noir fallback
  if (!window.noir) {
    window.noir = {
      isNoir: true,
      connect: async () => {
        const res = await veilxProvider.request({ method: "zcash_requestAccounts" });
        return { address: res.shielded || res.transparent || res.accounts?.[0]?.addresses?.shielded || "connected" };
      },
      sendTransaction: async (payload) => {
        const txid = await veilxProvider.sendTransaction(payload);
        return { txid: typeof txid === "string" ? txid : txid?.txid || String(txid) };
      },
      request: async (args) => veilxProvider.request(args),
    };
  }

  // Dispatch both initialization events
  window.dispatchEvent(new Event("veilx#initialized"));
  window.dispatchEvent(new Event("noirwallet#initialized"));
})();
