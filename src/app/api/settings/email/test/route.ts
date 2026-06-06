import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { isEmailConfigured, sendSmtpMail, type EmailConfig } from "@/lib/email";
import { NextResponse } from "next/server";

// Send a test email to the current user, to verify SMTP credentials.
export async function POST() {
  const result = await getSession("settings:edit");
  if (result.error) return result.error;

  const row = await prisma.emailSettings.findUnique({ where: { id: "default" } });
  const config: EmailConfig = {
    enabled: row?.enabled ?? false,
    host: row?.host ?? null,
    port: row?.port ?? 587,
    secure: row?.secure ?? false,
    username: row?.username ?? null,
    password: row?.password ?? null,
    fromAddress: row?.fromAddress ?? null,
  };
  if (!isEmailConfigured(config)) {
    return NextResponse.json({ error: "Email isn't fully configured (and enabled) yet." }, { status: 400 });
  }

  const me = await prisma.user.findUnique({ where: { id: result.userId }, select: { email: true, name: true } });
  if (!me?.email) {
    return NextResponse.json({ error: "Your account has no email address to send to." }, { status: 400 });
  }

  try {
    await sendSmtpMail(config, {
      to: me.email,
      subject: "YoSched test email",
      text: `Hi ${me.name ?? "there"},\n\nThis is a test email from YoSched. Your SMTP settings are working.\n\n— YoSched`,
    });
  } catch (e) {
    // Log the verbose SMTP error server-side; return a friendly category to the
    // client (some servers echo account details in the raw message).
    console.error("SMTP test email failed:", e);
    const code = (e as { code?: string })?.code;
    const friendly =
      code === "EAUTH" ? "Authentication failed — check the username and password."
      : code === "EENVELOPE" ? "The server rejected the from/to address."
      : (code === "ECONNECTION" || code === "ESOCKET" || code === "ETIMEDOUT" || code === "EDNS")
        ? "Could not reach the SMTP server — check the host, port, and TLS setting."
        : "Could not send the test email — see the server logs for details.";
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sentTo: me.email });
}
