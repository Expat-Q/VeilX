import { NextResponse } from "next/server";

export const maxDuration = 10;

/**
 * Batch claiming route has been retired in favor of zero-knowledge client-side PCZT proving (ZIP-374).
 * Individual shielded notes are claimed with device-level Halo 2 proofs for maximum privacy and reliability.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Batch claiming has been retired in favor of zero-knowledge client-side PCZT proving. Please claim individual notes directly from your dashboard.",
    },
    { status: 410 }
  );
}
