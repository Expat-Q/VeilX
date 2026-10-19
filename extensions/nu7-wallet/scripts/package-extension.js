const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const extDir = path.resolve(rootDir, "chrome-extension");
const distDir = path.resolve(rootDir, "dist");
const buildDir = path.resolve(distDir, "veilx-extension");
const zipFile = path.resolve(distDir, "veilx-extension-v1.1.0.zip");

console.log("==================================================");
console.log("  VeilX Shielded Wallet Extension Packager v1.1.0  ");
console.log("==================================================\n");

// 1. Rebuild wallet-core.bundle.js
console.log("1. Bundling cryptographic core (wallet-core.bundle.js)...");
execSync(`node "${path.resolve(__dirname, "bundle-extension.js")}"`, { stdio: "inherit" });

// 2. Prepare clean dist directory
console.log("\n2. Preparing clean build directory at dist/veilx-extension/...");
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir, { recursive: true });

// 3. Required files check and copy
const requiredEntries = [
  "manifest.json",
  "popup.html",
  "popup.js",
  "approval.html",
  "approval.js",
  "background.js",
  "content.js",
  "inpage.js",
  "wallet-core.bundle.js",
  "offscreen.html",
  "offscreen.js",
  "qrcodegen.js",
  "veilx_wallet.js",
  "veilx_wallet_bg.wasm",
  "webzjs_wallet.js",
  "webzjs_wallet_bg.wasm",
  "wasm_thread_worker.js",
  "atomics_worker.js",
  "snippets",
  "VeilX_logo.png",
  "icon-16.png",
  "icon-32.png",
  "icon-48.png",
  "icon-128.png",
];

console.log("\n3. Validating and copying extension assets...");
for (const entry of requiredEntries) {
  const src = path.resolve(extDir, entry);
  const dst = path.resolve(buildDir, entry);

  if (!fs.existsSync(src)) {
    throw new Error(`CRITICAL: Required extension asset missing: ${src}`);
  }

  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dst, { recursive: true });
    console.log(`  ✓ Directory: ${entry}`);
  } else {
    fs.copyFileSync(src, dst);
    const sizeKb = (stat.size / 1024).toFixed(1);
    console.log(`  ✓ File: ${entry.padEnd(26)} (${sizeKb} KB)`);
  }
}

// 4. Validate manifest.json
console.log("\n4. Validating Manifest V3 compliance...");
const manifest = JSON.parse(fs.readFileSync(path.resolve(buildDir, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) {
  throw new Error("Manifest version must be 3!");
}
if (!manifest.permissions.includes("offscreen") || !manifest.permissions.includes("storage")) {
  throw new Error("Missing required permissions ('offscreen' and 'storage') in manifest.json!");
}
if (!manifest.content_security_policy || !manifest.content_security_policy.extension_pages.includes("wasm-unsafe-eval")) {
  throw new Error("Missing 'wasm-unsafe-eval' in manifest.json content_security_policy!");
}
console.log(`  ✓ Manifest validated: ${manifest.name} v${manifest.version} (Wasm CSP allowed)`);

// 5. Generate production zip archive
console.log("\n5. Packaging production zip archive...");
try {
  // Use bsdtar or tar built into Windows / Unix
  execSync(`tar -a -c -f "${zipFile}" -C "${buildDir}" .`, { stdio: "inherit" });
} catch (e) {
  // Fallback to powershell Compress-Archive on Windows
  console.log("  Falling back to PowerShell Compress-Archive...");
  execSync(`powershell -Command "Compress-Archive -Path '${buildDir}\\*' -DestinationPath '${zipFile}' -Force"`, {
    stdio: "inherit",
  });
}

if (!fs.existsSync(zipFile)) {
  throw new Error("Failed to create zip package!");
}

const zipStat = fs.statSync(zipFile);
const zipSizeMb = (zipStat.size / (1024 * 1024)).toFixed(2);

console.log("\n==================================================");
console.log(`✓ Production Extension Packaged Successfully!`);
console.log(`  Directory: ${buildDir}`);
console.log(`  Zip File:  ${zipFile} (${zipSizeMb} MB)`);
console.log("==================================================\n");
