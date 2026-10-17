import {
  NU7_BLOCK_SPACING_SECONDS,
  NU7_BRANCH_ID,
  NU7_BRANCH_ID_HEX,
  NU7_TESTNET_ACTIVATION_HEIGHT,
  ZATOSHIS_PER_ZEC,
} from "../core/constants.ts";
import { createWalletVault, signMessageWithAccount } from "../core/keyring.ts";
import { buildAndSignNU7Transaction } from "../transparent/tx-v5-builder.ts";
import { ZebraRpcClient } from "../transparent/zebra-rpc.ts";
import type { DerivedAccount, ShieldedEngine, WalletVault, ZcashNetwork } from "../types.ts";

export interface ProviderConfig {
  mnemonic?: string;
  network?: ZcashNetwork;
  zebraRpcUrl?: string;
  shieldedEngine?: ShieldedEngine;
}

/**
 * VeilX NU7 Wallet Provider (`window.veilx` / `window.zcash`)
 * Implements the standard Zcash Browser Extension API (compatible with Noir & EIP-1193)
 * with native NU7 Consensus Branch ID (`0x77190AD9`) transaction signing.
 */
export class VeilXNU7Provider {
  public readonly isZcash = true;
  public readonly isVeilX = true;
  public readonly version = "1.0.0-nu7";
  public readonly consensusBranchId = `0x${NU7_BRANCH_ID_HEX}`;

  private vault: WalletVault;
  private rpc: ZebraRpcClient;
  private shieldedEngine?: ShieldedEngine;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor(config?: ProviderConfig) {
    this.vault = createWalletVault({
      mnemonic: config?.mnemonic,
      network: config?.network || "testnet",
      accountCount: 1,
    });
    this.rpc = new ZebraRpcClient({ rpcUrl: config?.zebraRpcUrl });
    this.shieldedEngine = config?.shieldedEngine;
  }

  get primaryAccount(): DerivedAccount {
    return this.vault.accounts[0];
  }

  getVault(): WalletVault {
    return this.vault;
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  removeListener(event: string, handler: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }

  /**
   * Connect wallet and return primary address + public key
   */
  async connect(): Promise<{ address: string; publicKey: string; network: ZcashNetwork; consensusBranchId: string }> {
    const acc = this.primaryAccount;
    let address = acc.address;
    if (this.shieldedEngine) {
      try {
        address = await this.shieldedEngine.getUnifiedAddress(0);
      } catch {
        // Fallback to transparent tm... address if shielded daemon is offline
      }
    }
    this.emit("accountsChanged", [address]);
    return {
      address,
      publicKey: acc.publicKeyHex,
      network: this.vault.network,
      consensusBranchId: this.consensusBranchId,
    };
  }

  async getAddresses(): Promise<{ transparent: string; shielded?: string; unified?: string }> {
    const acc = this.primaryAccount;
    let unified: string | undefined;
    if (this.shieldedEngine) {
      try {
        unified = await this.shieldedEngine.getUnifiedAddress(0);
      } catch {
        unified = undefined;
      }
    }
    return {
      transparent: acc.address,
      shielded: unified,
      unified,
    };
  }

  async getBalance(): Promise<{
    total: number;
    transparent: number;
    shielded: number;
    confirmed: number;
  }> {
    const acc = this.primaryAccount;
    let transparentZat = 0n;
    let shieldedZat = 0n;

    try {
      const bal = await this.rpc.getAddressBalance([acc.address]);
      transparentZat = bal.balanceZatoshis;
    } catch {
      transparentZat = 0n;
    }

    if (this.shieldedEngine) {
      try {
        const sBal = await this.shieldedEngine.getBalance(0);
        shieldedZat = sBal.orchardZatoshis + sBal.saplingZatoshis;
      } catch {
        shieldedZat = 0n;
      }
    }

    const transparent = Number(transparentZat) / Number(ZATOSHIS_PER_ZEC);
    const shielded = Number(shieldedZat) / Number(ZATOSHIS_PER_ZEC);
    const total = transparent + shielded;

    return {
      total,
      transparent,
      shielded,
      confirmed: total,
    };
  }

  /**
   * Build, sign (with NU7 branch ID 0x77190AD9), and broadcast a transaction
   */
  async sendTransaction(params: {
    to: string;
    amount: number | string;
    memo?: string;
  }): Promise<{ txid: string; rawHex?: string; consensusBranchId: string }> {
    const amountZec = typeof params.amount === "string" ? parseFloat(params.amount) : params.amount;
    if (isNaN(amountZec) || amountZec <= 0) {
      throw new Error(`Invalid transaction amount: ${params.amount}`);
    }

    const isShieldedDest =
      params.to.startsWith("u1") ||
      params.to.startsWith("utest1") ||
      params.to.startsWith("zs1") ||
      params.to.startsWith("ztestsapling1");

    if (isShieldedDest && this.shieldedEngine) {
      const res = await this.shieldedEngine.sendShielded({
        fromAccount: 0,
        toAddress: params.to,
        amountZec,
        memo: params.memo,
      });
      return {
        txid: res.txid,
        consensusBranchId: res.consensusBranchId,
      };
    }

    // Transparent v5 transaction signed with NU7 Consensus Branch ID (0x77190AD9)
    const acc = this.primaryAccount;
    const [utxos, chainInfo] = await Promise.all([
      this.rpc.getAddressUtxos([acc.address]),
      this.rpc.getBlockchainInfo().catch(() => ({ blocks: NU7_TESTNET_ACTIVATION_HEIGHT })),
    ]);

    const amountZatoshis = BigInt(Math.round(amountZec * Number(ZATOSHIS_PER_ZEC)));
    const signedTx = buildAndSignNU7Transaction({
      account: acc,
      utxos,
      toAddress: params.to,
      amountZatoshis,
      currentBlockHeight: chainInfo.blocks,
      consensusBranchId: NU7_BRANCH_ID,
    });

    const broadcastedTxid = await this.rpc.sendRawTransaction(signedTx.rawHex);
    return {
      txid: broadcastedTxid || signedTx.txid,
      rawHex: signedTx.rawHex,
      consensusBranchId: `0x${signedTx.consensusBranchIdHex}`,
    };
  }

  /**
   * EIP-1193 style RPC request dispatcher (`window.veilx.request` / `window.zcash.request`)
   */
  async request(payload: { method: string; params?: any }): Promise<any> {
    const { method, params } = payload;

    switch (method) {
      case "zcash_requestAccounts":
      case "zcash_accounts": {
        const res = await this.connect();
        return [res.address];
      }

      case "zcash_getBalance": {
        return this.getBalance();
      }

      case "zcash_sendTransaction": {
        const txParam = Array.isArray(params) ? params[0] : params;
        const result = await this.sendTransaction({
          to: txParam.to || txParam.address,
          amount: txParam.amount || txParam.value,
          memo: txParam.memo,
        });
        return result.txid;
      }

      case "zcash_signMessage": {
        const message = Array.isArray(params) ? params[0] : params?.message;
        if (!message) throw new Error("Missing message to sign");
        return signMessageWithAccount(this.primaryAccount, String(message));
      }

      case "zcash_getConsensusInfo": {
        return {
          upgrade: "NU7",
          consensusBranchId: `0x${NU7_BRANCH_ID_HEX}`,
          activationHeight: NU7_TESTNET_ACTIVATION_HEIGHT,
          blockSpacingSeconds: NU7_BLOCK_SPACING_SECONDS,
          txVersion: 5,
        };
      }

      default:
        throw new Error(`Unsupported VeilX NU7 Wallet method: ${method}`);
    }
  }
}
