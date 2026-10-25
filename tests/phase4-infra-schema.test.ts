(process.env as any).NODE_ENV = "test";
process.env.ESCROW_PLATFORM_TRANSPARENT_KEY =
  process.env.ESCROW_PLATFORM_TRANSPARENT_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
import assert from "assert";
import fs from "fs";
import path from "path";
import { Tip } from "../src/models/Tip";
import { PaymentLink } from "../src/models/PaymentLink";
import { PaymentRequest } from "../src/models/PaymentRequest";
import { SwapOrderModel } from "../src/models/SwapOrder";

let passed = 0;
let total = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  total++;
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    passed++;
    return true;
  } catch (error: any) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(`   Error: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log("\n==========================================================================");
  console.log("  XTip — Phase 4 Database Persistence & Infrastructure Verification Suite");
  console.log("==========================================================================\n");

  // 1. SwapOrderModel Schema Verification
  await runTest("1. Schema: SwapOrderModel schema contains required fields and indices", async () => {
    assert.ok(SwapOrderModel, "SwapOrderModel must be defined and exported");
    const paths = (SwapOrderModel.schema as any).paths;
    assert.ok(paths.orderId, "orderId field must exist");
    assert.ok(paths.depositAddress, "depositAddress field must exist");
    assert.ok(paths.targetZecAddress, "targetZecAddress field must exist");
    assert.ok(paths.zecAmount, "zecAmount field must exist");
    assert.ok(paths.status, "status field must exist");
  });

  // 2. Tip Compound Indexes
  await runTest("2. Indexing: Tip model declares compound performance indexes", async () => {
    const indexes = Tip.schema.indexes();
    const hasRecipientStatus = indexes.some(
      ([idx]) => idx.recipientXUserId === 1 && idx.status === 1
    );
    const hasStatusExpiresAt = indexes.some(
      ([idx]) => idx.status === 1 && idx.expiresAt === 1
    );
    const hasStatusPayout = indexes.some(
      ([idx]) => idx.status === 1 && idx.payoutSubmittedAt === 1
    );

    assert.ok(hasRecipientStatus, "Missing compound index on { recipientXUserId: 1, status: 1 }");
    assert.ok(hasStatusExpiresAt, "Missing compound index on { status: 1, expiresAt: 1 }");
    assert.ok(hasStatusPayout, "Missing compound index on { status: 1, payoutSubmittedAt: 1 }");
  });

  // 3. PaymentLink Compound Indexes
  await runTest("3. Indexing: PaymentLink model declares creator and status compound index", async () => {
    const indexes = PaymentLink.schema.indexes();
    const hasCreatorStatus = indexes.some(
      ([idx]) => idx.creatorUsernameSnapshot === 1 && idx.status === 1
    );
    assert.ok(hasCreatorStatus, "Missing compound index on { creatorUsernameSnapshot: 1, status: 1 }");
  });

  // 4. PaymentRequest Compound Indexes
  await runTest("4. Indexing: PaymentRequest model declares query-optimized compound indexes", async () => {
    const indexes = PaymentRequest.schema.indexes();
    const hasTargetStatus = indexes.some(
      ([idx]) => idx.targetUsernameSnapshot === 1 && idx.status === 1
    );
    const hasRequesterStatus = indexes.some(
      ([idx]) => idx.requesterUsernameSnapshot === 1 && idx.status === 1
    );
    assert.ok(hasTargetStatus, "Missing compound index on { targetUsernameSnapshot: 1, status: 1 }");
    assert.ok(hasRequesterStatus, "Missing compound index on { requesterUsernameSnapshot: 1, status: 1 }");
  });

  // 5. Docker Compose Security Isolation
  await runTest("5. Infrastructure: docker-compose.yml restricts database and RPC ports to 127.0.0.1", async () => {
    const composeContent = fs.readFileSync(path.resolve(process.cwd(), "docker-compose.yml"), "utf8");
    assert.ok(
      composeContent.includes("127.0.0.1:27017:27017"),
      "MongoDB port 27017 must be bound exclusively to loopback 127.0.0.1"
    );
    assert.ok(
      composeContent.includes("127.0.0.1:18232:18232"),
      "Zallet RPC port 18232 must be bound exclusively to loopback 127.0.0.1"
    );
    assert.ok(
      composeContent.includes("127.0.0.1:18233:18233"),
      "Zebra RPC port 18233 must be bound exclusively to loopback 127.0.0.1"
    );
    assert.ok(
      !composeContent.match(/^\s*-\s*["']27017:27017["']/m),
      "Unrestricted 0.0.0.0 exposure of MongoDB port must be prevented"
    );
  });

  // 6. WCAG 2.1 Viewport Accessibility
  await runTest("6. Accessibility: layout viewport allows mobile pinch-to-zoom without restriction", async () => {
    const layoutContent = fs.readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    assert.ok(
      !layoutContent.includes("userScalable: false"),
      "userScalable should not be set to false in viewport export"
    );
    assert.ok(
      !layoutContent.includes("maximumScale: 1"),
      "maximumScale should not restrict mobile zooming in viewport export"
    );
  });

  console.log("--------------------------------------------------------------------------");
  console.log(`Phase 4 Infrastructure Tests: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal test runner error:", e);
  process.exit(1);
});
