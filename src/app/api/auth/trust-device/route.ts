import { getSession } from "@/lib/auth-guard";
import { setDeviceTrust } from "@/lib/device-trust";
import { NextResponse } from "next/server";
import { gated } from "@/lib/write-gate";

const TOTP_FRESHNESS_MS = 5 * 60 * 1000;

// Deliberately NOT gated on a pending password change: remembering this device is the last
// step of signing in (right after the TOTP code), not access to app data. It needs a TOTP
// verified in the last 5 minutes, and the person is then sent to /account to change it.
// Card #319: through getSession, so a revoked session (older session version, or from before
// a restore) can't mint a cookie; only for a session that entered a code at sign-in; and the
// cookie names that session's version, so the next reset or re-enrol ends it.
async function handlePOST() {
  const { error, session } = await getSession(undefined, { allowPendingPasswordChange: true });
  if (error) return error;

  const user = session!.user as { id: string; secondFactor?: string; totpVerifiedAt?: number; sv?: number };
  const verifiedAt = user.totpVerifiedAt;
  if (user.secondFactor !== "totp" || !verifiedAt || Date.now() - verifiedAt > TOTP_FRESHNESS_MS) {
    return NextResponse.json({ error: "Recent TOTP verification required" }, { status: 403 });
  }

  await setDeviceTrust({ id: user.id, sessionVersion: user.sv ?? 0 });
  return NextResponse.json({ ok: true });
}

export const POST = gated(handlePOST);
