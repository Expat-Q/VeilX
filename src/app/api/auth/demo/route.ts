import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { User } from "@/models/User";
import { ALLOW_PAYMENT_SIMULATION } from "@/lib/zcash";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !ALLOW_PAYMENT_SIMULATION) {
    return NextResponse.json({ error: "Demo login is disabled in production." }, { status: 403 });
  }

  const targetUsername = req.nextUrl.searchParams.get("user") || "ExpatQ3";
  const isWeb3Central = targetUsername.toLowerCase().includes("web3");
  const username = isWeb3Central ? "_Web3Central" : "ExpatQ3";
  const displayName = isWeb3Central ? "Web3 Central" : "ExpatQ3";
  const defaultXUserId = isWeb3Central ? "1721267472718839808" : "6ac7f8b168ebdfc813cba4b9";

  try {
    await connectToDatabase().catch(() => {});
    
    let user = await User.findOne({
      $or: [{ xUsername: username }, { xUserId: defaultXUserId }],
    }).lean();

    if (!user) {
      user = await User.create({
        xUserId: defaultXUserId,
        xUsername: username,
        xDisplayName: displayName,
        profileImageUrl: `https://unavatar.io/x/${username}`,
        referralCount: 0,
        referralRewardsZec: 0,
        referralPoints: 100,
      });
    }

    setSessionCookie({
      userId: (user._id || user.id).toString(),
      xUserId: user.xUserId,
      xUsername: user.xUsername,
      xDisplayName: user.xDisplayName || displayName,
      profileImageUrl: user.profileImageUrl || `https://unavatar.io/x/${username}`,
    });

    const redirectUrl = new URL("/dashboard", req.url);
    return NextResponse.redirect(redirectUrl);
  } catch (err: any) {
    // In-memory fallback
    setSessionCookie({
      userId: `demo_${username.toLowerCase()}_id`,
      xUserId: defaultXUserId,
      xUsername: username,
      xDisplayName: displayName,
      profileImageUrl: `https://unavatar.io/x/${username}`,
    });

    const redirectUrl = new URL("/dashboard", req.url);
    return NextResponse.redirect(redirectUrl);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
