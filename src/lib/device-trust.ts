import { createHmac } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { BASE_PATH } from "./base-path";

// This is a bearer-like 2FA trust token, so it must be isolated to the app's
// sub-path (Path=/yosched) — not root-scoped — now that YoSched shares the apex
// domain (yologiq.com) with other sites. Same posture as the Auth.js cookies:
// __Secure- prefix + secure on HTTPS, dropped on plain-HTTP local dev.
const useSecureCookies = process.env.NODE_ENV === "production";
export const COOKIE_NAME = `${useSecureCookies ? "__Secure-" : ""}device-trust`;
const DEFAULT_DAYS = 30;

// Cookie options for the trusted-device token, exported so the sub-path scoping
// (the security-relevant part) is unit-testable without mocking next/headers.
export function deviceTrustCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: BASE_PATH,
    secure: useSecureCookies,
    maxAge,
  };
}

async function getTrustDays(): Promise<number> {
  const prefs = await prisma.schedulingPreferences.findFirst();
  return prefs?.deviceTrustDays ?? DEFAULT_DAYS;
}

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

function verify(token: string, expectedUserId: string, maxAgeSeconds: number): boolean {
  const parts = token.split(":");
  if (parts.length !== 3) return false;
  const [userId, tsStr, providedHmac] = parts;
  if (userId !== expectedUserId) return false;

  const timestamp = parseInt(tsStr, 10);
  if (isNaN(timestamp)) return false;

  const ageSeconds = (Date.now() - timestamp) / 1000;
  if (ageSeconds > maxAgeSeconds || ageSeconds < 0) return false;

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
  const days = await getTrustDays();
  return verify(cookie.value, userId, days * 24 * 60 * 60);
}

export async function setDeviceTrust(userId: string): Promise<void> {
  const days = await getTrustDays();
  const maxAge = days * 24 * 60 * 60;
  const token = sign(userId, Date.now());
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, deviceTrustCookieOptions(maxAge));
}
