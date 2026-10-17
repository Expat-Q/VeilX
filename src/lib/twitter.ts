import crypto from "crypto";

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || "demo_client_id";
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || "";
const TWITTER_CALLBACK_URL = process.env.TWITTER_CALLBACK_URL || "http://localhost:3000/api/auth/callback/twitter";

export function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return { codeVerifier, codeChallenge };
}

export function getTwitterAuthUrl(state: string, codeChallenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: TWITTER_CLIENT_ID,
    redirect_uri: TWITTER_CALLBACK_URL,
    scope: "tweet.read users.read offline.access",
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string) {
  const params = new URLSearchParams({
    code: code,
    grant_type: "authorization_code",
    client_id: TWITTER_CLIENT_ID,
    redirect_uri: TWITTER_CALLBACK_URL,
    code_verifier: codeVerifier,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (TWITTER_CLIENT_SECRET) {
    const basicAuth = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString("base64");
    headers["Authorization"] = `Basic ${basicAuth}`;
  }

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: params.toString(),
  });

  if (!res.ok) {
    const errorData = await res.text();
    throw new Error(`Failed to exchange code for token: ${errorData}`);
  }

  return res.json();
}

export async function getTwitterMe(accessToken: string) {
  const res = await fetch(
    "https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username,description,verified,public_metrics",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error("Failed to fetch Twitter user profile");
  }

  const json = await res.json();
  return json.data;
}

export async function lookupTwitterUser(username: string) {
  const cleanHandle = username.replace("@", "").trim();

  // 1. Primary: Query FixTweet public profile resolver
  try {
    const fxRes = await fetch(`https://api.fxtwitter.com/${cleanHandle}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });

    if (fxRes.ok) {
      const fxData = await fxRes.json();
      if (fxData.code === 200 && fxData.user) {
        const u = fxData.user;
        return {
          xUserId: u.id || `x_${cleanHandle}`,
          name: u.name || cleanHandle,
          username: u.screen_name || cleanHandle,
          bio: u.description || undefined,
          profileImageUrl: u.avatar_url
            ? u.avatar_url.replace("_normal", "_400x400")
            : `https://unavatar.io/x/${cleanHandle}`,
          isVerified: u.verification?.verified ?? false,
          followersCount: typeof u.followers === "number" ? u.followers : undefined,
          followingCount: typeof u.following === "number" ? u.following : undefined,
        };
      }
    }
  } catch (e) {
    console.warn("FxTwitter lookup error:", e);
  }

  // 2. Secondary: If Twitter Bearer token is configured, query official Twitter API v2
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (bearerToken) {
    try {
      const cleanToken = decodeURIComponent(bearerToken.trim());
      const res = await fetch(
        `https://api.twitter.com/2/users/by/username/${cleanHandle}?user.fields=profile_image_url,description,name,verified,public_metrics`,
        {
          headers: {
            Authorization: `Bearer ${cleanToken}`,
          },
        }
      );

      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          return {
            xUserId: json.data.id,
            name: json.data.name || cleanHandle,
            username: json.data.username || cleanHandle,
            bio: json.data.description || undefined,
            profileImageUrl: json.data.profile_image_url
              ? json.data.profile_image_url.replace("_normal", "_400x400")
              : `https://unavatar.io/x/${cleanHandle}`,
            isVerified: json.data.verified ?? false,
            followersCount: json.data.public_metrics?.followers_count,
            followingCount: json.data.public_metrics?.following_count,
          };
        }
      }
    } catch (e) {
      console.warn("Twitter API v2 lookup error:", e);
    }
  }

  // 3. Fallback: Clean avatar & handle resolver
  return {
    xUserId: `14829${Math.abs(cleanHandle.split("").reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0))}`,
    name: cleanHandle.charAt(0).toUpperCase() + cleanHandle.slice(1),
    username: cleanHandle,
    bio: undefined,
    profileImageUrl: `https://unavatar.io/x/${cleanHandle}`,
    isVerified: false,
    followersCount: undefined,
    followingCount: undefined,
  };
}
