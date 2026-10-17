import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { zallet } = await import("../src/lib/zcash.ts");

async function main() {
  const info = await zallet.getBlockchainInfo();
  console.log("Current block height:", info.blocks);
  for (let h = info.blocks; h > info.blocks - 30; h--) {
    const hash = await zallet.call("getblockhash", [h]);
    const block = await zallet.call("getblock", [hash, 1]);
    for (const txid of block.tx) {
      const tx = await zallet.call("getrawtransaction", [txid, 1]);
      if (tx.orchard && tx.orchard.actions && tx.orchard.actions.length > 0) {
        console.log(`FOUND Orchard Tx: ${txid} in block ${h}`);
        console.log("Action keys:", Object.keys(tx.orchard.actions[0]));
        console.log("Action 0 sample:", tx.orchard.actions[0]);
        return;
      }
    }
  }
  console.log("No orchard tx found in last 30 blocks, will search further if needed");
}

main().catch(console.error);
