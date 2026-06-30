import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// Delete a saved auto-generation priority profile (#252). Profiles are shared
// department-wide; removing one requires the admin-level settings:autogen-priority
// permission. Deleting a profile never affects the active order — that lives in
// AutoGenFactor.sortOrder.
export async function DELETE(_req: Request, { params }: Ctx) {
  const { error } = await getSession("settings:autogen-priority");
  if (error) return error;

  const { id } = await params;
  await prisma.autoGenPriorityProfile.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
