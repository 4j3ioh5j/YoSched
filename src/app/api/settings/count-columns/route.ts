import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;

  const columns = await prisma.countColumn.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(columns);
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;

  const { columns } = await req.json();
  if (!Array.isArray(columns)) {
    return NextResponse.json({ error: "columns must be an array" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.countColumn.deleteMany();
    if (columns.length > 0) {
      await tx.countColumn.createMany({
        data: columns.map((col: { label: string; shiftCodes: string[] }, i: number) => ({
          label: col.label,
          shiftCodes: col.shiftCodes,
          sortOrder: i,
        })),
      });
    }
  });

  const result = await prisma.countColumn.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(result);
}
