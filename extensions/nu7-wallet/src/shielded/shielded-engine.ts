import { execFile } from "child_process";
import { promisify } from "util";
import { NU7_BRANCH_ID_HEX, ZATOSHIS_PER_ZEC } from "../core/constants.ts";
import { ZebraRpcClient } from "../transparent/zebra-rpc.ts";
import type { ShieldedBalance, ShieldedEngine, ShieldedSendParams, ShieldedSendResult } from "../types.ts";

const execFileAsync = promisify(execFile);

/**
 * Option 1: Zallet Companion Daemon Shielded Engine
 * Talks to `zallet` (official Zcash Foundation / ECC Rust wallet daemon attached to Zebra v7 state)
 * Compiled with `RUSTFLAGS='--cfg zcash_unstable="nu7"'`
 */
export class ZalletShieldedEngine implements ShieldedEngine {
  readonly engineName = "zallet-rpc" as const;
  private rpc: ZebraRpcClient;

  constructor(zalletRpcUrl: string = process.env.ZALLET_RPC_URL || "http://127.0.0.1:18232") {
    this.rpc = new ZebraRpcClient({ rpcUrl: zalletRpcUrl });
  }

  async init(): Promise<void> {
    await this.rpc.getBlockchainInfo();
  }

  async sync(): Promise<{ syncedHeight: number; consensusBranchId: string }> {
    const info = await this.rpc.getBlockchainInfo();
    return {
      syncedHeight: info.blocks,
      consensusBranchId: info.consensus?.chaintip || `0x${NU7_BRANCH_ID_HEX}`,
    };
  }

  async getUnifiedAddress(accountIndex: number = 0): Promise<string> {
    const res = await this.rpc.call<{ address: string }>("z_getaddressforaccount", [accountIndex]);
    return res.address;
  }

  async getBalance(accountIndex: number = 0): Promise<ShieldedBalance> {
    const res = await this.rpc.call<{
      pools?: {
        orchard?: { valueZat: number };
        sapling?: { valueZat: number };
        transparent?: { valueZat: number };
      };
    }>("z_getbalanceforaccount", [accountIndex, 1]);

    const orchardZat = BigInt(res?.pools?.orchard?.valueZat ?? 0);
    const saplingZat = BigInt(res?.pools?.sapling?.valueZat ?? 0);
    const transparentZat = BigInt(res?.pools?.transparent?.valueZat ?? 0);
    const totalZat = orchardZat + saplingZat + transparentZat;

    return {
      orchardZatoshis: orchardZat,
      saplingZatoshis: saplingZat,
      transparentZatoshis: transparentZat,
      totalZec: Number(totalZat) / Number(ZATOSHIS_PER_ZEC),
    };
  }

  async sendShielded(params: ShieldedSendParams): Promise<ShieldedSendResult> {
    const recipient: Record<string, any> = {
      address: params.toAddress,
      amount: Number(params.amountZec.toFixed(8)),
    };
    if (params.memo) {
      recipient.memo = Buffer.from(params.memo, "utf8").toString("hex");
    }

    const opid = await this.rpc.call<string>("z_sendmany", [
      String(params.fromAccount ?? 0),
      [recipient],
      1,
      0.0001,
      "AllowRevealedSenders",
    ]);

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      const statuses = await this.rpc.call<Array<{ id: string; status: string; result?: { txid: string }; error?: { message: string } }>>(
        "z_getoperationstatus",
        [[opid]]
      );
      const op = statuses?.[0];
      if (!op) continue;
      if (op.status === "success" && op.result?.txid) {
        return {
          txid: op.result.txid,
          engine: "zallet-rpc",
          consensusBranchId: `0x${NU7_BRANCH_ID_HEX}`,
        };
      }
      if (op.status === "failed") {
        throw new Error(`Zallet shielded send failed: ${op.error?.message || "Unknown error"}`);
      }
    }

    throw new Error(`Zallet operation ${opid} timed out`);
  }
}

/**
 * Option 2: ChainSafe WebZjs Wasm Shielded Engine (Browser / Web Worker)
 * Uses `@chainsafe/webzjs-wallet` compiled from `librustzcash` + `orchard` Halo2 prover.
 */
export class WebZjsShieldedEngine implements ShieldedEngine {
  readonly engineName = "webzjs-wasm" as const;
  private grpcWebProxyUrl: string;
  private walletInstance: any = null;

  constructor(grpcWebProxyUrl: string = "http://127.0.0.1:8080") {
    this.grpcWebProxyUrl = grpcWebProxyUrl;
  }

  async init(seedHex?: string): Promise<void> {
    try {
      // Dynamic import so Node environments without Wasm bundler don't fail at load time
      const pkgName = "@chainsafe/webzjs-wallet";
      const webzjs: any = await import(/* webpackIgnore: true */ pkgName);
      if (typeof webzjs.default === "function") {
        await webzjs.default();
      }
      if (typeof webzjs.initThreadPool === "function") {
        const threads = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
        await webzjs.initThreadPool(threads);
      }
      this.walletInstance = new webzjs.WebWallet("test", this.grpcWebProxyUrl, 1);
      if (seedHex && typeof this.walletInstance.create_account === "function") {
        await this.walletInstance.create_account(seedHex, 0, 4_465_026);
      }
    } catch (err: any) {
      throw new Error(
        `WebZjs Wasm initialization requires @chainsafe/webzjs-wallet built with RUSTFLAGS='--cfg zcash_unstable="nu7"': ${err.message}`
      );
    }
  }

  async sync(): Promise<{ syncedHeight: number; consensusBranchId: string }> {
    if (!this.walletInstance) throw new Error("WebZjs wallet not initialized");
    await this.walletInstance.sync();
    return {
      syncedHeight: 4_465_026,
      consensusBranchId: `0x${NU7_BRANCH_ID_HEX}`,
    };
  }

  async getUnifiedAddress(accountIndex: number = 0): Promise<string> {
    if (!this.walletInstance) throw new Error("WebZjs wallet not initialized");
    return this.walletInstance.get_current_address(accountIndex);
  }

  async getBalance(accountIndex: number = 0): Promise<ShieldedBalance> {
    if (!this.walletInstance) throw new Error("WebZjs wallet not initialized");
    const bal = await this.walletInstance.get_balance(accountIndex);
    const orchardZat = BigInt(bal?.orchard_balance ?? 0);
    const saplingZat = BigInt(bal?.sapling_balance ?? 0);
    const transparentZat = BigInt(bal?.transparent_balance ?? 0);
    return {
      orchardZatoshis: orchardZat,
      saplingZatoshis: saplingZat,
      transparentZatoshis: transparentZat,
      totalZec: Number(orchardZat + saplingZat + transparentZat) / Number(ZATOSHIS_PER_ZEC),
    };
  }

  async sendShielded(params: ShieldedSendParams): Promise<ShieldedSendResult> {
    if (!this.walletInstance) throw new Error("WebZjs wallet not initialized");
    const amountZats = BigInt(Math.round(params.amountZec * Number(ZATOSHIS_PER_ZEC)));
    const txid = await this.walletInstance.send_to_address(
      params.fromAccount ?? 0,
      params.toAddress,
      amountZats,
      params.memo || ""
    );
    return {
      txid: String(txid),
      engine: "webzjs-wasm",
      consensusBranchId: `0x${NU7_BRANCH_ID_HEX}`,
    };
  }
}

/**
 * Option 3: Official Rust CLI Bridge (`zcash-devtool` / `zingo-cli`)
 * Compiled with `RUSTFLAGS='--cfg zcash_unstable="nu7"'` and connected directly
 * to Zebra v7.0.0-rc.0's built-in gRPC (`lightwalletd_listen_addr = 127.0.0.1:9067`).
 */
export class RustCliShieldedEngine implements ShieldedEngine {
  readonly engineName = "rust-cli-nu7" as const;
  private binaryPath: string;
  private walletDir: string;
  private serverUri: string;

  constructor(options?: { binaryPath?: string; walletDir?: string; serverUri?: string }) {
    this.binaryPath = options?.binaryPath || process.env.ZCASH_DEVTOOL_BIN || "zcash-devtool";
    this.walletDir = options?.walletDir || "./.nu7-shielded-wallet";
    this.serverUri = options?.serverUri || "http://127.0.0.1:9067";
  }

  async init(): Promise<void> {
    await execFileAsync(this.binaryPath, [
      "wallet",
      "-w",
      this.walletDir,
      "init",
      "--name",
      "veilx-nu7",
      "-n",
      "test",
      "-s",
      this.serverUri,
    ]);
  }

  async sync(): Promise<{ syncedHeight: number; consensusBranchId: string }> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      "wallet",
      "-w",
      this.walletDir,
      "sync",
      "-s",
      this.serverUri,
    ]);
    const heightMatch = stdout.match(/(\d{7,})/);
    return {
      syncedHeight: heightMatch ? parseInt(heightMatch[1], 10) : 4_465_026,
      consensusBranchId: `0x${NU7_BRANCH_ID_HEX}`,
    };
  }

  async getUnifiedAddress(): Promise<string> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      "wallet",
      "-w",
      this.walletDir,
      "list-addresses",
    ]);
    const uaMatch = stdout.match(/(utest1[a-z0-9]+)/i);
    if (!uaMatch) {
      throw new Error(`Could not parse Unified Address from zcash-devtool output: ${stdout}`);
    }
    return uaMatch[1];
  }

  async getBalance(): Promise<ShieldedBalance> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      "wallet",
      "-w",
      this.walletDir,
      "balance",
    ]);
    const zecMatch = stdout.match(/([0-9]+\.[0-9]{1,8})\s*TAZ/i);
    const totalZec = zecMatch ? parseFloat(zecMatch[1]) : 0;
    const zats = BigInt(Math.round(totalZec * Number(ZATOSHIS_PER_ZEC)));
    return {
      orchardZatoshis: zats,
      saplingZatoshis: 0n,
      transparentZatoshis: 0n,
      totalZec,
    };
  }

  async sendShielded(params: ShieldedSendParams): Promise<ShieldedSendResult> {
    const zats = BigInt(Math.round(params.amountZec * Number(ZATOSHIS_PER_ZEC)));
    const args = [
      "wallet",
      "-w",
      this.walletDir,
      "send",
      "--address",
      params.toAddress,
      "--value",
      zats.toString(),
      "-s",
      this.serverUri,
    ];
    if (params.memo) {
      args.push("--memo", params.memo);
    }
    const { stdout } = await execFileAsync(this.binaryPath, args);
    const txidMatch = stdout.match(/([0-9a-fA-F]{64})/);
    if (!txidMatch) {
      throw new Error(`Failed to extract txid from CLI output: ${stdout}`);
    }
    return {
      txid: txidMatch[1],
      engine: "rust-cli-nu7",
      consensusBranchId: `0x${NU7_BRANCH_ID_HEX}`,
    };
  }
}
