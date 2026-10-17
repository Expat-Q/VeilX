import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { User } from "@/models/User";

export async function GET() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return NextResponse.json({ authenticated: false, user: null });
  }

  try {
    await connectToDatabase();
    const dbUser = await User.findOne({ xUserId: sessionUser.xUserId }).lean();
    if (dbUser) {
      return NextResponse.json({
        authenticated: true,
        user: {
          ...sessionUser,
          referralCount: dbUser.referralCount || 0,
          referralRewardsZec: dbUser.referralRewardsZec || 0,
          referralPoints: dbUser.referralPoints || 0,
        },
      });
    }
  } catch (e) {
    // If Mongo offline, return session user
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      ...sessionUser,
      referralCount: 0,
      referralRewardsZec: 0,
      referralPoints: 0,
    },
  });
}
