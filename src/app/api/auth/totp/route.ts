import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-guard";
import { encrypt } from "@/lib/crypto";
import { NextRequest, NextResponse } from "next/server";
import { generateSecret, generateURI, verifySync } from "otplib";
import * as QRCode from "qrcode";

export async function GET() {
  const { error, session } = await requireAuth("viewer");
  if (error) return error;

  const secret = generateSecret();
  const otpauth = generateURI({ label: session!.user!.email!, issuer: "YoSched", secret });
  const qrCode = await QRCode.toDataURL(otpauth);

  return NextResponse.json({ secret, qrCode });
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireAuth("viewer");
  if (error) return error;

  const { secret, code } = await req.json();
  if (!secret || !code) {
    return NextResponse.json({ error: "Secret and code required" }, { status: 400 });
  }

  const result = verifySync({ token: code, secret });
  if (!result.valid) {
    return NextResponse.json({ error: "Invalid code. Try again." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session!.user!.id },
    data: { totpSecret: encrypt(secret), totpEnabled: true },
  });

  return NextResponse.json({ enabled: true });
}

export async function DELETE() {
  const { error, session } = await requireAuth("viewer");
  if (error) return error;

  await prisma.user.update({
    where: { id: session!.user!.id },
    data: { totpSecret: null, totpEnabled: false },
  });

  return NextResponse.json({ disabled: true });
}
