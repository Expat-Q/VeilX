import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/db-service";
import { getCurrentUser } from "@/lib/auth";
import { zallet } from "@/lib/zcash";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const paylinks = await dbService.getPayLinks(user.xUsername);

    // Enrich unconfirmed paylinks with live confirmation count
    const enriched = await Promise.all(
      paylinks.map(async (p: any) => {
        if (p.paidTxid && (p.status === "SETTLING" || p.status === "UNPAID")) {
          try {
            const rawTx = await zallet.call<any>("getrawtransaction", [p.paidTxid, 1]);
            const confs = rawTx?.confirmations || 0;
            if (confs >= 1) {
              await dbService.promotePayLinkToPaid(p.slug, p.paidTxid);
              return { ...p, status: "PAID", confirmations: confs };
            }
            return { ...p, confirmations: confs };
          } catch {
            return { ...p, confirmations: 0 };
          }
        }
        return p;
      })
    );

    return NextResponse.json({ success: true, paylinks: enriched });
  } catch (error) {
    console.error("Fetch paylinks error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const { title, amountZec, recipientShieldedUa } = body;

    const parsedAmount = typeof amountZec === "number" ? amountZec : parseFloat(amountZec);
    if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount < 0.0002) {
      return NextResponse.json(
        { error: "Amount must be at least 0.0002 ZEC (to cover the 0.0001 ZEC Zcash network miner fee)." },
        { status: 400 }
      );
    }

    const paylink = await dbService.createPayLink({
      creatorUserId: user.userId,
      creatorUsername: user.xUsername,
      title: title.trim(),
      amountZec: parsedAmount,
      recipientShieldedUa: recipientShieldedUa.trim(),
    });

    return NextResponse.json({ success: true, paylink });
  } catch (error: any) {
    console.error("Create paylink error:", error);
    const msg = error.message || "Failed to create paylink";
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("INVALID_RECIPIENT_ADDRESS") || msg.includes("INVALID_AMOUNT") ? 400 : 500 }
    );
  }
}
