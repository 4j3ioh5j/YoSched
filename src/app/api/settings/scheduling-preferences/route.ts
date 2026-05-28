import { requireAuth } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidDateFormat } from "@/lib/date-format";

export async function GET() {
  const { error } = await requireAuth("admin");
  if (error) return error;
  let prefs = await prisma.schedulingPreferences.findFirst();
  if (!prefs) {
    prefs = await prisma.schedulingPreferences.create({
      data: { id: "default" },
    });
  }
  return NextResponse.json(prefs);
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;
  const body = await req.json();
  const { prefer3DayWeekends, prefer4DayWeekends, preferSequentialOff, deviceTrustDays, dateFormat } = body;

  const prefs = await prisma.schedulingPreferences.upsert({
    where: { id: "default" },
    update: {
      ...(typeof prefer3DayWeekends === "boolean" && { prefer3DayWeekends }),
      ...(typeof prefer4DayWeekends === "boolean" && { prefer4DayWeekends }),
      ...(typeof preferSequentialOff === "boolean" && { preferSequentialOff }),
      ...(typeof deviceTrustDays === "number" && deviceTrustDays >= 1 && deviceTrustDays <= 365 && { deviceTrustDays: Math.floor(deviceTrustDays) }),
      ...(typeof dateFormat === "string" && isValidDateFormat(dateFormat) && { dateFormat }),
    },
    create: {
      id: "default",
      prefer3DayWeekends: prefer3DayWeekends ?? true,
      prefer4DayWeekends: prefer4DayWeekends ?? true,
      preferSequentialOff: preferSequentialOff ?? true,
      ...(typeof dateFormat === "string" && isValidDateFormat(dateFormat) && { dateFormat }),
    },
  });

  return NextResponse.json(prefs);
}
