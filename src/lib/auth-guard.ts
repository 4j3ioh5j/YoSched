import { auth } from "./auth";
import { NextResponse } from "next/server";

type Role = "admin" | "manager" | "viewer";

const ROLE_LEVEL: Record<Role, number> = {
  viewer: 0,
  manager: 1,
  admin: 2,
};

export async function requireAuth(minRole: Role = "viewer") {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }

  const userRole = (session.user as { role?: string }).role as Role | undefined;
  if (!userRole || ROLE_LEVEL[userRole] < ROLE_LEVEL[minRole]) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null };
  }

  return { error: null, session };
}
