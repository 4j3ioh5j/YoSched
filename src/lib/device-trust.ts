import { createHmac } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "device-trust";
const MAX_AGE_DAYS = 30;
const MAX_AGE_SECONDS = MAX_AGE_DAYS * 24 * 60 * 60;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for device trust");
  return secret;
}

function sign(userId: string, timestamp: number): string {
  const payload = `${userId}:${timestamp}`;
  const hmac = createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}:${hmac}`;
}

function verify(token: string, expectedUserId: string): boolean {
  const parts = token.split(":");
  if (parts.length !== 3) return false;
  const [userId, tsStr, providedHmac] = parts;
  if (userId !== expectedUserId) return false;

  const timestamp = parseInt(tsStr, 10);
  if (isNaN(timestamp)) return false;

  const ageSeconds = (Date.now() - timestamp) / 1000;
  if (ageSeconds > MAX_AGE_SECONDS || ageSeconds < 0) return false;

  const expected = createHmac("sha256", getSecret()).update(`${userId}:${tsStr}`).digest("hex");
  if (expected.length !== providedHmac.length) return false;

  let match = true;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== providedHmac[i]) match = false;
  }
  return match;
}

export async function isDeviceTrusted(userId: string): Promise<boolean> {
  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME);
  if (!cookie?.value) return false;
  return verify(cookie.value, userId);
}

export async function setDeviceTrust(userId: string): Promise<void> {
  const token = sign(userId, Date.now());
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
  });
}
