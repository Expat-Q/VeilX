import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { connectToDatabase } from "../src/lib/mongodb";
import { Tip } from "../src/models/Tip";
import { PaymentRequest } from "../src/models/PaymentRequest";
import { PaymentLink } from "../src/models/PaymentLink";

async function cleanDatabase() {
  console.log("Connecting to MongoDB Atlas...");
  await connectToDatabase();
  console.log("Connected successfully!");

  console.log("\n1. Inspecting current Tip documents...");
  const tips = await Tip.find({}).lean();
  console.log(`Found ${tips.length} total tips:`, tips.map(t => ({ id: t._id, to: t.recipientUsernameSnapshot, amount: t.amountZec, status: t.status })));

  console.log("\n2. Inspecting current PaymentRequest documents...");
  const requests = await PaymentRequest.find({}).lean();
  console.log(`Found ${requests.length} total requests:`, requests.map(r => ({ id: r._id, to: r.targetUsernameSnapshot, amount: r.amountZec, status: r.status })));

  console.log("\n3. Inspecting current PaymentLink documents...");
  const paylinks = await PaymentLink.find({}).lean();
  console.log(`Found ${paylinks.length} total paylinks:`, paylinks.map(p => ({ id: p._id, title: p.title, status: p.status })));

  // Delete all old test tips & requests
  console.log("\nPurging test/mock records from database collections...");
  const deletedTips = await Tip.deleteMany({});
  const deletedRequests = await PaymentRequest.deleteMany({});
  const deletedPaylinks = await PaymentLink.deleteMany({});

  console.log(`✅ Deleted ${deletedTips.deletedCount} tips.`);
  console.log(`✅ Deleted ${deletedRequests.deletedCount} payment requests.`);
  console.log(`✅ Deleted ${deletedPaylinks.deletedCount} payment links.`);
  console.log("\nDatabase is now clean and fresh for live use!");
  process.exit(0);
}

cleanDatabase().catch(err => {
  console.error("Cleanup error:", err);
  process.exit(1);
});
