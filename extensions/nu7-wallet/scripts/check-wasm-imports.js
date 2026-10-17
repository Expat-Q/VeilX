const fs = require("fs");
const path = require("path");

const wasmPath = path.resolve(__dirname, "../../../node_modules/zprotocol-webzjs-wallet/webzjs_wallet_bg.wasm");
console.log("Reading WASM file:", wasmPath);
const buf = fs.readFileSync(wasmPath);
console.log("Compiling WebAssembly module (" + (buf.length / 1024 / 1024).toFixed(1) + " MB)...");

const mod = new WebAssembly.Module(buf);
const imports = WebAssembly.Module.imports(mod);
console.log("Total imports:", imports.length);

const modules = {};
for (const imp of imports) {
  if (!modules[imp.module]) modules[imp.module] = [];
  modules[imp.module].push(imp.name);
}

for (const [modName, names] of Object.entries(modules)) {
  console.log(`Module [${modName}]: ${names.length} imports ->`, names.slice(0, 5));
}
