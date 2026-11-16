import { getSession } from "@/lib/auth-guard";
import { STALE_CLIENT } from "@/lib/stale-client";
import { NextResponse } from "next/server";

// Card #309: columns now save with their Include / Exclude rule lines through
// /api/settings/print-aggregate-columns/criteria. This was the save path of the Settings screen
// before rule lines. A tab still running that screen would save the old single rule, which this
// server no longer prints by once a column has lines, and it cannot keep lines it does not know.
// So it is refused with the "reload the page" answer, and that tab's save fails visibly
// instead of quietly losing rules.
export async function PUT() {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  return NextResponse.json(STALE_CLIENT, { status: 409 });
}
