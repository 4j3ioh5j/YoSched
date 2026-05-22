import { auth } from "./auth";
import { prisma } from "./prisma";
import { NextResponse } from "next/server";

type Role = "admin" | "manager" | "viewer";

const ROLE_LEVEL: Record<Role, number> = {
  viewer: 0,
  manager: 1,
  admin: 2,
};

export async function requireAuth(minRole: Role = "viewer") {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (!dbUser) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  const userRole = dbUser.role as Role;
  if (!userRole || ROLE_LEVEL[userRole] < ROLE_LEVEL[minRole]) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null };
  }

  (session.user as { role: string }).role = userRole;
  return { error: null, session };
}
