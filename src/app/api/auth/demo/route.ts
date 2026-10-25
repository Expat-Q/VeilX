import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { User } from "@/models/User";
import { ALLOW_PAYMENT_SIMULATION } from "@/lib/zcash";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !ALLOW_PAYMENT_SIMULATION) {
    return NextResponse.json({ error: "Demo login is disabled in production." }, { status: 403 });
  }

  try {
    await connectToDatabase().catch(() => {});
    
    let user = await User.findOne({
      $or: [{ xUsername: "_Web3Central" }, { xUserId: "1721267472718839808" }],
    }).lean();

    if (!user) {
      user = await User.create({
        xUserId: "1721267472718839808",
        xUsername: "_Web3Central",
        xDisplayName: "Web3 Central",
        profileImageUrl: "https://unavatar.io/x/_Web3Central",
        referralCount: 0,
        referralRewardsZec: 0,
        referralPoints: 100,
      });
    }

    setSessionCookie({
      userId: (user._id || user.id).toString(),
      xUserId: user.xUserId,
      xUsername: user.xUsername,
      xDisplayName: user.xDisplayName || "_Web3Central",
      profileImageUrl: user.profileImageUrl,
    });

    const redirectUrl = new URL("/dashboard", req.url);
    return NextResponse.redirect(redirectUrl);
  } catch (err: any) {
    // In-memory fallback
    setSessionCookie({
      userId: "demo_web3central_id",
      xUserId: "1721267472718839808",
      xUsername: "_Web3Central",
      xDisplayName: "Web3 Central",
      profileImageUrl: "https://unavatar.io/x/_Web3Central",
    });

    const redirectUrl = new URL("/dashboard", req.url);
    return NextResponse.redirect(redirectUrl);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
