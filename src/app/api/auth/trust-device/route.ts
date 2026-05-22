import { auth } from "@/lib/auth";
import { setDeviceTrust } from "@/lib/device-trust";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  await setDeviceTrust(session.user.id);
  return NextResponse.json({ ok: true });
}
