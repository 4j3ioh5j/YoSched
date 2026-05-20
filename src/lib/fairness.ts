type Assignment = {
  providerId: string;
  date: Date | string;
  shiftType: {
    id: string;
    code: string;
    defaultHours: number;
    countsTowardFte: boolean;
    isLeave: boolean;
  };
};

type Provider = {
  id: string;
  initials: string;
  employmentType: string;
  ftePercentage: number;
  takesCall: boolean;
  takesLate: boolean;
  isActive: boolean;
};

type DesirabilityWeight = {
  shiftTypeId: string;
  dayOfWeek: number;
  weight: number;
};

type Holiday = {
  date: Date | string;
};

export type FairnessMetrics = {
  providerId: string;
  initials: string;

  weekendCallCount: number;
  weekdayOrcCount: number;
  weekdayOrlCount: number;
  holidayWorkCount: number;

  desirabilityScore: number;
  undesirableShiftCount: number;
  desirableShiftCount: number;

  totalWorkDays: number;
  totalLeaveDays: number;
};

export type FairnessSummary = {
  metrics: FairnessMetrics[];
  averages: {
    weekendCallCount: number;
    weekdayOrcCount: number;
    weekdayOrlCount: number;
    holidayWorkCount: number;
    desirabilityScore: number;
  };
  deviations: Map<string, FairnessDeviation>;
};

export type FairnessDeviation = {
  weekendCall: number;
  weekdayOrc: number;
  weekdayOrl: number;
  holidayWork: number;
  desirability: number;
  overall: number;
};

function toDateStr(d: Date | string): string {
  if (typeof d === "string") return d.split("T")[0];
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDow(d: Date | string): number {
  if (typeof d === "string") return new Date(d + "T12:00:00").getDay();
  return d.getDay();
}

export function computeFairness({
  assignments,
  providers,
  desirabilityWeights,
  holidays,
}: {
  assignments: Assignment[];
  providers: Provider[];
  desirabilityWeights: DesirabilityWeight[];
  holidays: Holiday[];
}): FairnessSummary {
  const holidaySet = new Set(holidays.map((h) => toDateStr(h.date)));

  const dwMap = new Map<string, number>();
  for (const dw of desirabilityWeights) {
    dwMap.set(`${dw.shiftTypeId}:${dw.dayOfWeek}`, dw.weight);
  }

  const callEligible = providers.filter(
    (p) => p.isActive && p.employmentType === "fte" && p.takesCall
  );
  const lateEligible = providers.filter(
    (p) => p.isActive && p.employmentType === "fte" && p.takesLate
  );
  const callIds = new Set(callEligible.map((p) => p.id));
  const lateIds = new Set(lateEligible.map((p) => p.id));

  const byProvider = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const arr = byProvider.get(a.providerId) || [];
    arr.push(a);
    byProvider.set(a.providerId, arr);
  }

  const metrics: FairnessMetrics[] = [];

  for (const p of providers) {
    if (!p.isActive || p.employmentType !== "fte") continue;

    const pa = byProvider.get(p.id) || [];
    let weekendCallCount = 0;
    let weekdayOrcCount = 0;
    let weekdayOrlCount = 0;
    let holidayWorkCount = 0;
    let desirabilityScore = 0;
    let undesirableShiftCount = 0;
    let desirableShiftCount = 0;
    let totalWorkDays = 0;
    let totalLeaveDays = 0;

    for (const a of pa) {
      const code = a.shiftType.code;
      const dateStr = toDateStr(a.date);
      const dow = getDow(a.date);
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = holidaySet.has(dateStr);

      if (code === "X") continue;

      if (a.shiftType.isLeave) {
        totalLeaveDays++;
        continue;
      }

      if (a.shiftType.countsTowardFte) totalWorkDays++;

      if (code === "CALL" && isWeekend) weekendCallCount++;
      if (code === "ORC" && !isWeekend) weekdayOrcCount++;
      if (code === "ORL" && !isWeekend) weekdayOrlCount++;
      if (isHoliday && code !== "HOL" && code !== "X") holidayWorkCount++;

      const dwKey = `${a.shiftType.id}:${dow}`;
      const weight = dwMap.get(dwKey) ?? 0;
      desirabilityScore += weight;
      if (weight < 0) undesirableShiftCount++;
      if (weight > 0) desirableShiftCount++;
    }

    metrics.push({
      providerId: p.id,
      initials: p.initials,
      weekendCallCount,
      weekdayOrcCount,
      weekdayOrlCount,
      holidayWorkCount,
      desirabilityScore,
      undesirableShiftCount,
      desirableShiftCount,
      totalWorkDays,
      totalLeaveDays,
    });
  }

  const n = metrics.length || 1;
  const averages = {
    weekendCallCount: metrics.reduce((s, m) => s + m.weekendCallCount, 0) / n,
    weekdayOrcCount: metrics.reduce((s, m) => s + m.weekdayOrcCount, 0) / n,
    weekdayOrlCount: metrics.reduce((s, m) => s + m.weekdayOrlCount, 0) / n,
    holidayWorkCount: metrics.reduce((s, m) => s + m.holidayWorkCount, 0) / n,
    desirabilityScore: metrics.reduce((s, m) => s + m.desirabilityScore, 0) / n,
  };

  const deviations = new Map<string, FairnessDeviation>();

  function stddev(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length || 1);
    return Math.sqrt(variance) || 1;
  }

  const callStd = stddev(metrics.filter((m) => callIds.has(m.providerId)).map((m) => m.weekendCallCount));
  const orcStd = stddev(metrics.filter((m) => callIds.has(m.providerId)).map((m) => m.weekdayOrcCount));
  const orlStd = stddev(metrics.filter((m) => lateIds.has(m.providerId)).map((m) => m.weekdayOrlCount));
  const holStd = stddev(metrics.map((m) => m.holidayWorkCount));
  const desStd = stddev(metrics.map((m) => m.desirabilityScore));

  for (const m of metrics) {
    const weekendCall = callIds.has(m.providerId)
      ? (m.weekendCallCount - averages.weekendCallCount) / callStd
      : 0;
    const weekdayOrc = callIds.has(m.providerId)
      ? (m.weekdayOrcCount - averages.weekdayOrcCount) / orcStd
      : 0;
    const weekdayOrl = lateIds.has(m.providerId)
      ? (m.weekdayOrlCount - averages.weekdayOrlCount) / orlStd
      : 0;
    const holidayWork = (m.holidayWorkCount - averages.holidayWorkCount) / holStd;
    const desirability = -(m.desirabilityScore - averages.desirabilityScore) / desStd;

    const overall =
      0.30 * weekendCall +
      0.25 * weekdayOrc +
      0.20 * weekdayOrl +
      0.15 * holidayWork +
      0.10 * desirability;

    deviations.set(m.providerId, {
      weekendCall,
      weekdayOrc,
      weekdayOrl,
      holidayWork,
      desirability,
      overall,
    });
  }

  return { metrics, averages, deviations };
}

export function fairnessColor(deviation: number): string {
  if (deviation > 1.5) return "#ef4444";
  if (deviation > 0.75) return "#f97316";
  if (deviation > 0.25) return "#eab308";
  if (deviation < -1.5) return "#22c55e";
  if (deviation < -0.75) return "#3b82f6";
  if (deviation < -0.25) return "#6366f1";
  return "#6b7280";
}

export function fairnessLabel(deviation: number): string {
  if (deviation > 1.5) return "heavy";
  if (deviation > 0.75) return "above avg";
  if (deviation > 0.25) return "slightly above";
  if (deviation < -1.5) return "light";
  if (deviation < -0.75) return "below avg";
  if (deviation < -0.25) return "slightly below";
  return "balanced";
}
