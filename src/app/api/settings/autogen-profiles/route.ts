import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { validateProfileInput } from "@/lib/autogen-profile";
import { NextRequest, NextResponse } from "next/server";

// Named snapshots of the auto-generation priority order (#252). A profile lets an admin
// save the current AutoGenFactor arrangement under a name and reapply it later, guarding
// against accidental drag-reorders. Profiles are shared department-wide (no owner filter
// on read). Applying a profile is purely client-side staging — the active order is only
// ever changed through PUT /api/settings/autogen-factors, so these routes never touch it.

type ProfileRow = {
  id: string;
  name: string;
  order: unknown;
  createdByName: string;
  createdAt: Date;
};

function serialize(p: ProfileRow) {
  return {
    id: p.id,
    name: p.name,
    order: Array.isArray(p.order) ? (p.order as string[]) : [],
    createdByName: p.createdByName,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const profiles = await prisma.autoGenPriorityProfile.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(profiles.map(serialize));
}

export async function POST(req: NextRequest) {
  const { error, userId } = await getSession("settings:autogen-priority");
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { name?: unknown; order?: unknown } | null;

  const existing = await prisma.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } });
  const existingKeys = existing.map((f) => f.key);

  const result = validateProfileInput(body?.name, body?.order, existingKeys);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, expected: existingKeys }, { status: 400 });
  }

  // Snapshot the saver's display name so the profile keeps attribution even if the user is
  // later renamed or deleted (the FK then nulls via onDelete: SetNull).
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  const created = await prisma.autoGenPriorityProfile.create({
    data: {
      name: result.name,
      order: result.order,
      createdById: userId,
      createdByName: user?.name ?? "Unknown",
    },
  });

  return NextResponse.json(serialize(created), { status: 201 });
}
