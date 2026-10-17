import { createWalletVault } from "../src/core/keyring.ts";
import { buildAndSignNU7Transaction } from "../src/transparent/tx-v5-builder.ts";
import { NU7_BRANCH_ID } from "../src/core/constants.ts";

async function main() {
  const vault = createWalletVault({
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    network: "testnet",
    accountCount: 1,
  });
  const account = vault.accounts[0];
  console.log("Account address:", account.address);

  // Fetch UTXOs from zexplorer
  const res = await fetch(`https://zexplorer.app/api/v1/testnet/transparent-addresses/${encodeURIComponent(account.address)}`);
  const json = await res.json();
  const utxos = json.data?.utxos || [];
  console.log("Found UTXOs:", utxos.length);
  if (utxos.length === 0) {
    console.error("No UTXOs available!");
    return;
  }

  const currentHeight = json.freshness?.chain_tip_height || 4476770;
  console.log("Current block height:", currentHeight);

  // Send 20,000 zatoshis (0.0002 TAZ) back to self
  const toAddress = account.address;
  const sendAmountZats = 20000n;

  const signed = buildAndSignNU7Transaction({
    account,
    utxos,
    toAddress,
    amountZatoshis: sendAmountZats,
    currentBlockHeight: currentHeight,
    consensusBranchId: 0x37a5165b,
  });

  console.log("TxID:", signed.txid);
  console.log("Fee:", signed.feeZatoshis.toString(), "zats");
  console.log("Raw hex (first 64 chars):", signed.rawHex.slice(0, 64));

  // Broadcast to zexplorer.app
  console.log("\nBroadcasting to https://zexplorer.app/api/v1/testnet/broadcast...");
  const bRes = await fetch("https://zexplorer.app/api/v1/testnet/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      network: "testnet",
      raw_transaction_hex: signed.rawHex,
    }),
  });
  const bText = await bRes.text();
  console.log("Broadcast response:", bText);
}

main().catch(console.error);
