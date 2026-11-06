import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceSpec, hasLegacyEmploymentTypeName } from "@/lib/graph/spec";
import { NextRequest, NextResponse } from "next/server";

// GET — list views the caller may see: all shared views plus their own private ones.
export async function GET() {
  const result = await getSession("statistics:view");
  if (result.error) return result.error;

  const views = await prisma.savedGraphView.findMany({
    where: {
      OR: [{ isShared: true }, { ownerId: result.userId }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(views);
}

// POST — create a new saved view. Requires statistics:manage.
export async function POST(req: NextRequest) {
  const result = await getSession("statistics:manage");
  if (result.error) return result.error;

  const body = await req.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Card #71: an old browser bundle still filters by employment-type NAME — refuse, never save "any type".
  if (hasLegacyEmploymentTypeName(body?.spec)) return NextResponse.json({ error: "This page is out of date. Reload it and save the view again." }, { status: 409 });

  const view = await prisma.savedGraphView.create({
    data: {
      name,
      spec: coerceSpec(body?.spec),
      ownerId: result.userId,
      isShared: body?.isShared === false ? false : true,
    },
  });
  return NextResponse.json(view);
}
