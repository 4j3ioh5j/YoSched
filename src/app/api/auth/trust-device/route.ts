import { auth } from "@/lib/auth";
import { setDeviceTrust } from "@/lib/device-trust";
import { NextResponse } from "next/server";

const TOTP_FRESHNESS_MS = 5 * 60 * 1000;

// Deliberately NOT gated on a pending password change: remembering this device is the last
// step of signing in (right after the TOTP code), not access to app data. It needs a TOTP
// verified in the last 5 minutes, and the person is then sent to /account to change it.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const verifiedAt = (session.user as { totpVerifiedAt?: number }).totpVerifiedAt;
  if (!verifiedAt || Date.now() - verifiedAt > TOTP_FRESHNESS_MS) {
    return NextResponse.json({ error: "Recent TOTP verification required" }, { status: 403 });
  }

  await setDeviceTrust(session.user.id);
  return NextResponse.json({ ok: true });
}
