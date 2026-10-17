import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { zallet } = await import("../src/lib/zcash.ts");

async function main() {
  const blockHash = await zallet.call("getblockhash", [3520070]);
  console.log("Block Hash:", blockHash);
  const block = await zallet.call("getblock", [blockHash, 1]);
  console.log("Transactions count in block:", block.tx.length);
  const firstTxid = block.tx[0];
  console.log("First Tx ID:", firstTxid);
  const rawTx = await zallet.call("getrawtransaction", [firstTxid, 1]);
  console.log("Raw Tx fields:", Object.keys(rawTx));
  if (rawTx.orchard) {
    console.log("Orchard bundle keys:", Object.keys(rawTx.orchard));
    console.log("Orchard actions count:", rawTx.orchard.actions?.length);
    if (rawTx.orchard.actions && rawTx.orchard.actions.length > 0) {
      console.log("First action keys:", Object.keys(rawTx.orchard.actions[0]));
    }
  } else {
    console.log("No orchard bundle in coinbase, let's find a tx with orchard");
    for (let i = 1; i < Math.min(block.tx.length, 10); i++) {
      const tx = await zallet.call("getrawtransaction", [block.tx[i], 1]);
      if (tx.orchard) {
        console.log(`Tx ${block.tx[i]} has orchard!`);
        console.log("Orchard bundle keys:", Object.keys(tx.orchard));
        console.log("Orchard actions count:", tx.orchard.actions?.length);
        if (tx.orchard.actions && tx.orchard.actions.length > 0) {
          console.log("Action 0:", tx.orchard.actions[0]);
        }
        break;
      }
    }
  }
}

main().catch(console.error);
