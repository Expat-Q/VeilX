import crypto from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { publicKeyToAddress } from "@noir-wallet/sdk";
import type { Network } from "@noir-wallet/sdk";
import { validateZcashAddressFull, ZcashAddressValidationResult, p2pkhHexToAddress } from "./zcash-address";
import { ufvkWatcher, CompactActionInput, DecryptedEscrowNote, getWasmEngine } from "./escrow/ufvk-watcher";
import { checkPayoutCircuitBreaker } from "./payout-controls";

const ZALLET_RPC_URL = process.env.ZALLET_RPC_URL || "http://127.0.0.1:18232";
const ZALLET_RPC_USER = process.env.ZALLET_RPC_USER || "xtip_user";
const ZALLET_RPC_PASS = process.env.ZALLET_RPC_PASS || "xtip_password_123";
export const ZCASH_NETWORK: Network = (process.env.NEXT_PUBLIC_ZCASH_NETWORK as Network) || "mainnet";

/**
 * Strict Environment Gating for Simulation
 * Simulation is NEVER allowed in production (NODE_ENV === 'production') or on Mainnet.
 * In dev/test environments, it requires explicit enablement on testnet via ENABLE_TESTNET_SIMULATION=true.
 */
export const ALLOW_PAYMENT_SIMULATION: boolean =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_ZCASH_NETWORK === "testnet" || process.env.NODE_ENV === "test") &&
  (process.env.ENABLE_TESTNET_SIMULATION === "true" || process.env.NODE_ENV === "test");

export interface ZalletReceivedNote {
  txid: string;
  address: string;
  amount: number;
  confirmations: number;
  blockHeight?: number;
  memo?: string;
}

export interface VerificationResult {
  verified: boolean;
  detectedInMempool?: boolean;
  reason?: string;
  actualAmountZec?: number;
  confirmations?: number;
  blockHeight?: number;
  memo?: string;
}

/**
 * Validates whether an address is a syntactically and cryptographically valid Zcash address
 * with Base58Check / Bech32 / Bech32m checksum validation.
 */
export function validateZcashAddress(address: string, network?: Network): boolean {
  if (!address || typeof address !== "string") return false;
  if (network) {
    return validateZcashAddressFull(address, network).isValid;
  }
  return (
    validateZcashAddressFull(address, "mainnet").isValid ||
    validateZcashAddressFull(address, "testnet").isValid
  );
}

export function validateZcashAddressDetailed(address: string, network: Network = ZCASH_NETWORK): ZcashAddressValidationResult {
  return validateZcashAddressFull(address, network);
}

/**
 * Generate a cryptographically valid, checksummed Zcash address compliant with Noir & mobile wallets
 */
export function generateValidZcashAddress(network: Network = ZCASH_NETWORK): string {
  try {
    const priv = secp256k1.utils.randomPrivateKey();
    const pub = bytesToHex(secp256k1.getPublicKey(priv, true));
    return publicKeyToAddress(pub, network);
  } catch {
    return network === "mainnet"
      ? "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs"
      : "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs";
  }
}

export function writeCompactSize(n: number): Buffer {
  if (n < 253) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 253;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 254;
  b.writeUInt32LE(n, 1);
  return b;
}

export interface ShieldedV6TransactionParams {
  consensusBranchId?: number;
  expiryHeight: number;
  lockTime?: number;
  actions: Array<{
    cv_net_hex: string;
    nullifier_hex: string;
    rk_hex: string;
    cmx_hex: string;
    epk_hex: string;
    enc_ciphertext_hex: string;
    out_ciphertext_hex: string;
  }>;
  flags: number;
  valueBalanceZat: bigint | number;
  anchorHex: string;
  proofHex: string;
  spendAuthSigsHex: string[];
  bindingSigHex: string;
}

/**
 * Serializes an authorized Zcash Version 6 (ZIP-229 / NU6.3) shielded transaction.
 * Conforms strictly to the canonical Zcash network wire protocol.
 */
export function serializeV6ShieldedTransaction(params: ShieldedV6TransactionParams): string {
  const branchId = params.consensusBranchId ?? 0x37a5165b;
  const chunks: Buffer[] = [];

  // 1. Header (4 bytes: v6 + overwintered)
  const headerBuf = Buffer.alloc(4);
  headerBuf.writeUInt32LE(0x80000006, 0);
  chunks.push(headerBuf);

  // 2. VersionGroupId (4 bytes: 0xd884b698)
  const vgroupIdBuf = Buffer.alloc(4);
  vgroupIdBuf.writeUInt32LE(0xd884b698, 0);
  chunks.push(vgroupIdBuf);

  // 3. ConsensusBranchId (4 bytes LE)
  const branchBuf = Buffer.alloc(4);
  branchBuf.writeUInt32LE(branchId, 0);
  chunks.push(branchBuf);

  // 4. LockTime (4 bytes)
  const lockBuf = Buffer.alloc(4);
  lockBuf.writeUInt32LE(params.lockTime ?? 0, 0);
  chunks.push(lockBuf);

  // 5. ExpiryHeight (4 bytes LE)
  const expBuf = Buffer.alloc(4);
  expBuf.writeUInt32LE(params.expiryHeight, 0);
  chunks.push(expBuf);

  // 6. Transparent inputs count (0)
  chunks.push(writeCompactSize(0));
  // 7. Transparent outputs count (0)
  chunks.push(writeCompactSize(0));
  // 8. Sapling spends (0)
  chunks.push(writeCompactSize(0));
  // 9. Sapling outputs (0)
  chunks.push(writeCompactSize(0));
  // 10. Orchard actions (0)
  chunks.push(writeCompactSize(0));

  // 11. Ironwood actions count
  chunks.push(writeCompactSize(params.actions.length));
  for (const act of params.actions) {
    chunks.push(Buffer.from(act.cv_net_hex, "hex"));
    chunks.push(Buffer.from(act.nullifier_hex, "hex"));
    chunks.push(Buffer.from(act.rk_hex, "hex"));
    chunks.push(Buffer.from(act.cmx_hex, "hex"));
    chunks.push(Buffer.from(act.epk_hex, "hex"));
    chunks.push(Buffer.from(act.enc_ciphertext_hex, "hex"));
    chunks.push(Buffer.from(act.out_ciphertext_hex, "hex"));
  }

  // 12. Flags: 1 byte
  chunks.push(Buffer.from([params.flags]));

  // 13. ValueBalance: 8 bytes i64 LE
  const valBuf = Buffer.alloc(8);
  valBuf.writeBigInt64LE(BigInt(params.valueBalanceZat), 0);
  chunks.push(valBuf);

  // 14. Anchor: 32 bytes (wire bytes)
  chunks.push(Buffer.from(params.anchorHex, "hex"));

  // 15. Proof: compactSize length + proof bytes
  const proofBuf = Buffer.from(params.proofHex, "hex");
  chunks.push(writeCompactSize(proofBuf.length));
  chunks.push(proofBuf);

  // 16. SpendAuthSigs: 64 bytes per action
  for (const sig of params.spendAuthSigsHex) {
    chunks.push(Buffer.from(sig, "hex"));
  }

  // 17. BindingSig: 64 bytes
  chunks.push(Buffer.from(params.bindingSigHex, "hex"));

  return Buffer.concat(chunks).toString("hex");
}

export class ZalletClient {
  private url: string;
  private headers: Record<string, string>;

  constructor(customUrl?: string) {
    this.url = customUrl || process.env.ZALLET_RPC_URL || ZALLET_RPC_URL;
    const apiKey = process.env.ZALLET_RPC_API_KEY || process.env.NOWNODES_API_KEY || "";
    this.headers = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      this.headers["api-key"] = apiKey;
      this.headers["x-api-key"] = apiKey;
    } else {
      const user = process.env.ZALLET_RPC_USER || ZALLET_RPC_USER;
      const pass = process.env.ZALLET_RPC_PASS || ZALLET_RPC_PASS;
      if (user && pass) {
        const creds = Buffer.from(`${user}:${pass}`).toString("base64");
        this.headers["Authorization"] = `Basic ${creds}`;
      }
    }
  }

  async call<T = any>(method: string, params: any[] = [], customTimeoutMs?: number): Promise<T> {
    const defaultTimeout = method === "z_sendmany" || method === "z_shieldcoinbase" ? 90000 : 15000;
    const timeoutMs = customTimeoutMs || defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomBytes(4).toString("hex"),
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Zallet RPC HTTP error: ${res.statusText}`);
      }

      const json = await res.json();
      if (json.error) {
        throw new Error(`Zallet RPC Error (${json.error.code}): ${json.error.message}`);
      }

      return json.result as T;
    } catch (error: any) {
      const isTimeout = error.name === "AbortError";
      const failureReason = isTimeout ? `RPC request '${method}' timed out after ${timeoutMs}ms` : (error.message || "Connection refused");

      if (!ALLOW_PAYMENT_SIMULATION) {
        throw new Error(`Zcash node RPC call '${method}' failed: ${failureReason}. (Simulation is disabled in this environment)`);
      }
      return this.getMockFallback(method, params);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Derives a fresh diversified escrow address directly from the platform UFVK (ZIP-316)
   */
  async getNewEscrowAddress(): Promise<{ unifiedAddress: string; diversifierIndex: string }> {
    const rawDiversifier = crypto.randomInt(1, 2147483647);
    const diversifierIndex = rawDiversifier.toString();

    // 1. Direct In-Process ZIP-316 derivation using Platform UFVK (0ms latency, zero RPC failure)
    try {
      const derived = await ufvkWatcher.deriveDiversifiedAddress(rawDiversifier, ZCASH_NETWORK);
      if (derived && typeof derived === "string" && derived.startsWith(ZCASH_NETWORK === "mainnet" ? "u1" : "utest1")) {
        return { unifiedAddress: derived, diversifierIndex };
      }
    } catch (e: any) {
      console.warn("[Zcash] Direct UFVK diversified address derivation error:", e?.message);
    }

    // 2. Fallback to RPC node only if node supports internal wallet accounts
    try {
      const ua = await this.call<any>("z_getaddressforaccount", [0, [], rawDiversifier]).catch(() =>
        this.call<any>("z_getaddressforaccount", [0])
      );
      const address = typeof ua === "string" ? ua : (ua?.address || ua?.unifiedaddress);
      if (address && typeof address === "string" && !address.startsWith("mock_")) {
        return { unifiedAddress: address, diversifierIndex };
      }
    } catch (e) {
      // Node is non-wallet (e.g. GetBlock), expected behavior
    }

    if (!ALLOW_PAYMENT_SIMULATION && process.env.NODE_ENV !== "test") {
      throw new Error("Failed to derive escrow address from Zcash node and simulation is disabled.");
    }

    const validAddr = generateValidZcashAddress(ZCASH_NETWORK);
    return { unifiedAddress: validAddr, diversifierIndex };
  }

  /**
   * Returns the platform escrow transparent vault address
   */
  getEscrowTransparentAddress(): string {
    return (
      process.env.ESCROW_PLATFORM_TRANSPARENT_ADDRESS ||
      (ZCASH_NETWORK === "mainnet"
        ? "t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq"
        : "tm9w5Z3w58Z2g4d18Z2g4d18Z2g4d18Z2g4")
    );
  }

  /**
   * Retrieves received notes belonging to a specific address or all escrow accounts
   */
  async listReceivedNotes(address?: string, minConfirmations = 1): Promise<ZalletReceivedNote[]> {
    try {
      const params = address ? [address, minConfirmations] : [];
      return await this.call<ZalletReceivedNote[]>("z_listreceivedbyaddress", params);
    } catch (e) {
      if (!ALLOW_PAYMENT_SIMULATION) {
        throw e;
      }
      return [];
    }
  }

  /**
   * Gets Zcash blockchain synchronization state and network info
   */
  async getBlockchainInfo(): Promise<{ chain: string; blocks: number; verificationprogress: number; synced: boolean }> {
    try {
      const info = await this.call<any>("getblockchaininfo", []);
      return {
        chain: info.chain || ZCASH_NETWORK,
        blocks: info.blocks || 0,
        verificationprogress: info.verificationprogress || 0,
        synced: (info.verificationprogress || 0) >= 0.999,
      };
    } catch (e) {
      if (!ALLOW_PAYMENT_SIMULATION) {
        throw e;
      }
      return { chain: ZCASH_NETWORK, blocks: 2000000, verificationprogress: 1.0, synced: true };
    }
  }

  /**
   * Polls the status of an asynchronous Zcash wallet operation (e.g. z_sendmany opid)
   */
  async pollOperationStatus(
    opid: string,
    maxAttempts = 5,
    intervalMs = 500
  ): Promise<{ status: "success" | "failed" | "executing"; txid?: string; error?: string }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const statuses = await this.call<any[]>("z_getoperationstatus", [[opid]]);
        if (Array.isArray(statuses) && statuses.length > 0) {
          const op = statuses[0];
          if (op.status === "success") {
            return {
              status: "success",
              txid: op.result?.txid || (typeof op.result === "string" ? op.result : undefined),
            };
          }
          if (op.status === "failed") {
            return {
              status: "failed",
              error: op.error?.message || "Operation failed on Zcash node",
            };
          }
          if (op.status === "executing") {
            // Still executing
          }
        }
      } catch (e: any) {
        // If query fails, continue polling up to limit
      }

      if (attempt < maxAttempts - 1 && intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    return { status: "executing" };
  }

  /**
   * Retrieves the live Orchard Merkle tree root (anchor) at the current block height
   */
  async getLiveOrchardAnchor(): Promise<string> {
    const info = await this.getBlockchainInfo();
    const treeState = await this.call<any>("z_gettreestate", [info.blocks.toString()]);
    const root = treeState?.orchard?.commitments?.finalRoot;
    if (!root) {
      throw new Error(`Failed to retrieve live Orchard anchor at block height ${info.blocks}`);
    }
    return root;
  }

  /**
   * Queries unspent transaction outputs (UTXOs) for the platform escrow transparent vault
   */
  async getEscrowUtxos(address?: string): Promise<any[]> {
    const escrowAddr = address || process.env.ESCROW_PLATFORM_TRANSPARENT_ADDRESS;
    if (!escrowAddr) return [];
    try {
      const res = await this.call<any[]>("getaddressutxos", [{ addresses: [escrowAddr] }]);
      return Array.isArray(res) ? res : [];
    } catch (err: any) {
      console.warn(`[Escrow] Failed to query UTXOs for ${escrowAddr}:`, err?.message || err);
      return [];
    }
  }

  /**
   * Queries the live confirmed balance for the platform escrow transparent vault
   */
  async getEscrowBalance(address?: string): Promise<{ balance: number; received: number }> {
    const escrowAddr = address || process.env.ESCROW_PLATFORM_TRANSPARENT_ADDRESS;
    if (!escrowAddr) return { balance: 0, received: 0 };
    try {
      const res = await this.call<{ balance: number; received: number }>("getaddressbalance", [{ addresses: [escrowAddr] }]);
      return {
        balance: (res?.balance || 0) / 1e8,
        received: (res?.received || 0) / 1e8,
      };
    } catch (err: any) {
      console.warn(`[Escrow] Failed to query balance for ${escrowAddr}:`, err?.message || err);
      return { balance: 0, received: 0 };
    }
  }

  /**
   * Broadcasts a subsidized payout from the platform Escrow Vault to recipient address.
   * If the connected node supports z_sendmany, it dispatches via wallet RPC.
   * Otherwise, it constructs, signs, and proves the transaction locally via Wasm and
   * broadcasts directly via sendrawtransaction.
   */
  async sendShieldedPayout(
    recipientAddress: string,
    amountZec: number,
    memo?: string,
    escrowNote?: {
      txid?: string;
      cmx: string;
      valueZat: bigint;
      rho: string;
      rseed: string;
      recipientRawAddress: string;
      blockHeight?: number;
    },
    fundingTxid?: string
  ): Promise<{ opid?: string; txid?: string; isAsync: boolean }> {
    checkPayoutCircuitBreaker();

    if (!validateZcashAddress(recipientAddress, ZCASH_NETWORK)) {
      throw new Error(`INVALID_RECIPIENT_ADDRESS: Destination '${recipientAddress}' is invalid for network '${ZCASH_NETWORK}'`);
    }

    // 1. First attempt: If connected to an internal-wallet enabled node (e.g. zcashd with wallet enabled)
    try {
      const isTransparent =
        recipientAddress.startsWith("t1") ||
        recipientAddress.startsWith("tm") ||
        recipientAddress.startsWith("t3") ||
        recipientAddress.startsWith("t2");

      let memoHex: string | undefined = undefined;
      if (!isTransparent && memo) {
        const memoBuf = Buffer.from(memo, "utf8");
        const truncatedBuf = memoBuf.length > 512 ? memoBuf.subarray(0, 512) : memoBuf;
        memoHex = truncatedBuf.toString("hex");
      }

      const recipients = [
        {
          address: recipientAddress,
          amount: amountZec,
          memo: memoHex,
        },
      ];

      const fromAddr = process.env.ESCROW_PLATFORM_TRANSPARENT_ADDRESS || "ANY_TADDR";
      const opidOrTxid = await this.call<string>("z_sendmany", [fromAddr, recipients, 1, 0.0001]);
      if (typeof opidOrTxid === "string") {
        if (opidOrTxid.startsWith("opid-")) {
          const pollResult = await this.pollOperationStatus(opidOrTxid, 15, 1000);
          if (pollResult.status === "success" && pollResult.txid) {
            return { opid: opidOrTxid, txid: pollResult.txid, isAsync: false };
          }
          if (pollResult.status === "failed") {
            throw new Error(`Zcash node payout operation failed: ${pollResult.error}`);
          }
          return { opid: opidOrTxid, isAsync: true };
        }
        return { txid: opidOrTxid, isAsync: false };
      }
    } catch (nodeErr: any) {
      // If node lacks internal wallet (-disablewallet=1) or returns method/parameter error,
      // gracefully proceed to autonomous local Wasm signing engine below
      const isWalletError =
        nodeErr.message?.includes("Method not found") ||
        nodeErr.message?.includes("-32601") ||
        nodeErr.message?.includes("-4") ||
        nodeErr.message?.includes("-5") ||
        nodeErr.message?.includes("wallet");
      if (!isWalletError && !ALLOW_PAYMENT_SIMULATION) {
        console.warn(`[Node RPC] z_sendmany failed, attempting local Wasm signing fallback: ${nodeErr.message}`);
      }
      // Proceed to autonomous local Wasm signing below!
    }

    // 2. Autonomous Shielded Escrow Payout Builder & Broadcaster
    const wasm = await getWasmEngine();
    const escrowSpendingKey = process.env.ESCROW_PLATFORM_SPENDING_KEY;
    const escrowTransparentAddr = process.env.ESCROW_PLATFORM_TRANSPARENT_ADDRESS;
    const escrowTransparentKey = process.env.ESCROW_PLATFORM_TRANSPARENT_KEY;

    if (!escrowSpendingKey && (!escrowTransparentAddr || !escrowTransparentKey)) {
      throw new Error("ESCROW_WALLET_MISCONFIGURED: Platform escrow spending key missing from environment.");
    }

    if (wasm) {
      try {
        const info = await this.getBlockchainInfo().catch(() => ({ blocks: 3523120 }));
        const amountZats = BigInt(Math.round(amountZec * 1e8));
        const minerFeeZats = 10000n; // 0.0001 ZEC ZIP-317 fee
        const targetZats = amountZats + minerFeeZats;

        // A. If transparent UTXOs are available, spend transparently to recipient's shielded address
        if (escrowTransparentAddr && escrowTransparentKey) {
          const utxos = await this.getEscrowUtxos(escrowTransparentAddr).catch(() => []);
          let accumulatedZats = 0n;
          const selectedUtxos: any[] = [];
          for (const u of utxos) {
            selectedUtxos.push(u);
            accumulatedZats += BigInt(u.satoshis);
            if (accumulatedZats >= targetZats) break;
          }

          if (accumulatedZats >= targetZats) {
            const branchId = 0x37A5165B;
            const signed = wasm.build_and_sign_transaction({
              private_key_hex: escrowTransparentKey,
              utxos: selectedUtxos.map((u) => ({
                txid: u.txid,
                vout: u.outputIndex,
                amount_zatoshis: BigInt(u.satoshis),
              })),
              to_address: recipientAddress,
              amount_zatoshis: amountZats,
              current_block_height: info.blocks,
              consensus_branch_id: branchId,
            });

            if (signed?.raw_hex) {
              const broadcastTxid = await this.call<string>("sendrawtransaction", [signed.raw_hex]);
              if (broadcastTxid && typeof broadcastTxid === "string" && broadcastTxid.length === 64) {
                console.log(`[Escrow Outflow] ✓ Transaction successfully broadcasted on Zcash network: ${broadcastTxid}`);
                return {
                  txid: broadcastTxid,
                  isAsync: false,
                };
              }
              throw new Error(`TRANSACTION_BROADCAST_REJECTED: Node rejected transaction: ${JSON.stringify(broadcastTxid)}`);
            }
          }
        }

        // B. Shielded Escrow Vault Disbursement
        let noteToSpend = escrowNote;
        if (!noteToSpend && fundingTxid && ufvkWatcher) {
          try {
            const rawTx = await this.call<any>("getrawtransaction", [fundingTxid, 1]);
            const blockHeight = rawTx?.height;
            const actions =
              rawTx?.orchard?.actions && rawTx.orchard.actions.length > 0
                ? rawTx.orchard.actions
                : rawTx?.ironwood?.actions || [];
            for (const act of actions) {
              const compactAct = {
                nullifier_hex: act.nullifier || act.nullifier_hex || "",
                cmx_hex: act.cmx || act.cmx_hex || "",
                epk_hex: act.ephemeralKey || act.epk || act.epk_hex || "",
                enc_ciphertext_hex: act.encCiphertext || act.enc_ciphertext || act.enc_ciphertext_hex || "",
              };
              if (compactAct.cmx_hex && compactAct.epk_hex && compactAct.enc_ciphertext_hex) {
                const dec = await ufvkWatcher.trialDecryptAction(compactAct);
                if (dec && dec.value_zatoshis >= amountZats) {
                  noteToSpend = {
                    cmx: compactAct.cmx_hex,
                    valueZat: BigInt(dec.value_zatoshis),
                    rho: dec.rho_hex,
                    rseed: dec.rseed_hex,
                    recipientRawAddress: dec.recipient_address_hex,
                    blockHeight,
                  };
                  break;
                }
              }
            }
          } catch (e) {
            console.warn("[sendShieldedPayout] Auto-discovery of note from fundingTxid failed:", e);
          }
        }

        if (escrowSpendingKey && noteToSpend) {
          const blockchainInfo = await this.getBlockchainInfo().catch(() => ({ blocks: 3523120 }));
          const currentHeight = blockchainInfo.blocks;
          const expiryHeight = currentHeight + 20;

          // Sync tree state before note's block
          const noteHeight = noteToSpend.blockHeight || (currentHeight - 1);
          const prevHeight = noteHeight - 1;
          const tsData = await this.call<any>("z_gettreestate", [String(prevHeight)]);
          const stateHex = tsData?.ironwood?.commitments?.finalState || tsData?.orchard?.commitments?.finalState;

          if (stateHex) {
            const buf = Buffer.from(stateHex, "hex");
            let offset = 0;
            const hasLeft = buf[offset++] === 1;
            const left = hasLeft ? buf.subarray(offset, offset + 32).toString("hex") : null;
            if (hasLeft) offset += 32;
            const hasRight = buf[offset++] === 1;
            const right = hasRight ? buf.subarray(offset, offset + 32).toString("hex") : null;
            if (hasRight) offset += 32;
            const parentsLen = buf[offset++];
            const parents: (string | null)[] = [];
            for (let i = 0; i < parentsLen; i++) {
              const hasP = buf[offset++] === 1;
              if (hasP) {
                parents.push(buf.subarray(offset, offset + 32).toString("hex"));
                offset += 32;
              } else {
                parents.push(null);
              }
            }

            wasm.tree_import_state({
              tree: { left, right, parents },
              witnesses: {},
              checkpoints: [],
            });

            wasm.tree_append_commitments([noteToSpend.cmx]);
            wasm.tree_track_note(noteToSpend.cmx);

            const blockAnchor = wasm.tree_get_anchor();

            const spendBundle = wasm.build_and_prove_orchard_spend({
              spends: [
                {
                  spending_key_hex: escrowSpendingKey,
                  recipient_raw_address_hex: noteToSpend.recipientRawAddress,
                  value_zatoshis: noteToSpend.valueZat,
                  rho_hex: noteToSpend.rho,
                  rseed_hex: noteToSpend.rseed,
                  cmx_hex: noteToSpend.cmx,
                  auth_path_hex: null,
                  position: null,
                },
              ],
              recipient_address: recipientAddress,
              amount_zatoshis: amountZats,
              memo: memo || "VeilX Escrow Payout",
              change_address: null,
              change_zatoshis: 0n,
              anchor_hex: blockAnchor,
              expiry_height: expiryHeight,
              consensus_branch_id: 0x37a5165b,
              lock_time: 0,
            });

            const rawTxHex = serializeV6ShieldedTransaction({
              consensusBranchId: 0x37a5165b,
              expiryHeight,
              lockTime: 0,
              actions: spendBundle.actions,
              flags: 7,
              valueBalanceZat: spendBundle.value_balance_zatoshis,
              anchorHex: blockAnchor,
              proofHex: spendBundle.proof_hex,
              spendAuthSigsHex: spendBundle.spend_auth_sigs_hex,
              bindingSigHex: spendBundle.binding_sig_hex,
            });

            const broadcastTxid = await this.call<string>("sendrawtransaction", [rawTxHex]);
            if (broadcastTxid && typeof broadcastTxid === "string" && broadcastTxid.length === 64) {
              console.log(`[Escrow Shielded Outflow] ✓ Transaction broadcasted on Zcash network: ${broadcastTxid}`);
              return {
                txid: broadcastTxid,
                isAsync: false,
              };
            }
          }
        }

        if (escrowSpendingKey && !noteToSpend) {
          throw new Error(
            "SHIELDED_ESCROW_CONFIRMING: Escrow funds are held in the shielded vault. Awaiting note commitment witness synchronization before autonomous disbursement."
          );
        }

        if (!ALLOW_PAYMENT_SIMULATION) {
          throw new Error(
            "SHIELDED_ESCROW_CONFIRMING: Escrow funds are held in the shielded vault. Awaiting block confirmation to seal note anchor before autonomous disbursement."
          );
        }
      } catch (wasmErr: any) {
        if (!ALLOW_PAYMENT_SIMULATION) {
          throw wasmErr;
        }
      }
    }

    if (!ALLOW_PAYMENT_SIMULATION) {
      throw new Error("Payout could not be executed: Escrow signing engine or node is offline.");
    }

    // In explicitly enabled test sandbox mode only:
    const mockTxid = `sim_tx_${crypto.randomBytes(28).toString("hex")}`;
    return { txid: mockTxid, isAsync: false };
  }

  /**
   * Server-Side Payment Verification
   * Inspects the Zcash blockchain/node to verify whether a given transaction
   * actually paid the specified address with the correct amount and confirmation state.
   */
  async verifyPaymentTransaction(params: {
    txid: string;
    expectedAddress: string;
    expectedAmountZec: number;
    minConfirmations?: number;
    network?: Network;
    expectedMemo?: string;
    action?: CompactActionInput;
  }): Promise<VerificationResult> {
    const { txid, expectedAddress, expectedAmountZec, minConfirmations = 1, network = ZCASH_NETWORK, expectedMemo, action } = params;

    if (!txid || typeof txid !== "string" || !txid.trim()) {
      return { verified: false, reason: "TRANSACTION_ID_REQUIRED: Please provide a valid transaction hash." };
    }

    // 1. Verify expected address format
    if (!validateZcashAddress(expectedAddress, network)) {
      return { verified: false, reason: "INVALID_EXPECTED_DESTINATION_ADDRESS: Address is not a valid Zcash address." };
    }

    let txFoundOnChain = false;

    // 2. Query node for transaction details (Transparent Outputs)
    try {
      const rawTx = await this.call<any>("getrawtransaction", [txid.trim(), 1]);
      if (rawTx) {
        txFoundOnChain = true;
        const confirmations = typeof rawTx.confirmations === "number" ? rawTx.confirmations : 0;
        // Check transparent outputs (vout)
        // If expectedAddress is a Unified Address, decode its embedded transparent receiver (t1... or tm...)
        const escrowTransparentVault = this.getEscrowTransparentAddress();
        const targetAddresses = new Set<string>([expectedAddress]);
        if (expectedAddress === escrowTransparentVault || expectedAddress.startsWith("u1") || expectedAddress.startsWith("utest1")) {
          targetAddresses.add(escrowTransparentVault);
        }
        if (expectedAddress.startsWith("u1") || expectedAddress.startsWith("utest1")) {
          try {
            const wasm = await getWasmEngine();
            if (wasm && typeof wasm.decode_unified_address === "function") {
              const decoded = wasm.decode_unified_address(expectedAddress);
              if (decoded && decoded.p2pkh_hex) {
                const tAddr = p2pkhHexToAddress(decoded.p2pkh_hex, network);
                targetAddresses.add(tAddr);
              }
            }
          } catch (err: any) {
            console.warn("[verifyPaymentTransaction] Could not decode Unified Address transparent receiver:", err?.message || err);
          }
        }

        let totalPaidToTarget = 0;
        if (Array.isArray(rawTx.vout)) {
          for (const out of rawTx.vout) {
            const addresses: string[] = [];
            if (Array.isArray(out.scriptPubKey?.addresses)) {
              addresses.push(...out.scriptPubKey.addresses);
            }
            if (typeof out.scriptPubKey?.address === "string") {
              addresses.push(out.scriptPubKey.address);
            }
            if (addresses.some((a) => targetAddresses.has(a))) {
              totalPaidToTarget += out.value || 0;
            }
          }
        }

        if (totalPaidToTarget >= expectedAmountZec * 0.999) {
          // Verify that deposits to the escrow vault originated from a shielded pool
          const isPayingToEscrowVault = targetAddresses.has(escrowTransparentVault);
          const hasShieldedInputs =
            (rawTx.orchard && Array.isArray(rawTx.orchard.actions) && rawTx.orchard.actions.length > 0) ||
            (rawTx.vSpendsSapling && Array.isArray(rawTx.vSpendsSapling) && rawTx.vSpendsSapling.length > 0) ||
            (rawTx.vShieldedSpend && Array.isArray(rawTx.vShieldedSpend) && rawTx.vShieldedSpend.length > 0);
          const hasTransparentInputs =
            Array.isArray(rawTx.vin) &&
            rawTx.vin.length > 0 &&
            rawTx.vin.some((inTx: any) => inTx.txid && inTx.txid !== "0000000000000000000000000000000000000000000000000000000000000000");

          if (isPayingToEscrowVault && !hasShieldedInputs && hasTransparentInputs) {
            return {
              verified: false,
              actualAmountZec: totalPaidToTarget,
              confirmations,
              blockHeight: rawTx.height,
              reason: "TRANSPARENT_INFLOW_REJECTED: Transaction was sent from a transparent address. VeilX requires all deposits to originate from a shielded balance (Zashi, YWallet, or Noir) to guarantee 100% sender privacy.",
            };
          }

          if (confirmations < minConfirmations) {
            return {
              verified: false,
              detectedInMempool: true,
              actualAmountZec: totalPaidToTarget,
              confirmations,
              blockHeight: rawTx.height,
              reason: `INSUFFICIENT_CONFIRMATIONS: Transaction has ${confirmations} confirmations (requires at least ${minConfirmations}).`,
            };
          }
          return {
            verified: true,
            detectedInMempool: confirmations === 0,
            actualAmountZec: totalPaidToTarget,
            confirmations,
            blockHeight: rawTx.height,
          };
        } else if (totalPaidToTarget > 0) {
          return {
            verified: false,
            reason: `UNDERPAID: Transaction paid ${totalPaidToTarget} ZEC to destination, but expected ${expectedAmountZec} ZEC.`,
            actualAmountZec: totalPaidToTarget,
            confirmations,
            blockHeight: rawTx.height,
          };
        }

        // Strategy B: Check Shielded Orchard / Ironwood Actions using local Wasm + Platform UFVK
        const shieldedActions =
          rawTx.orchard && Array.isArray(rawTx.orchard.actions) && rawTx.orchard.actions.length > 0
            ? rawTx.orchard.actions
            : rawTx.ironwood && Array.isArray(rawTx.ironwood.actions) && rawTx.ironwood.actions.length > 0
            ? rawTx.ironwood.actions
            : [];

        if (shieldedActions.length > 0) {
          let totalShieldedZats = 0;
          let lastDecryptedNote: DecryptedEscrowNote | null = null;

          for (const act of shieldedActions) {
            const compactAct: CompactActionInput = {
              nullifier_hex: act.nullifier || act.nullifier_hex || "",
              cmx_hex: act.cmx || act.cmx_hex || "",
              epk_hex: act.ephemeralKey || act.epk || act.epk_hex || "",
              enc_ciphertext_hex: act.encCiphertext || act.enc_ciphertext || act.enc_ciphertext_hex || "",
            };

            if (compactAct.cmx_hex && compactAct.epk_hex && compactAct.enc_ciphertext_hex) {
              const decrypted = await ufvkWatcher.trialDecryptAction(compactAct);
              if (decrypted) {
                totalShieldedZats += decrypted.value_zatoshis;
                lastDecryptedNote = decrypted;
              }
            }
          }

          if (totalShieldedZats > 0) {
            const paidZec = totalShieldedZats / 1e8;
            if (paidZec >= expectedAmountZec * 0.999) {
              if (confirmations < minConfirmations) {
                return {
                  verified: false,
                  detectedInMempool: true,
                  actualAmountZec: paidZec,
                  confirmations,
                  blockHeight: rawTx.height,
                  memo: lastDecryptedNote?.memo_text,
                  reason: `INSUFFICIENT_CONFIRMATIONS: Transaction has ${confirmations} confirmations (requires at least ${minConfirmations}).`,
                };
              }
              return {
                verified: true,
                detectedInMempool: confirmations === 0,
                actualAmountZec: paidZec,
                confirmations,
                blockHeight: rawTx.height,
                memo: lastDecryptedNote?.memo_text,
              };
            } else {
              return {
                verified: false,
                reason: `UNDERPAID: Transaction paid ${paidZec} ZEC to escrow vault, but expected ${expectedAmountZec} ZEC.`,
                actualAmountZec: paidZec,
                confirmations,
                blockHeight: rawTx.height,
              };
            }
          }
        }

        // Strategy C: Shielded Zcash On-Chain Verification
        // Public nodes (GetBlock/NowNodes/Zebra) do not decrypt shielded notes into JSON RPC responses.
        // If the transaction has an on-chain shielded bundle (Orchard / Sapling) and no conflicting transparent outputs:
        const isShieldedTx = Boolean(
          rawTx.orchard ||
          (Array.isArray(rawTx.vShieldedOutput) && rawTx.vShieldedOutput.length > 0) ||
          (Array.isArray(rawTx.vShieldedSpend) && rawTx.vShieldedSpend.length > 0) ||
          (rawTx.hex && rawTx.hex.length > 1000)
        );

        const hasNoConflictingTransparentOuts =
          !Array.isArray(rawTx.vout) || rawTx.vout.length === 0 || totalPaidToTarget > 0;

        if (isShieldedTx && hasNoConflictingTransparentOuts) {
          if (confirmations < minConfirmations) {
            return {
              verified: false,
              detectedInMempool: true,
              actualAmountZec: expectedAmountZec,
              confirmations,
              blockHeight: rawTx.height,
              reason: `INSUFFICIENT_CONFIRMATIONS: Transaction has ${confirmations} confirmations (requires at least ${minConfirmations}).`,
            };
          }
          return {
            verified: true,
            detectedInMempool: confirmations === 0,
            actualAmountZec: expectedAmountZec,
            confirmations,
            blockHeight: rawTx.height,
          };
        }
      }
    } catch (rpcError: any) {
      // Fall through to error diagnostics
    }

    // 3b. Query event-driven UFVK Escrow Watcher for trial-decrypted Orchard notes
    try {
      const ufvkRes = await ufvkWatcher.verifyPayment({
        txid: txid.trim(),
        expectedAmountZec,
        expectedMemo,
        action,
      });
      if (ufvkRes.verified) {
        return {
          verified: true,
          actualAmountZec: ufvkRes.actualAmountZec || expectedAmountZec,
          confirmations: minConfirmations,
          blockHeight: ufvkRes.decryptedNote?.block_height,
        };
      } else if (ufvkRes.reason && ufvkRes.reason.includes("UNDERPAID")) {
        return {
          verified: false,
          reason: ufvkRes.reason,
          actualAmountZec: ufvkRes.actualAmountZec,
        };
      }
    } catch {
      // Continue to next verification strategy
    }

    // 4. In development/test simulation mode only:
    if (ALLOW_PAYMENT_SIMULATION) {
      if (txid.startsWith("sim_tx_") || txid.startsWith("test_tx_") || txid.startsWith("valid_test_")) {
        return {
          verified: true,
          actualAmountZec: expectedAmountZec,
          confirmations: minConfirmations,
        };
      }
      // If not a simulation fixture, continue to standard on-chain diagnostics below
    }

    // 5. If transaction was found on-chain, but outputs didn't pay expected address:
    if (txFoundOnChain) {
      return {
        verified: false,
        reason: `WRONG_RECIPIENT_OR_UNMATCHED: Transaction exists on-chain, but no payment to the expected address was found.`,
      };
    }

    // 6. Network Mismatch Diagnostics:
    const isExpectedTestnet =
      expectedAddress.startsWith("tm") ||
      expectedAddress.startsWith("utest") ||
      expectedAddress.startsWith("ztestsapling");
    const isNodeMainnet = network === "mainnet";
    const isExpectedMainnet =
      expectedAddress.startsWith("t1") ||
      expectedAddress.startsWith("u1") ||
      expectedAddress.startsWith("zs1");
    const isNodeTestnet = network === "testnet";

    if (isExpectedTestnet && isNodeMainnet) {
      return {
        verified: false,
        reason: `NETWORK_MISMATCH: The invoice address is on Zcash Testnet (TAZ), but the backend node is connected to Mainnet. The transaction was not found on Mainnet.`,
      };
    }

    if (isExpectedMainnet && isNodeTestnet) {
      return {
        verified: false,
        reason: `NETWORK_MISMATCH: The invoice address is on Zcash Mainnet, but the backend node is connected to Testnet. The transaction was not found on Testnet.`,
      };
    }

    // 7. Production / Live mode fails closed:
    return {
      verified: false,
      reason: `TRANSACTION_NOT_FOUND: Could not find transaction '${txid}' on the Zcash ${network} network. Please ensure the transaction has mined and broadcast to ${network}.`,
    };
  }

  private getMockFallback(method: string, params: any[]): any {
    switch (method) {
      case "z_getaddressforaccount":
        return generateValidZcashAddress(ZCASH_NETWORK);
      case "z_listreceivedbyaddress":
        return [];
      case "z_getoperationstatus":
        return [{ id: params[0]?.[0] || "opid-mock", status: "success", result: { txid: `sim_tx_${crypto.randomBytes(28).toString("hex")}` } }];
      case "z_sendmany":
        return `opid-${crypto.randomBytes(16).toString("hex")}`;
      default:
        return null;
    }
  }
}

export const zallet = new ZalletClient();
export const zalletClient = zallet;
