// SMTP email — a thin wrapper over nodemailer plus pure helpers. Sending is
// gated on configuration: until an admin fills in Settings → Email, sendSmtpMail
// is never reached (callers check isEmailConfigured first) and nothing is sent.

import nodemailer from "nodemailer";

export type EmailConfig = {
  enabled: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromAddress: string | null;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/** Can we actually send? Requires the feature on plus the minimum SMTP fields.
 *  Auth (username/password) is optional — some internal relays don't use it. Pure. */
export function isEmailConfigured(c: EmailConfig | null | undefined): boolean {
  return !!c && c.enabled && !!c.host && c.port > 0 && !!c.fromAddress;
}

/** Build the confirmation email a requester gets on submit. All fields are
 *  pre-formatted by the caller (dates, description) so this stays pure/testable. */
export function buildConfirmationEmail(args: {
  staffName: string;
  requestDescription: string; // e.g. "Off" / "AL leave" / "No ORC, ORL"
  dateRange: string; // e.g. "July 3, 2026" or "July 3 – July 5, 2026"
  flexible: boolean;
  submitted: string; // date + 24h time
  reference: string; // request id
}): { subject: string; text: string } {
  const { staffName, requestDescription, dateRange, flexible, submitted, reference } = args;
  const subject = `Schedule request received — ${requestDescription} (${dateRange})`;
  const text = [
    `Hi ${staffName},`,
    ``,
    `We've received your schedule request. It's now pending review by the scheduler.`,
    ``,
    `  Request:   ${requestDescription}${flexible ? " (preference)" : ""}`,
    `  Date(s):   ${dateRange}`,
    `  Submitted: ${submitted}`,
    `  Reference: ${reference}`,
    ``,
    `You can view or withdraw a pending request any time on the My Requests page.`,
    ``,
    `— YoSched`,
  ].join("\n");
  return { subject, text };
}

/** Send one message over SMTP. Throws on transport/auth failure (the caller
 *  decides whether that blocks anything — for the request flow it does not). */
export async function sendSmtpMail(config: EmailConfig, message: EmailMessage): Promise<void> {
  if (!isEmailConfigured(config)) {
    throw new Error("Email is not configured");
  }
  const transport = nodemailer.createTransport({
    host: config.host!,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password ?? "" } : undefined,
  });
  await transport.sendMail({
    from: config.fromAddress!,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
