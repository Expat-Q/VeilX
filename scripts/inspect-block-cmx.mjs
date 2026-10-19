import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const rpcUrl = process.env.ZALLET_RPC_URL;

async function callRpc(method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

async function main() {
  const hash = await callRpc("getblockhash", [3523116]);
  const block = await callRpc("getblock", [hash, 1]);
  console.log("Block 3523116 has", block.tx.length, "txs");
  const commitments = [];
  for (const txid of block.tx) {
    const tx = await callRpc("getrawtransaction", [txid, 1]);
    const bundle = tx.ironwood || tx.orchard;
    if (bundle?.actions) {
      console.log(`Tx ${txid} has ${bundle.actions.length} actions:`);
      for (const act of bundle.actions) {
        console.log(`  cmx: ${act.cmx}`);
        commitments.push(act.cmx);
      }
    }
  }
  console.log("Total commitments in block 3523116:", commitments.length);

  // Check treestate at 3523116
  const ts = await callRpc("z_gettreestate", [3523116]);
  console.log("Treestate at 3523116 root:", ts.ironwood?.commitments?.finalRoot || ts.orchard?.commitments?.finalRoot);
}

main().catch(console.error);
