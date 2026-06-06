import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { buildSelfRequestInput, canWithdrawOwnRequest, describeRequest } from "@/lib/schedule-requests";
import { isEmailConfigured, buildConfirmationEmail, sendSmtpMail, type EmailConfig } from "@/lib/email";
import { formatDate, type DateFormatKey } from "@/lib/date-format";
import { NextRequest, NextResponse } from "next/server";
import type { ScheduleRequest } from "@/generated/prisma/client";

// Best-effort confirmation email to the requester's linked login. Never throws —
// emailing must not break request submission. No-op unless SMTP is configured.
async function sendConfirmationEmail(created: ScheduleRequest, userId: string): Promise<void> {
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
  if (!isEmailConfigured(config)) return;

  const ids = [...created.shiftTypeIds, created.leaveShiftTypeId].filter((x): x is string => !!x);
  const [user, provider, prefs, shifts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.provider.findUnique({ where: { id: created.providerId }, select: { name: true } }),
    prisma.schedulingPreferences.findFirst({ select: { dateFormat: true } }),
    ids.length ? prisma.shiftType.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } }) : Promise.resolve([]),
  ]);
  if (!user?.email) return;

  const codeMap = new Map(shifts.map((s) => [s.id, s.code]));
  const df = (prefs?.dateFormat ?? "MMMM D, YYYY") as DateFormatKey;
  const onDay = (d: Date) => formatDate(new Date(d.toISOString().slice(0, 10) + "T12:00:00"), df);
  const startStr = onDay(created.startDate);
  const endStr = onDay(created.endDate);
  const ra = created.receivedAt;
  const submitted = `${formatDate(ra, df)} ${String(ra.getHours()).padStart(2, "0")}:${String(ra.getMinutes()).padStart(2, "0")}`;

  const { subject, text } = buildConfirmationEmail({
    providerName: provider?.name ?? user.name ?? "there",
    requestDescription: describeRequest(
      { kind: created.kind as never, shiftTypeIds: created.shiftTypeIds, leaveShiftTypeId: created.leaveShiftTypeId, strength: created.strength as never },
      (id) => codeMap.get(id) ?? id
    ),
    dateRange: startStr === endStr ? startStr : `${startStr} – ${endStr}`,
    flexible: created.strength === "soft",
    submitted,
    reference: created.id,
  });
  await sendSmtpMail(config, { to: user.email, subject, text });
}

// Provider self-service requests. Every handler forces the row to the caller's
// linked provider — a provider can only see and act on their OWN requests.

function serialize(r: ScheduleRequest) {
  return {
    id: r.id,
    providerId: r.providerId,
    startDate: r.startDate.toISOString().split("T")[0],
    endDate: r.endDate.toISOString().split("T")[0],
    kind: r.kind,
    shiftTypeIds: r.shiftTypeIds,
    leaveShiftTypeId: r.leaveShiftTypeId,
    strength: r.strength,
    status: r.status,
    source: r.source,
    receivedAt: r.receivedAt.toISOString(),
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    notes: r.notes,
  };
}

function toDate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

// 403 when the login has requests:self but isn't linked to a provider yet.
function notLinked() {
  return NextResponse.json({ error: "Your login isn't linked to a provider yet — ask an administrator." }, { status: 403 });
}

// GET — the caller's own requests (every status), newest first.
export async function GET() {
  const result = await getSession("requests:self");
  if (result.error) return result.error;
  if (!result.providerId) return notLinked();

  const requests = await prisma.scheduleRequest.findMany({
    where: { providerId: result.providerId },
    orderBy: { receivedAt: "desc" },
  });
  return NextResponse.json(requests.map(serialize));
}

// POST — create a request for yourself (forced source=provider, status pending).
export async function POST(req: NextRequest) {
  const result = await getSession("requests:self");
  if (result.error) return result.error;
  if (!result.providerId) return notLinked();

  const parsed = buildSelfRequestInput(await req.json(), result.providerId);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const v = parsed.value;

  const created = await prisma.scheduleRequest.create({
    data: {
      providerId: v.providerId,
      startDate: toDate(v.startDate),
      endDate: toDate(v.endDate),
      kind: v.kind,
      shiftTypeIds: v.shiftTypeIds,
      leaveShiftTypeId: v.leaveShiftTypeId,
      strength: v.strength,
      source: v.source,
      notes: v.notes,
    },
  });

  // Confirmation email — best-effort; a send failure never fails the submission.
  // Log only a sanitized shape (id + SMTP error code), never the raw error which
  // can echo recipient/account details.
  await sendConfirmationEmail(created, result.userId).catch((e) =>
    console.error("Confirmation email failed", { requestId: created.id, code: (e as { code?: string })?.code ?? "unknown" })
  );

  return NextResponse.json(serialize(created), { status: 201 });
}

// DELETE — withdraw one of your own still-pending requests (kept as an audit row).
export async function DELETE(req: NextRequest) {
  const result = await getSession("requests:self");
  if (result.error) return result.error;
  if (!result.providerId) return notLinked();

  const { id } = await req.json();
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing request id" }, { status: 400 });
  }

  const existing = await prisma.scheduleRequest.findUnique({
    where: { id },
    select: { providerId: true, status: true },
  });
  if (!canWithdrawOwnRequest(existing, result.providerId)) {
    return NextResponse.json({ error: "You can only withdraw your own pending requests" }, { status: 403 });
  }

  const updated = await prisma.scheduleRequest.update({
    where: { id },
    data: { status: "withdrawn" },
  });
  return NextResponse.json(serialize(updated));
}
