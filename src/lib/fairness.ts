type Assignment = {
  providerId: string;
  date: Date | string;
  shiftType: {
    id: string;
    code: string;
    defaultHours: number;
    countsTowardFte: boolean;
    isLeave: boolean;
    isOffShift?: boolean;
  };
};

type Provider = {
  id: string;
  initials: string;
  ftePercentage: number;
  isActive: boolean;
  isAutoScheduled: boolean;
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
  ftePercentage: number;
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
    perShift: Record<string, number>;
  };
  trackedShiftCodes: string[];
  equityShiftCodes: string[];
  deviations: Map<string, FairnessDeviation>;
};

export type FairnessDeviation = {
  desirability: number;
  holidayWork: number;
  perShift: Record<string, number>;
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
  equityShiftCodes = [],
  fairnessDesirabilityWeight = 0.75,
  fairnessHolidayWeight = 0.25,
}: {
  assignments: Assignment[];
  providers: Provider[];
  desirabilityWeights: DesirabilityWeight[];
  holidays: Holiday[];
  equityShiftCodes?: string[];
  fairnessDesirabilityWeight?: number;
  fairnessHolidayWeight?: number;
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

  const providerFte = new Map<string, number>();
  const metrics: FairnessMetrics[] = [];

  for (const p of providers) {
    if (!p.isActive || !p.isAutoScheduled) continue;
    providerFte.set(p.id, p.ftePercentage || 1);

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

      if (a.shiftType.isOffShift) continue;

      if (a.shiftType.isLeave) {
        totalLeaveDays++;
        continue;
      }

      if (a.shiftType.countsTowardFte) totalWorkDays++;

      shiftCounts[code] = (shiftCounts[code] || 0) + 1;

      if (isHoliday && a.shiftType.countsTowardFte) holidayWorkCount++;

      const dwKey = `${a.shiftType.id}:${dow}`;
      const weight = dwMap.get(dwKey) ?? 0;
      desirabilityScore += weight;
      if (weight < 0) undesirableShiftCount++;
      if (weight > 0) desirableShiftCount++;
    }

    metrics.push({
      providerId: p.id,
      initials: p.initials,
      ftePercentage: p.ftePercentage,
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

  // FTE-normalized values for computing averages and deviations
  function fteNorm(providerId: string, value: number): number {
    const fte = providerFte.get(providerId) || 1;
    return value / fte;
  }

  const avgDesirability = metrics.reduce((s, m) => s + fteNorm(m.providerId, m.desirabilityScore), 0) / n;
  const avgHoliday = metrics.reduce((s, m) => s + fteNorm(m.providerId, m.holidayWorkCount), 0) / n;

  const perShiftAvg: Record<string, number> = {};
  for (const code of equityShiftCodes) {
    perShiftAvg[code] = metrics.reduce((s, m) => s + fteNorm(m.providerId, m.shiftCounts[code] || 0), 0) / n;
  }

  const averages = {
    desirabilityScore: avgDesirability,
    holidayWorkCount: avgHoliday,
    perShift: perShiftAvg,
  };

  function stddev(values: number[]): number {
    if (values.length === 0) return 1;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance) || 1;
  }

  const desValues = metrics.map((m) => fteNorm(m.providerId, m.desirabilityScore));
  const holValues = metrics.map((m) => fteNorm(m.providerId, m.holidayWorkCount));
  const desStd = stddev(desValues);
  const holStd = stddev(holValues);

  const shiftStds: Record<string, number> = {};
  for (const code of equityShiftCodes) {
    shiftStds[code] = stddev(metrics.map((m) => fteNorm(m.providerId, m.shiftCounts[code] || 0)));
  }

  // Compute weights: distribute across all factors
  // desirability + holidays + N shift codes = totalFactors
  const totalFactors = 2 + equityShiftCodes.length;
  const wDes = totalFactors > 0 ? 1 / totalFactors : fairnessDesirabilityWeight;
  const wHol = totalFactors > 0 ? 1 / totalFactors : fairnessHolidayWeight;
  const wShift = totalFactors > 2 ? 1 / totalFactors : 0;

  const deviations = new Map<string, FairnessDeviation>();

  for (const m of metrics) {
    const normDes = fteNorm(m.providerId, m.desirabilityScore);
    const normHol = fteNorm(m.providerId, m.holidayWorkCount);

    // Negate desirability: high score = good shifts = low burden
    const desirability = -(normDes - avgDesirability) / desStd;
    const holidayWork = (normHol - avgHoliday) / holStd;

    const perShift: Record<string, number> = {};
    let shiftSum = 0;
    for (const code of equityShiftCodes) {
      const normCount = fteNorm(m.providerId, m.shiftCounts[code] || 0);
      const dev = (normCount - perShiftAvg[code]) / shiftStds[code];
      perShift[code] = dev;
      shiftSum += wShift * dev;
    }

    const overall = wDes * desirability + wHol * holidayWork + shiftSum;

    deviations.set(m.providerId, { desirability, holidayWork, perShift, overall });
  }

  return { metrics, averages, trackedShiftCodes, equityShiftCodes, deviations };
}

export type EquityThresholds = {
  low: number;
  med: number;
  high: number;
};

const DEFAULT_THRESHOLDS: EquityThresholds = { low: 0.25, med: 0.75, high: 1.5 };

export function fairnessColor(deviation: number, t: EquityThresholds = DEFAULT_THRESHOLDS): string {
  if (deviation > t.high) return "#ef4444";
  if (deviation > t.med) return "#f97316";
  if (deviation > t.low) return "#eab308";
  if (deviation < -t.high) return "#22c55e";
  if (deviation < -t.med) return "#3b82f6";
  if (deviation < -t.low) return "#6366f1";
  return "#6b7280";
}

export function fairnessLabel(burden: number, t: EquityThresholds = DEFAULT_THRESHOLDS): string {
  if (burden > t.high) return "Overworked";
  if (burden > t.med) return "Heavy";
  if (burden > t.low) return "Slightly Heavy";
  if (burden < -t.high) return "Light";
  if (burden < -t.med) return "Below avg";
  if (burden < -t.low) return "Slightly Light";
  return "Balanced";
}
