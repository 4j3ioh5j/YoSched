import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { BASE_PATH } from "./base-path";
import { getEpoch } from "./auth-epoch";

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

/** What a trusted-device cookie carries in place of the epoch itself (card #319). */
export function epochHash(epoch: string): string {
  return createHash("sha256").update(epoch).digest("hex").slice(0, 16);
}

/** Who a trusted-device cookie is for (card #319): the login, its session version and the
 *  install's auth epoch. Any of them changing ends every cookie issued before. */
export type TrustSubject = { userId: string; sv: number; epoch: string };

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("hex");

/** `userId:sv:epochHash:ts:hmac` — the epoch travels only as a hash. */
export function signTrust(who: TrustSubject, timestamp: number, secret: string): string {
  const payload = `${who.userId}:${who.sv}:${epochHash(who.epoch)}:${timestamp}`;
  return `${payload}:${mac(payload, secret)}`;
}

export function verifyTrust(token: string, who: TrustSubject, maxAgeSeconds: number, secret: string, now = Date.now()): boolean {
  const parts = token.split(":");
  if (parts.length !== 5) return false; // includes the pre-#319 userId:ts:hmac format
  const [userId, svStr, eh, tsStr, provided] = parts;
  if (userId !== who.userId || svStr !== String(who.sv) || eh !== epochHash(who.epoch)) return false;
  if (!/^\d+$/.test(tsStr)) return false;
  const ageSeconds = (now - Number(tsStr)) / 1000;
  if (ageSeconds > maxAgeSeconds || ageSeconds < 0) return false;
  const expected = Buffer.from(mac(`${userId}:${svStr}:${eh}:${tsStr}`, secret));
  const got = Buffer.from(provided);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Is this browser trusted for this login at its CURRENT session version and epoch? */
export async function isDeviceTrusted(user: { id: string; sessionVersion: number }): Promise<boolean> {
  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME);
  if (!cookie?.value) return false;
  const [days, epoch] = await Promise.all([getTrustDays(), getEpoch()]);
  return verifyTrust(cookie.value, { userId: user.id, sv: user.sessionVersion, epoch }, days * 24 * 60 * 60, getSecret());
}

/** Issued only for a session that is current (getSession) and proved a code just now. */
export async function setDeviceTrust(user: { id: string; sessionVersion: number }): Promise<void> {
  const [days, epoch] = await Promise.all([getTrustDays(), getEpoch()]);
  const token = signTrust({ userId: user.id, sv: user.sessionVersion, epoch }, Date.now(), getSecret());
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, deviceTrustCookieOptions(days * 24 * 60 * 60));
}
