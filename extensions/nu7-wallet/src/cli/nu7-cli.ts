import {
  NU7_BLOCK_SPACING_SECONDS,
  NU7_BRANCH_ID,
  NU7_BRANCH_ID_HEX,
  NU7_TESTNET_ACTIVATION_HEIGHT,
} from "../core/constants.ts";
import { createWalletVault } from "../core/keyring.ts";
import { buildAndSignNU7Transaction } from "../transparent/tx-v5-builder.ts";
import { ZebraRpcClient } from "../transparent/zebra-rpc.ts";

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "demo";

  console.log("==================================================================");
  console.log(" 🛡️  VeilX NU7 Testnet Wallet CLI (Consensus Branch: 0x77190AD9)");
  console.log("==================================================================\n");

  if (cmd === "generate" || cmd === "demo") {
    const vault = createWalletVault({ network: "testnet", accountCount: 2 });
    const primary = vault.accounts[0];
    const recipient = vault.accounts[1];

    console.log("1. Generated HD Wallet Vault (BIP-39 / BIP-44 m/44'/1'/0'/0/x):");
    console.log(`   Network:             ${vault.network}`);
    console.log(`   Consensus Branch ID: 0x${NU7_BRANCH_ID_HEX} (ZIP 259 NU7)`);
    console.log(`   Activation Height:   ${NU7_TESTNET_ACTIVATION_HEIGHT} (25s block target)`);
    console.log(`   Mnemonic (24 words): ${vault.mnemonic}`);
    console.log(`   Account #0 Address:  ${primary.address}`);
    console.log(`   Account #0 WIF Key:  ${primary.wif}`);
    console.log(`   Account #0 PubKey:   ${primary.publicKeyHex}`);
    console.log(`   Account #0 Script:   ${primary.scriptPubKeyHex}\n`);

    if (cmd === "demo" || cmd === "build-tx") {
      const sampleUtxo = {
        txid: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
        vout: 0,
        scriptPubKeyHex: primary.scriptPubKeyHex,
        satoshis: 10_000_000n, // 0.1 TAZ (standard JinoLabs faucet payout)
        height: NU7_TESTNET_ACTIVATION_HEIGHT + 10,
      };

      const signed = buildAndSignNU7Transaction({
        account: primary,
        utxos: [sampleUtxo],
        toAddress: recipient.address,
        amountZatoshis: 5_000_000n, // 0.05 TAZ
        currentBlockHeight: NU7_TESTNET_ACTIVATION_HEIGHT + 15,
        consensusBranchId: NU7_BRANCH_ID,
      });

      console.log("2. Built & Signed ZIP 225 Version 5 Transaction (ZIP 244 Sighash):");
      console.log(`   Recipient:           ${recipient.address}`);
      console.log(`   Amount Sent:         0.05000000 TAZ (5,000,000 zatoshis)`);
      console.log(`   ZIP-317 / NSM Fee:   ${signed.feeZatoshis} zatoshis (0.00010000 TAZ)`);
      console.log(`   Consensus Branch ID: 0x${signed.consensusBranchIdHex}`);
      console.log(`   Expiry Height:       ${signed.expiryHeight} (+${NU7_BLOCK_SPACING_SECONDS}s/block)`);
      console.log(`   ZIP-244 Input Hash:  ${signed.inputDigests[0]}`);
      console.log(`   Non-Malleable TxID:  ${signed.txid}`);
      console.log(`   Signed V5 Raw Hex (${signed.rawHex.length / 2} bytes):`);
      console.log(`   ${signed.rawHex}\n`);
    }
    return;
  }

  if (cmd === "zebra-config") {
    console.log(ZebraRpcClient.generateZebradTestnetConfig());
    return;
  }

  if (cmd === "status") {
    const rpcUrl = args[1] || process.env.ZEBRA_TESTNET_RPC_URL || "http://127.0.0.1:18232";
    const client = new ZebraRpcClient({ rpcUrl });
    try {
      const info = await client.getBlockchainInfo();
      console.log(`Connected to Zebra node at ${rpcUrl}:`);
      console.log(`  Chain:        ${info.chain}`);
      console.log(`  Block Height: ${info.blocks}`);
      console.log(`  Chaintip ID:  ${info.consensus?.chaintip}`);
      console.log(`  NU7 Active:   ${info.isNu7Active ? "YES (0x77190AD9)" : "NO"}`);
    } catch (err: any) {
      console.error(`Could not reach Zebra node at ${rpcUrl}: ${err.message}`);
    }
    return;
  }

  console.log("Available commands:");
  console.log("  npx tsx extensions/nu7-wallet/src/cli/nu7-cli.ts generate");
  console.log("  npx tsx extensions/nu7-wallet/src/cli/nu7-cli.ts demo");
  console.log("  npx tsx extensions/nu7-wallet/src/cli/nu7-cli.ts zebra-config");
  console.log("  npx tsx extensions/nu7-wallet/src/cli/nu7-cli.ts status [rpcUrl]");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
