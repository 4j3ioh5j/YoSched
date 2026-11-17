import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { gated } from "@/lib/write-gate";
import { prisma } from "@/lib/prisma";
import { lastBackupAt } from "@/lib/backup/service";
import { backupDue } from "@/lib/backup/reminder";
import { currentAutoHealth } from "@/lib/backup/auto-service";

// Card #314: when the last backup was made, and whether the reminder is showing.
async function handleGET() {
  const { error, permissions } = await getSession();
  if (error) return error;
  if (!permissions.includes("data:backup")) return NextResponse.json({ allowed: false });
  const prefs = await prisma.schedulingPreferences.findFirst({ select: { backupReminderDays: true } });
  const reminderDays = prefs?.backupReminderDays ?? 7;
  const last = await lastBackupAt();
  const autoHealth = await currentAutoHealth(); // card #315: a failing automatic backup shows amber too
  return NextResponse.json({ allowed: true, lastBackupAt: last?.toISOString() ?? null, reminderDays, due: backupDue(last, reminderDays, new Date()), autoHealth });
}

// Card #314: the reminder's number of days (0 = never). Same permission as backing up.
async function handlePUT(req: Request) {
  const { error } = await getSession("data:backup");
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { reminderDays?: unknown } | null;
  const days = body?.reminderDays;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 365) {
    return NextResponse.json({ error: "Enter a whole number of days from 0 to 365 (0 = never remind)" }, { status: 400 });
  }
  const row = await prisma.schedulingPreferences.findFirst({ select: { id: true } });
  if (!row) return NextResponse.json({ error: "Scheduling preferences are missing" }, { status: 409 });
  await prisma.schedulingPreferences.update({ where: { id: row.id }, data: { backupReminderDays: days } });
  return NextResponse.json({ reminderDays: days });
}

export const GET = gated(handleGET);
export const PUT = gated(handlePUT);
