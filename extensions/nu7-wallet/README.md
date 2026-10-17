# VeilX NU7 Wallet Extension (`@veilx/nu7-wallet`)

Standalone **Zcash NU7 Testnet Wallet Extension & SDK** engineered for **Zebra v7.0.0-rc.0+** (`ConsensusBranchId::Nu7 = 0x77190AD9`).

---

## Why This Extension Exists

At Testnet block height **`4,465,026`**, Zebra v7.0.0-rc.0 activated **Network Upgrade 7 (NU7)**:
- **ZIP 259 Consensus Branch ID:** `0x77190AD9` (little-endian `d9 0a 19 77`)
- **ZIP 218 Block Spacing:** `25 seconds` (reduced from 75s)
- **ZIP 225 / ZIP 244:** Mandatory Version 5 (`0x80000005`) transactions with personalized BLAKE2b-256 signature digests (`"ZcashTxHash_\xd9\x0a\x19\x77"`)
- **ZIP 235 / ZIP 237:** Network Sustainability Mechanism (60% fee reserve)

Legacy wallets sign transactions with pre-NU7 branch IDs (`0x4115BA96` / `0xC2D6D0B4`), which NU7 nodes immediately reject with `bad-tx-consensus-branch-id`. `@veilx/nu7-wallet` signs natively with **`0x77190AD9`**.

---

## 1. Load as a Chrome / Brave / Edge Browser Extension

1. Open your browser and navigate to `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select:
   ```text
   extensions/nu7-wallet/chrome-extension
   ```
4. The extension injects `window.veilx` and `window.zcash` (`isVeilX: true`, `consensusBranchId: "0x77190ad9"`), which VeilX automatically detects as **"VeilX NU7 Wallet"**.

---

## 2. Run the Standalone CLI

```bash
# Run full NU7 key generation + Version 5 (0x77190AD9) transaction signing demo
npx tsx extensions/nu7-wallet/src/cli/nu7-cli.ts demo

# Generate a new 24-word HD testnet wallet (m/44'/1'/0'/0/0 -> tm...)
npx tsx extensions/nu7-wallet/src/cli/nu7-cli.ts generate

# Print zebrad.toml config for Zebra v7.0.0-rc.0 with built-in gRPC enabled
npx tsx extensions/nu7-wallet/src/cli/nu7-cli.ts zebra-config

# Check Zebra v7.0.0-rc.0 node sync & NU7 activation status
npx tsx extensions/nu7-wallet/src/cli/nu7-cli.ts status http://127.0.0.1:18232
```

---

## 3. Shielded (Orchard `utest1...`) Engine Setup

The Orchard Halo 2 circuit is unchanged in NU7; only the transaction builder's consensus branch ID (`0x77190AD9`) changes. `src/shielded/shielded-engine.ts` provides three pluggable adapters:

1. **`ZalletShieldedEngine` (`zallet-rpc`)**: Connects to the official `zallet` daemon attached to Zebra's v29 state.
2. **`WebZjsShieldedEngine` (`webzjs-wasm`)**: Uses `@chainsafe/webzjs-wallet` for in-browser Orchard Halo 2 proving over gRPC-Web.
3. **`RustCliShieldedEngine` (`rust-cli-nu7`)**: Wraps `zcash-devtool` compiled with the NU7 unstable flag:
   ```bash
   RUSTFLAGS='--cfg zcash_unstable="nu7"' cargo build --release
   ```
