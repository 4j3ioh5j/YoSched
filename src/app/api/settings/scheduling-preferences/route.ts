import { requireAuth } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  const { prefer3DayWeekends, prefer4DayWeekends, preferSequentialOff, deviceTrustDays } = body;

  const prefs = await prisma.schedulingPreferences.upsert({
    where: { id: "default" },
    update: {
      ...(typeof prefer3DayWeekends === "boolean" && { prefer3DayWeekends }),
      ...(typeof prefer4DayWeekends === "boolean" && { prefer4DayWeekends }),
      ...(typeof preferSequentialOff === "boolean" && { preferSequentialOff }),
      ...(typeof deviceTrustDays === "number" && deviceTrustDays >= 1 && deviceTrustDays <= 365 && { deviceTrustDays: Math.floor(deviceTrustDays) }),
    },
    create: {
      id: "default",
      prefer3DayWeekends: prefer3DayWeekends ?? true,
      prefer4DayWeekends: prefer4DayWeekends ?? true,
      preferSequentialOff: preferSequentialOff ?? true,
    },
  });

  return NextResponse.json(prefs);
}
