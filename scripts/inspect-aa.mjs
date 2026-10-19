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
  const tx = await callRpc("getrawtransaction", ["aa206397c34cf593fcf98ff8c139fe6563505ae9351706def54c00a6c77ef9c8", 1]);
  console.log("Ironwood flags:", tx.ironwood.flags);
  console.log("Ironwood valueBalance:", tx.ironwood.valueBalance);
  console.log("Ironwood valueBalanceZat:", tx.ironwood.valueBalanceZat);
  console.log("Ironwood anchor:", tx.ironwood.anchor);
  console.log("Ironwood actions count:", tx.ironwood.actions.length);
  console.log("Action 0 nullifier:", tx.ironwood.actions[0].nullifier);
  console.log("Action 0 cmx:", tx.ironwood.actions[0].cmx);
  console.log("Action 1 nullifier:", tx.ironwood.actions[1].nullifier);
  console.log("Action 1 cmx:", tx.ironwood.actions[1].cmx);
}

main().catch(console.error);
