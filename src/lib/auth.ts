import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./prisma";
import { authConfig } from "./auth.config";
import { decrypt } from "./crypto";
import { isDeviceTrusted } from "./device-trust";
import { checkRateLimit } from "./rate-limit";
import { logLogin } from "./login-log";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

async function recordFailedAttempt(userId: string, currentAttempts: number) {
  const attempts = currentAttempts + 1;
  const data: { failedAttempts: number; lockedUntil?: Date | null } = { failedAttempts: attempts };
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    data.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
  }
  await prisma.user.update({ where: { id: userId }, data });
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "credentials",
      credentials: {
        email: {},
        password: {},
        totpCode: {},
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        const password = credentials?.password as string;
        const totpCode = credentials?.totpCode as string | undefined;
        if (!email || !password) return null;

        const rl = checkRateLimit(email.toLowerCase());
        if (!rl.allowed) return null;

        const user = await prisma.user.findUnique({ where: { email }, include: { group: true } });
        if (!user) return null;

        if (!user.isActive) return null;
        if (user.lockedUntil && user.lockedUntil > new Date()) return null;

        const valid = await compare(password, user.passwordHash);
        if (!valid) {
          await recordFailedAttempt(user.id, user.failedAttempts);
          return null;
        }

        let totpVerifiedAt: number | undefined;
        if (user.totpEnabled && user.totpSecret) {
          const trusted = await isDeviceTrusted(user.id);
          if (!trusted) {
            if (!totpCode) return null;
            const secret = decrypt(user.totpSecret);
            const { verifySync } = await import("otplib");
            const result = verifySync({ token: totpCode, secret });
            if (!result.valid) {
              await recordFailedAttempt(user.id, user.failedAttempts);
              await logLogin({ email, userId: user.id, success: false, reason: "bad_totp" });
              return null;
            }
            await logLogin({ email, userId: user.id, success: true, reason: "totp_verified" });
            totpVerifiedAt = Date.now();
          }
        }

        if (user.failedAttempts > 0) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedAttempts: 0, lockedUntil: null },
          });
        }

        return {
          id: user.id, email: user.email, name: user.name, role: user.role, totpVerifiedAt,
          groupId: user.groupId ?? undefined, groupName: user.group?.name, groupLevel: user.group?.level,
          permissions: user.group?.permissions ?? [],
        };
      },
    }),
  ],
});
