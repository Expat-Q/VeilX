import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { ufvkWatcher } = await import("../src/lib/escrow/ufvk-watcher.ts");

async function main() {
  console.log("=== Testing UFVK Watcher setup ===");
  const ufvk = process.env.ESCROW_PLATFORM_UFVK;
  console.log("UFVK from env:", ufvk?.slice(0, 30) + "...");
  const ok = await ufvkWatcher.setPlatformUFVK(ufvk);
  console.log("setPlatformUFVK returned:", ok);
  console.log("Orchard FVK hex:", ufvkWatcher.getOrchardFvkHex()?.slice(0, 30) + "...");
}

main().catch(console.error);
