import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";

// SMTP settings. The password is WRITE-ONLY: GET never returns it (only whether
// one is set); PUT updates it only when a non-empty value is supplied.

async function loadRow() {
  return (
    (await prisma.emailSettings.findUnique({ where: { id: "default" } })) ??
    (await prisma.emailSettings.create({ data: { id: "default" } }))
  );
}

function publicView(row: Awaited<ReturnType<typeof loadRow>>) {
  return {
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    fromAddress: row.fromAddress,
    passwordConfigured: !!row.password, // never the value itself
  };
}

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  return NextResponse.json(publicView(await loadRow()));
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;

  const body = await req.json();
  const { enabled, host, port, secure, username, password, fromAddress } = body;

  const data: Record<string, unknown> = {};
  if (typeof enabled === "boolean") data.enabled = enabled;
  if (typeof host === "string") data.host = host.trim() || null;
  if (typeof port === "number" && port > 0 && port <= 65535) data.port = Math.floor(port);
  if (typeof secure === "boolean") data.secure = secure;
  if (typeof username === "string") data.username = username.trim() || null;
  if (typeof fromAddress === "string") data.fromAddress = fromAddress.trim() || null;
  // Write-only: only touch the password when a non-empty value is supplied.
  if (typeof password === "string" && password.length > 0) data.password = password;

  const row = await prisma.emailSettings.upsert({
    where: { id: "default" },
    update: data,
    create: { id: "default", ...data },
  });
  return NextResponse.json(publicView(row));
}
