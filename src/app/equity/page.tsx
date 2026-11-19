import { loadRawStatsData } from "@/lib/graph/load-raw";
import { getPayPeriods } from "@/lib/pay-periods-server";
import { DEFAULT_SPEC, decodeSpec } from "@/lib/graph/spec";
import { DEFAULT_DATE_FORMAT } from "@/lib/date-format";
import { EquityPage } from "./equity-page";
import { NavHeader } from "../nav-header";
import { getPageSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Equity({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  // Decode the shareable spec from ?g= on the server so the initial render is
  // already the requested view (no client mount-effect, no hydration mismatch).
  const { g } = await searchParams;
  const initialSpec = (g && decodeSpec(g)) || DEFAULT_SPEC;
  // Require schedule:view in addition to statistics:view: this page now ships the
  // raw per-date assignment list to the browser for client-side recompute, which
  // is the schedule itself. Do not drop schedule:view here without moving the
  // raw-data computation back to the server (see docs/statistics-revamp-plan.md).
  const session = await getPageSession(["statistics:view", "schedule:view"]);
  if (session.error) redirect("/");
  const canManageViews = session.permissions.includes("statistics:manage");
  const [{ raw, schedPrefs }, payPeriods] = await Promise.all([loadRawStatsData(), getPayPeriods()]);

  const equityThresholds = {
    low: schedPrefs?.equityThresholdLow ?? 0.25,
    med: schedPrefs?.equityThresholdMed ?? 0.75,
    high: schedPrefs?.equityThresholdHigh ?? 1.5,
  };

  const payPeriodRefs = payPeriods.map((p) => ({
    id: p.id,
    startDate: p.startDate.toISOString().split("T")[0],
    endDate: p.endDate.toISOString().split("T")[0],
  }));

  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />
      <EquityPage raw={raw} equityThresholds={equityThresholds} payPeriods={payPeriodRefs} initialSpec={initialSpec} dateFormat={schedPrefs?.dateFormat ?? DEFAULT_DATE_FORMAT} canManageViews={canManageViews} />
    </main>
  );
}
