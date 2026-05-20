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
  desirabilityScore: number;
  undesirableShiftCount: number;
  desirableShiftCount: number;
  holidayWorkCount: number;
  totalWorkDays: number;
  totalLeaveDays: number;
  shiftCounts: Record<string, number>;
};

export type FairnessSummary = {
  metrics: FairnessMetrics[];
  averages: {
    desirabilityScore: number;
    holidayWorkCount: number;
  };
  trackedShiftCodes: string[];
  deviations: Map<string, FairnessDeviation>;
};

export type FairnessDeviation = {
  desirability: number;
  holidayWork: number;
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

  const trackedShiftIds = new Set(desirabilityWeights.map((dw) => dw.shiftTypeId));
  const shiftIdToCode = new Map<string, string>();
  for (const a of assignments) {
    shiftIdToCode.set(a.shiftType.id, a.shiftType.code);
  }
  const trackedShiftCodes = [...new Set(
    [...trackedShiftIds].map((id) => shiftIdToCode.get(id)).filter(Boolean) as string[]
  )].sort();

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
    let desirabilityScore = 0;
    let undesirableShiftCount = 0;
    let desirableShiftCount = 0;
    let holidayWorkCount = 0;
    let totalWorkDays = 0;
    let totalLeaveDays = 0;
    const shiftCounts: Record<string, number> = {};

    for (const a of pa) {
      const code = a.shiftType.code;
      const dateStr = toDateStr(a.date);
      const dow = getDow(a.date);
      const isHoliday = holidaySet.has(dateStr);

      if (code === "X") continue;

      if (a.shiftType.isLeave) {
        totalLeaveDays++;
        continue;
      }

      if (a.shiftType.countsTowardFte) totalWorkDays++;

      shiftCounts[code] = (shiftCounts[code] || 0) + 1;

      if (isHoliday && code !== "HOL") holidayWorkCount++;

      const dwKey = `${a.shiftType.id}:${dow}`;
      const weight = dwMap.get(dwKey) ?? 0;
      desirabilityScore += weight;
      if (weight < 0) undesirableShiftCount++;
      if (weight > 0) desirableShiftCount++;
    }

    metrics.push({
      providerId: p.id,
      initials: p.initials,
      desirabilityScore,
      undesirableShiftCount,
      desirableShiftCount,
      holidayWorkCount,
      totalWorkDays,
      totalLeaveDays,
      shiftCounts,
    });
  }

  const n = metrics.length || 1;
  const averages = {
    desirabilityScore: metrics.reduce((s, m) => s + m.desirabilityScore, 0) / n,
    holidayWorkCount: metrics.reduce((s, m) => s + m.holidayWorkCount, 0) / n,
  };

  const deviations = new Map<string, FairnessDeviation>();

  function stddev(values: number[]): number {
    if (values.length === 0) return 1;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance) || 1;
  }

  const desStd = stddev(metrics.map((m) => m.desirabilityScore));
  const holStd = stddev(metrics.map((m) => m.holidayWorkCount));

  for (const m of metrics) {
    // Negate desirability: a high desirability score is GOOD (low burden)
    const desirability = -(m.desirabilityScore - averages.desirabilityScore) / desStd;
    const holidayWork = (m.holidayWorkCount - averages.holidayWorkCount) / holStd;

    const overall = 0.75 * desirability + 0.25 * holidayWork;

    deviations.set(m.providerId, { desirability, holidayWork, overall });
  }

  return { metrics, averages, trackedShiftCodes, deviations };
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

export function fairnessLabel(burden: number): string {
  if (burden > 1.5) return "Low equity";
  if (burden > 0.75) return "Below avg equity";
  if (burden > 0.25) return "Slightly below";
  if (burden < -1.5) return "High equity";
  if (burden < -0.75) return "Above avg equity";
  if (burden < -0.25) return "Slightly above";
  return "Balanced";
}
