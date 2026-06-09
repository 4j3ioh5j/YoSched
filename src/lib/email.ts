// SMTP email — a thin wrapper over nodemailer plus pure helpers. Sending is
// gated on configuration: until an admin fills in Settings → Email, sendSmtpMail
// is never reached (callers check isEmailConfigured first) and nothing is sent.

import nodemailer from "nodemailer";

// Validation for an OPTIONAL contact email — empty is allowed (→ null), but a
// non-empty value must look like an email. Pure + unit-tested so the staff API
// and any other caller share one rule. Deliberately permissive (not RFC-5322):
// a single @, non-empty local part, and a dotted domain with a 2+ char TLD.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type EmailResult = { ok: true; value: string | null } | { ok: false; error: string };

/** Normalize an optional email coming off a request body. Trims; treats
 *  empty/whitespace/null/undefined as "no email" (null); lowercases the value;
 *  rejects a non-empty value that isn't a plausible email. */
export function normalizeOptionalEmail(raw: unknown): EmailResult {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Email must be text" };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!EMAIL_RE.test(trimmed)) return { ok: false, error: "Enter a valid email address" };
  return { ok: true, value: trimmed.toLowerCase() };
}

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
  providerName: string;
  requestDescription: string; // e.g. "Off" / "AL leave" / "No ORC, ORL"
  dateRange: string; // e.g. "July 3, 2026" or "July 3 – July 5, 2026"
  flexible: boolean;
  submitted: string; // date + 24h time
  reference: string; // request id
}): { subject: string; text: string } {
  const { providerName, requestDescription, dateRange, flexible, submitted, reference } = args;
  const subject = `Schedule request received — ${requestDescription} (${dateRange})`;
  const text = [
    `Hi ${providerName},`,
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
