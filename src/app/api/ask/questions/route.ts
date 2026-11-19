import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { validateAskSpec, MAX_QUESTION_NAME } from "@/lib/ask/spec";
import { NextRequest, NextResponse } from "next/server";
import { gated } from "@/lib/write-gate";

// Card #367: saved questions for the "Ask" page. Same sharing rules as saved Statistics views.


// GET — the questions the caller may see: every shared one plus their own private ones.
async function handleGET() {
  const result = await getSession(["statistics:view", "schedule:view"]);
  if (result.error) return result.error;
  const questions = await prisma.savedQuestion.findMany({
    where: { OR: [{ isShared: true }, { ownerId: result.userId }] },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(questions);
}

// POST — save a new question. Requires statistics:manage; the spec is checked here, never trusted.
async function handlePOST(req: NextRequest) {
  const result = await getSession(["statistics:manage", "schedule:view"]);
  if (result.error) return result.error;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (name.length > MAX_QUESTION_NAME) return NextResponse.json({ error: `Name is longer than ${MAX_QUESTION_NAME} characters` }, { status: 400 });
  const v = validateAskSpec(body?.spec);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const q = await prisma.savedQuestion.create({
    data: { name, spec: v.spec, ownerId: result.userId, isShared: body?.isShared === false ? false : true },
  });
  return NextResponse.json(q);
}

export const GET = gated(handleGET);
export const POST = gated(handlePOST);
