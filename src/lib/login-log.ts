import { prisma } from "./prisma";
import { headers } from "next/headers";

export async function logLogin(opts: {
  email: string;
  userId?: string;
  success: boolean;
  reason?: string;
}) {
  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;
  const userAgent = hdrs.get("user-agent") || null;

  await prisma.loginLog.create({
    data: {
      email: opts.email,
      userId: opts.userId,
      success: opts.success,
      reason: opts.reason,
      ipAddress,
      userAgent,
    },
  });
}
