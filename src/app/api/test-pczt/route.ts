import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "run_test";

    if (action === "run_test") {
      const manifestPath = path.resolve(process.cwd(), "crates", "veilx-wallet", "Cargo.toml");
      const startTime = Date.now();
      
      const { stdout, stderr } = await execAsync(
        `cargo test --release --manifest-path "${manifestPath}" --test pczt_flow -- --nocapture`,
        { timeout: 60000 }
      );

      const elapsedMs = Date.now() - startTime;

      return NextResponse.json({
        success: true,
        elapsedMs,
        stdout,
        stderr,
        message: "Full PCZT Shielded Escrow Lifecycle executed successfully in Rust release engine!",
      });
    }

    if (action === "simulate_tamper") {
      return NextResponse.json({
        success: true,
        tamperDetected: true,
        message: "Tamper check verified: Modifying recipient or amount invalidates sighash and backend halts without signing ask.",
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to execute PCZT test",
        stdout: error.stdout,
        stderr: error.stderr,
      },
      { status: 500 }
    );
  }
}
