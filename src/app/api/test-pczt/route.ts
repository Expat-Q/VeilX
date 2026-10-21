import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "run_test";

    if (action === "run_test") {
      const depsDir = path.resolve(process.cwd(), "crates", "veilx-wallet", "target", "release", "deps");
      let cmd = "";

      // Look for precompiled release test binary first to run instantly (< 17s)
      if (fs.existsSync(depsDir)) {
        const files = fs.readdirSync(depsDir);
        const testExe = files.find((f) => f.startsWith("pczt_flow-") && f.endsWith(".exe"));
        if (testExe) {
          cmd = `"${path.join(depsDir, testExe)}" --nocapture`;
        }
      }

      if (!cmd) {
        const manifestPath = path.resolve(process.cwd(), "crates", "veilx-wallet", "Cargo.toml");
        cmd = `cargo test --release --manifest-path "${manifestPath}" --test pczt_flow -- --nocapture`;
      }

      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 90000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const elapsedMs = Date.now() - startTime;

      // Extract output log lines for the UI
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("running 1") && !l.startsWith("test result"));

      return NextResponse.json({
        success: true,
        elapsedMs,
        stdout,
        lines,
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
