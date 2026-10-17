import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "xtip_session";
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: SESSION_SECRET must be configured with at least 32 characters in production.");
    }
    return "xtip_super_secret_session_key_32_bytes_len!";
  }
  return secret;
}

export interface SessionData {
  userId: string;
  xUserId: string;
  xUsername: string;
  xDisplayName?: string;
  profileImageUrl?: string;
  issuedAt?: number;
  expiresAt?: number;
}

/**
 * Encrypt session data using authenticated AES-256-GCM.
 * Output format: ivHex:authTagHex:ciphertextHex
 */
export function encryptSession(data: SessionData, maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS): string {
  const secret = getSessionSecret();
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12); // GCM standard 96-bit IV
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const now = Date.now();
  const envelope = {
    data,
    exp: now + maxAgeSeconds * 1000,
    iat: now,
  };

  const text = JSON.stringify(envelope);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt session cookie with authenticated AES-256-GCM and verify validity.
 * Returns null if tampering is detected, format is invalid, or session is expired.
 */
export function decryptSession(cookieValue: string): SessionData | null {
  try {
    if (!cookieValue || typeof cookieValue !== "string") return null;
    const parts = cookieValue.split(":");
    if (parts.length !== 3) return null;

    const [ivHex, tagHex, encryptedText] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");

    if (iv.length !== 12 || authTag.length !== 16) return null;

    const secret = getSessionSecret();
    const key = crypto.createHash("sha256").update(secret).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    const parsed = JSON.parse(decrypted);
    if (!parsed) return null;

    // Check expiration timestamp
    if (parsed.exp && typeof parsed.exp === "number" && Date.now() > parsed.exp) {
      return null;
    }

    return parsed.data || parsed;
  } catch (e) {
    return null;
  }
}

export async function getCurrentUser(): Promise<SessionData | null> {
  try {
    const cookieStore = cookies();
    const sessionCookie = cookieStore.get(COOKIE_NAME);
    if (!sessionCookie?.value) return null;
    return decryptSession(sessionCookie.value);
  } catch (e) {
    return null;
  }
}

export function setSessionCookie(data: SessionData) {
  const encrypted = encryptSession(data);
  cookies().set(COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEFAULT_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}
