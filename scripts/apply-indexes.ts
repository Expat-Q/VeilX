import { connectToDatabase, ensureDatabaseIndexes } from "../src/lib/mongodb";
import "../src/models/Tip";
import "../src/models/PaymentLink";
import "../src/models/PaymentRequest";

export async function applyIndexes() {
  console.log("[apply-indexes] Connecting to database...");
  const conn = await connectToDatabase();
  const db = conn.connection.db;
  if (!db) {
    throw new Error("Failed to get database instance from MongoDB connection");
  }

  console.log("[apply-indexes] Applying unique sparse indexes...");

  // 1. tips
  console.log("[apply-indexes] Applying indexes for tips...");
  await db.collection("tips").createIndex({ claimTxid: 1 }, { unique: true, sparse: true });
  await db.collection("tips").createIndex({ fundingTxid: 1 }, { unique: true, sparse: true });

  // 2. paymentlinks
  console.log("[apply-indexes] Applying indexes for paymentlinks...");
  await db.collection("paymentlinks").createIndex({ forwardTxid: 1 }, { unique: true, sparse: true });
  await db.collection("paymentlinks").createIndex({ paidTxid: 1 }, { sparse: true });

  // 3. paymentrequests
  console.log("[apply-indexes] Applying indexes for paymentrequests...");
  await db.collection("paymentrequests").createIndex({ forwardTxid: 1 }, { unique: true, sparse: true });
  await db.collection("paymentrequests").createIndex({ paidTxid: 1 }, { sparse: true });

  console.log("[apply-indexes] Syncing Mongoose schema indexes...");
  await ensureDatabaseIndexes();

  console.log("[apply-indexes] Indexes successfully applied and verified.");
  return true;
}

if (require.main === module || (typeof process !== "undefined" && process.argv[1]?.includes("apply-indexes"))) {
  applyIndexes()
    .then(() => {
      console.log("[apply-indexes] Script completed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[apply-indexes] Error applying indexes:", err);
      process.exit(1);
    });
}
