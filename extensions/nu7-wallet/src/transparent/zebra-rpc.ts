import { NU7_BRANCH_ID_HEX, NU7_TESTNET_ACTIVATION_HEIGHT } from "../core/constants.ts";
import type { TransparentUTXO, ZebraBlockchainInfo } from "../types.ts";

export interface ZebraRpcConfig {
  rpcUrl: string;
  apiKey?: string;
  rpcUser?: string;
  rpcPassword?: string;
  timeoutMs?: number;
}

/**
 * Zebra v7.0.0-rc.0 JSON-RPC Client
 * Supports NU7 consensus inspection, address indexing (getaddressutxos, getaddressbalance),
 * and transaction broadcast (sendrawtransaction).
 */
export class ZebraRpcClient {
  private url: string;
  private headers: Record<string, string>;
  private timeoutMs: number;

  constructor(config?: Partial<ZebraRpcConfig>) {
    this.url = config?.rpcUrl || process.env.ZEBRA_TESTNET_RPC_URL || "http://127.0.0.1:18232";
    this.timeoutMs = config?.timeoutMs || 10_000;
    this.headers = { "Content-Type": "application/json" };

    if (config?.apiKey) {
      this.headers["api-key"] = config.apiKey;
      this.headers["x-api-key"] = config.apiKey;
    } else if (config?.rpcUser && config?.rpcPassword) {
      const token = Buffer.from(`${config.rpcUser}:${config.rpcPassword}`).toString("base64");
      this.headers["Authorization"] = `Basic ${token}`;
    }
  }

  async call<T = any>(method: string, params: any[] = []): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `nu7-${Date.now()}`,
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Zebra RPC HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      if (json.error) {
        throw new Error(`Zebra RPC [${method}] error: ${json.error.message || JSON.stringify(json.error)}`);
      }
      return json.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch blockchain height and verify whether NU7 (0x77190AD9) is active at chaintip
   */
  async getBlockchainInfo(): Promise<ZebraBlockchainInfo & { isNu7Active: boolean }> {
    const info = await this.call<ZebraBlockchainInfo>("getblockchaininfo", []);
    const tipBranch = info.consensus?.chaintip?.toLowerCase().replace(/^0x/, "") || "";
    const isNu7Active =
      tipBranch === NU7_BRANCH_ID_HEX || info.blocks >= NU7_TESTNET_ACTIVATION_HEIGHT;
    return { ...info, isNu7Active };
  }

  /**
   * Fetch unspent outputs for one or more transparent addresses via Zebra's getaddressutxos
   */
  async getAddressUtxos(addresses: string[]): Promise<TransparentUTXO[]> {
    const raw = await this.call<
      Array<{
        address: string;
        txid: string;
        outputIndex: number;
        script: string;
        satoshis: number | string;
        height: number;
      }>
    >("getaddressutxos", [{ addresses }]);

    return (raw || []).map((u) => ({
      txid: u.txid,
      vout: u.outputIndex,
      scriptPubKeyHex: u.script,
      satoshis: BigInt(u.satoshis),
      height: u.height,
    }));
  }

  /**
   * Fetch balance in zatoshis for transparent addresses via Zebra's getaddressbalance
   */
  async getAddressBalance(addresses: string[]): Promise<{ balanceZatoshis: bigint; receivedZatoshis: bigint }> {
    const res = await this.call<{ balance: number | string; received: number | string }>(
      "getaddressbalance",
      [{ addresses }]
    );
    return {
      balanceZatoshis: BigInt(res?.balance ?? 0),
      receivedZatoshis: BigInt(res?.received ?? 0),
    };
  }

  /**
   * Broadcast a signed v5 raw transaction hex to the Zebra NU7 mempool
   */
  async sendRawTransaction(rawHex: string): Promise<string> {
    return this.call<string>("sendrawtransaction", [rawHex]);
  }

  /**
   * Generate a complete `zebrad.toml` configuration snippet for running Zebra v7.0.0-rc.0 on NU7 Testnet
   * with both JSON-RPC and built-in experimental lightwalletd gRPC enabled.
   */
  static generateZebradTestnetConfig(options?: {
    rpcPort?: number;
    grpcPort?: number;
    cacheDir?: string;
  }): string {
    const rpcPort = options?.rpcPort ?? 18232;
    const grpcPort = options?.grpcPort ?? 9067;
    const cacheDir = options?.cacheDir ?? "./zebra-testnet-state";

    return `# Zebra v7.0.0-rc.0+ NU7 Testnet Configuration
# Activated NU7 (ZIP 259, Branch ID 0x77190AD9, 25s blocks) at height 4,465,026

[network]
network = "Testnet"

[state]
cache_dir = "${cacheDir}"

[rpc]
listen_addr = "127.0.0.1:${rpcPort}"
enable_cookie_auth = false
# Built-in CompactTxStreamer gRPC endpoint for light clients & shielded engines
lightwalletd_listen_addr = "127.0.0.1:${grpcPort}"
`;
  }
}
