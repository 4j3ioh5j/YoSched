import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { buildAutoScheduleInput } from "@/lib/build-auto-schedule-input";

// Serves the engine input bundle (same data the POST generator runs on) so Live
// mode can run client-side what-if re-solves without a round-trip per edit (#231).
// Unlike POST (which only returns the resulting schedule), this returns the RAW
// input — including per-staff scheduleRequests and availability rules. Those have
// their own visibility model, so this endpoint requires requests:view IN ADDITION
// to schedule:auto: you can only obtain the raw request data if you're already
// entitled to view requests. The client engine still gets the full request set it
// needs for a correct re-solve.
export async function GET(req: NextRequest) {
  const { error } = await getSession(["schedule:auto", "requests:view"]);
  if (error) return error;

  const startDate = req.nextUrl.searchParams.get("start");
  const endDate = req.nextUrl.searchParams.get("end");
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "start and end query params required" }, { status: 400 });
  }

  const input = await buildAutoScheduleInput(startDate, endDate);
  return NextResponse.json(input);
}
