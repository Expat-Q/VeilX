import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongodb";
import { zallet, ALLOW_PAYMENT_SIMULATION } from "@/lib/zcash";
import { isPayoutsHalted } from "@/lib/payout-controls";

export async function GET() {
  const timestamp = new Date().toISOString();
  let dbStatus = "disconnected";
  let nodeStatus = "unreachable";
  let nodeError: string | undefined;

  // 1. Check Database
  try {
    await connectToDatabase();
    if (mongoose.connection.readyState === 1) {
      dbStatus = "connected";
    }
  } catch (err: any) {
    dbStatus = "error";
  }

  // 2. Check Zcash RPC Node
  try {
    await zallet.call("getblockchaininfo");
    nodeStatus = "reachable";
  } catch (err: any) {
    nodeStatus = ALLOW_PAYMENT_SIMULATION ? "simulated" : "unreachable";
    nodeError = err.message || "Failed to reach Zcash RPC";
  }

  // 3. Circuit breaker status
  const payoutsHalted = isPayoutsHalted();

  const isHealthy = dbStatus === "connected" && (nodeStatus === "reachable" || (ALLOW_PAYMENT_SIMULATION && nodeStatus === "simulated"));
  const statusCode = isHealthy ? 200 : 503;

  return NextResponse.json(
    {
      status: isHealthy ? "ok" : "degraded",
      timestamp,
      environment: process.env.NODE_ENV || "development",
      simulationEnabled: ALLOW_PAYMENT_SIMULATION,
      services: {
        database: {
          status: dbStatus,
        },
        zcashNode: {
          status: nodeStatus,
          error: nodeStatus === "unreachable" ? nodeError : undefined,
        },
      },
      controls: {
        payoutsHalted,
      },
    },
    { status: statusCode }
  );
}
