import { prisma } from "@/lib/prisma";
import { getSession, isTotpRequired } from "@/lib/auth-guard";
import { encrypt } from "@/lib/crypto";
import { NextRequest, NextResponse } from "next/server";
import { generateSecret, generateURI, verifySync } from "otplib";
import * as QRCode from "qrcode";
import { gated } from "@/lib/write-gate";

// Card #319: setting up two-factor is what a setup-only session is for.
const SETUP = { allowPendingPasswordChange: true, allowPendingTotpSetup: true };

async function handleGET() {
  const { error, session } = await getSession(undefined, SETUP); // /account 2FA
  if (error) return error;

  const secret = generateSecret();
  const otpauth = generateURI({ label: session!.user!.email!, issuer: "YoSched", secret });
  const qrCode = await QRCode.toDataURL(otpauth);

  return NextResponse.json({ secret, qrCode });
}

async function handlePOST(req: NextRequest) {
  const { error, session } = await getSession(undefined, SETUP); // /account 2FA
  if (error) return error;

  const { secret, code } = await req.json();
  if (!secret || !code) {
    return NextResponse.json({ error: "Secret and code required" }, { status: 400 });
  }

  const result = verifySync({ token: code, secret });
  if (!result.valid) {
    return NextResponse.json({ error: "Invalid code. Try again." }, { status: 400 });
  }

  // Card #319: only a login that isn't enrolled yet (a second browser can't replace the key),
  // and every session of it ends, this one included: sign in again with the code.
  const { count } = await prisma.user.updateMany({
    where: { id: session!.user!.id, totpEnabled: false },
    data: { totpSecret: encrypt(secret), totpEnabled: true, sessionVersion: { increment: 1 } },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Two-factor sign-in is already set up for this login. Reload the page." }, { status: 409 });
  }

  return NextResponse.json({ enabled: true, signInAgain: true });
}

async function handleDELETE() {
  const { error, session } = await getSession(undefined, { allowPendingPasswordChange: true }); // /account 2FA
  if (error) return error;

  if (await isTotpRequired()) {
    return NextResponse.json({ error: "Two-factor sign-in is required for every login, so it can't be turned off." }, { status: 409 });
  }

  // Card #319: every session of the login ends (trusted devices included).
  await prisma.user.updateMany({
    where: { id: session!.user!.id },
    data: { totpSecret: null, totpEnabled: false, sessionVersion: { increment: 1 } },
  });

  return NextResponse.json({ disabled: true, signInAgain: true });
}

export const GET = gated(handleGET);
export const POST = gated(handlePOST);
export const DELETE = gated(handleDELETE);
