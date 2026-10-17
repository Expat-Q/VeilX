import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, getTwitterMe } from "@/lib/twitter";
import { connectToDatabase } from "@/lib/mongodb";
import { User } from "@/models/User";
import { setSessionCookie } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const cookieStore = cookies();
  const savedState = cookieStore.get("oauth_state")?.value;
  const codeVerifier = cookieStore.get("oauth_code_verifier")?.value;

  if (!code || !state || !savedState || state !== savedState || !codeVerifier) {
    return NextResponse.redirect(new URL("/?error=invalid_oauth_state", req.url));
  }

  try {
    // 1. Exchange code for access token
    const tokenData = await exchangeCodeForToken(code, codeVerifier);

    // 2. Fetch authenticated user profile from Twitter API v2
    const twitterUser = await getTwitterMe(tokenData.access_token);

    // 3. Connect to MongoDB and upsert User
    await connectToDatabase();
    const existingUser = await User.findOne({ xUserId: twitterUser.id });
    const rawRefCookie = cookieStore.get("xtip_ref")?.value;
    const sanitizedReferrer = rawRefCookie
      ? rawRefCookie.replace("@", "").trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15)
      : null;

    let user;
    if (!existingUser) {
      // Prevent self-referral rewards farming
      const isSelfReferral =
        sanitizedReferrer &&
        sanitizedReferrer.toLowerCase() === twitterUser.username.toLowerCase();
      const validReferrer = sanitizedReferrer && !isSelfReferral ? sanitizedReferrer : undefined;

      user = await User.create({
        xUserId: twitterUser.id,
        xUsername: twitterUser.username,
        xDisplayName: twitterUser.name,
        profileImageUrl: twitterUser.profile_image_url,
        referredBy: validReferrer,
        referralCount: 0,
        referralRewardsZec: 0,
        referralPoints: 50, // Welcome signup bonus points
      });

      // Reward the referrer safely
      if (validReferrer) {
        await User.findOneAndUpdate(
          { xUsername: { $regex: new RegExp(`^${validReferrer}$`, "i") } },
          { $inc: { referralCount: 1, referralPoints: 100, referralRewardsZec: 0.01 } }
        );
      }
    } else {
      user = await User.findOneAndUpdate(
        { xUserId: twitterUser.id },
        {
          $set: {
            xUsername: twitterUser.username,
            xDisplayName: twitterUser.name,
            profileImageUrl: twitterUser.profile_image_url,
          },
        },
        { new: true }
      );
    }

    // 4. Set encrypted session cookie
    if (user) {
      setSessionCookie({
        userId: user._id.toString(),
        xUserId: user.xUserId,
        xUsername: user.xUsername,
        xDisplayName: user.xDisplayName,
        profileImageUrl: user.profileImageUrl,
      });
    }

    // Cleanup OAuth cookies
    cookieStore.delete("oauth_code_verifier");
    cookieStore.delete("oauth_state");

    return NextResponse.redirect(new URL("/", req.url));
  } catch (error) {
    console.error("Twitter OAuth Callback Error:", error);
    return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
  }
}
