import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-guard";
import { validatePassword } from "@/lib/password";
import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";

export async function GET() {
  const { error } = await requireAuth("admin");
  if (error) return error;

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, totpEnabled: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;

  const { email, name, password, role } = await req.json();
  if (!email || !name || !password) {
    return NextResponse.json({ error: "Email, name, and password required" }, { status: 400 });
  }

  const { valid, errors } = validatePassword(password);
  if (!valid) {
    return NextResponse.json({ error: `Password requirements: ${errors.join(", ")}` }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const passwordHash = await hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, role: role || "viewer" },
    select: { id: true, email: true, name: true, role: true, isActive: true, totpEnabled: true, createdAt: true },
  });

  return NextResponse.json(user);
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("admin");
  if (error) return error;

  const { id, email, name, password, role, isActive } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (email) data.email = email;
  if (name) data.name = name;
  if (role) data.role = role;
  if (typeof isActive === "boolean") data.isActive = isActive;
  if (password) {
    const { valid, errors } = validatePassword(password);
    if (!valid) {
      return NextResponse.json({ error: `Password requirements: ${errors.join(", ")}` }, { status: 400 });
    }
    data.passwordHash = await hash(password, 12);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, isActive: true, totpEnabled: true, createdAt: true },
  });

  return NextResponse.json(user);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await requireAuth("admin");
  if (error) return error;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (id === session!.user!.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
