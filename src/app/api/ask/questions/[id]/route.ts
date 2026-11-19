import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { validateAskSpec, MAX_QUESTION_NAME } from "@/lib/ask/spec";
import { canManageView, nextOwnerId } from "@/lib/graph/view-access";
import { NextRequest, NextResponse } from "next/server";
import { gated } from "@/lib/write-gate";

type Ctx = { params: Promise<{ id: string }> };

// Card #367. PUT — rename, change the question, or share/unshare. Requires statistics:manage.
async function handlePUT(req: NextRequest, { params }: Ctx) {
  const result = await getSession(["statistics:manage", "schedule:view"]);
  if (result.error) return result.error;
  const { id } = await params;
  const existing = await prisma.savedQuestion.findUnique({ where: { id } });
  if (!existing || !canManageView(existing, result.userId)) {
    // A private question of someone else is reported as missing, not as forbidden.
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const data: { name?: string; spec?: object; isShared?: boolean; ownerId?: string | null } = {};
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    if (name.length > MAX_QUESTION_NAME) return NextResponse.json({ error: `Name is longer than ${MAX_QUESTION_NAME} characters` }, { status: 400 });
    data.name = name;
  }
  if (body?.spec !== undefined) {
    const v = validateAskSpec(body.spec);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    data.spec = v.spec;
  }
  if (body?.isShared !== undefined) {
    if (typeof body.isShared !== "boolean") return NextResponse.json({ error: "isShared must be true or false" }, { status: 400 });
    data.isShared = body.isShared;
    const owner = nextOwnerId(existing, body.isShared, result.userId);
    if (owner !== existing.ownerId) data.ownerId = owner;
  }
  const q = await prisma.savedQuestion.update({ where: { id }, data });
  return NextResponse.json(q);
}

// DELETE — remove a saved question. Requires statistics:manage.
async function handleDELETE(_req: NextRequest, { params }: Ctx) {
  const result = await getSession(["statistics:manage", "schedule:view"]);
  if (result.error) return result.error;
  const { id } = await params;
  const existing = await prisma.savedQuestion.findUnique({ where: { id } });
  if (!existing || !canManageView(existing, result.userId)) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  await prisma.savedQuestion.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export const PUT = gated(handlePUT);
export const DELETE = gated(handleDELETE);
