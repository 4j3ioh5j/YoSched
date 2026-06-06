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
  eligibleShiftTypeIds?: string[];
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
  displayDeviations: Map<string, FairnessDeviation>;
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

export type EquityFactor = {
  factorType: string;
  shiftCode: string | null;
  weight: number;
  enabled: boolean;
};

export function computeFairness({
  assignments,
  providers,
  desirabilityWeights,
  holidays,
  equityFactors = [],
}: {
  assignments: Assignment[];
  providers: Provider[];
  desirabilityWeights: DesirabilityWeight[];
  holidays: Holiday[];
  equityFactors?: EquityFactor[];
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

  // Parse equity factors from configuration
  const activeFactors = equityFactors.filter((f) => f.enabled);
  const equityShiftCodes = activeFactors
    .filter((f) => f.factorType === "shift" && f.shiftCode)
    .map((f) => f.shiftCode!);
  const hasDesirability = activeFactors.some((f) => f.factorType === "desirability");
  const hasHoliday = activeFactors.some((f) => f.factorType === "holiday");

  // Normalize weights to sum to 1
  const totalWeight = activeFactors.reduce((s, f) => s + f.weight, 0) || 1;
  const factorWeights = new Map<string, number>();
  for (const f of activeFactors) {
    const key = f.factorType === "shift" ? `shift:${f.shiftCode}` : f.factorType;
    factorWeights.set(key, f.weight / totalWeight);
  }

  // FTE-normalized values for computing averages and deviations
  function fteNorm(providerId: string, value: number): number {
    const fte = providerFte.get(providerId) || 1;
    return value / fte;
  }

  // Build per-provider eligible shift type sets
  const providerEligible = new Map<string, Set<string> | null>();
  for (const p of providers) {
    if (!p.isActive || !p.isAutoScheduled) continue;
    providerEligible.set(p.id, p.eligibleShiftTypeIds ? new Set(p.eligibleShiftTypeIds) : null);
  }

  // Opportunity-adjusted desirability: compute each provider's average using
  // only desirability weights for shift types they're eligible for. This way
  // a provider who can't work desirable shifts isn't penalized for missing them.
  const providerExpectedDes = new Map<string, number>();
  for (const m of metrics) {
    const eligible = providerEligible.get(m.providerId);
    const relevantWeights = eligible
      ? desirabilityWeights.filter((dw) => eligible.has(dw.shiftTypeId))
      : desirabilityWeights;
    const avgWeight = relevantWeights.length > 0
      ? relevantWeights.reduce((s, dw) => s + dw.weight, 0) / relevantWeights.length
      : 0;
    providerExpectedDes.set(m.providerId, avgWeight * fteNorm(m.providerId, m.totalWorkDays));
  }

  const avgHoliday = metrics.reduce((s, m) => s + fteNorm(m.providerId, m.holidayWorkCount), 0) / n;

  const perShiftAvg: Record<string, number> = {};
  for (const code of equityShiftCodes) {
    perShiftAvg[code] = metrics.reduce((s, m) => s + fteNorm(m.providerId, m.shiftCounts[code] || 0), 0) / n;
  }

  // Global avg desirability still used for display
  const avgDesirability = metrics.reduce((s, m) => s + fteNorm(m.providerId, m.desirabilityScore), 0) / n;

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

  // Desirability deviations are relative to each provider's opportunity-adjusted
  // expected score, so stddev is computed from those residuals
  const desResiduals = metrics.map((m) => {
    const normDes = fteNorm(m.providerId, m.desirabilityScore);
    const expected = providerExpectedDes.get(m.providerId) ?? 0;
    return normDes - expected;
  });
  const desStd = stddev(desResiduals);
  const desMeanResidual = desResiduals.reduce((a, b) => a + b, 0) / (desResiduals.length || 1);
  const holStd = stddev(metrics.map((m) => fteNorm(m.providerId, m.holidayWorkCount)));

  const shiftStds: Record<string, number> = {};
  for (const code of equityShiftCodes) {
    shiftStds[code] = stddev(metrics.map((m) => fteNorm(m.providerId, m.shiftCounts[code] || 0)));
  }

  const deviations = new Map<string, FairnessDeviation>();

  for (const m of metrics) {
    const normDes = fteNorm(m.providerId, m.desirabilityScore);
    const normHol = fteNorm(m.providerId, m.holidayWorkCount);
    const expectedDes = providerExpectedDes.get(m.providerId) ?? 0;

    // Negate: scoring above your opportunity-adjusted expectation = low burden
    const desirability = -((normDes - expectedDes) - desMeanResidual) / desStd;
    const holidayWork = (normHol - avgHoliday) / holStd;

    const perShift: Record<string, number> = {};
    let overall = 0;

    if (hasDesirability) {
      overall += (factorWeights.get("desirability") ?? 0) * desirability;
    }
    if (hasHoliday) {
      overall += (factorWeights.get("holiday") ?? 0) * holidayWork;
    }
    for (const code of equityShiftCodes) {
      const normCount = fteNorm(m.providerId, m.shiftCounts[code] || 0);
      const dev = (normCount - perShiftAvg[code]) / shiftStds[code];
      perShift[code] = dev;
      overall += (factorWeights.get(`shift:${code}`) ?? 0) * dev;
    }

    deviations.set(m.providerId, { desirability, holidayWork, perShift, overall });
  }

  // Plain FTE-normalized z-scores (no opportunity adjustment) for display
  const plainDesStd = stddev(metrics.map((m) => fteNorm(m.providerId, m.desirabilityScore)));
  const displayDeviations = new Map<string, FairnessDeviation>();

  for (const m of metrics) {
    const normDes = fteNorm(m.providerId, m.desirabilityScore);
    const normHol = fteNorm(m.providerId, m.holidayWorkCount);

    const desirability = -(normDes - avgDesirability) / plainDesStd;
    const holidayWork = (normHol - avgHoliday) / holStd;

    const perShift: Record<string, number> = {};
    let overall = 0;

    if (hasDesirability) overall += (factorWeights.get("desirability") ?? 0) * desirability;
    if (hasHoliday) overall += (factorWeights.get("holiday") ?? 0) * holidayWork;
    for (const code of equityShiftCodes) {
      const normCount = fteNorm(m.providerId, m.shiftCounts[code] || 0);
      const dev = (normCount - perShiftAvg[code]) / shiftStds[code];
      perShift[code] = dev;
      overall += (factorWeights.get(`shift:${code}`) ?? 0) * dev;
    }

    displayDeviations.set(m.providerId, { desirability, holidayWork, perShift, overall });
  }

  return { metrics, averages, trackedShiftCodes, equityShiftCodes, deviations, displayDeviations };
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

/**
 * Sequential "temperature" ramp for the equity heatmap: coldest (well below the
 * department average) → hottest (well above). Unlike `fairnessColor`'s diverging
 * palette, this is a single low→high gradient so the grid reads like a heat map.
 *   cyan → pale green → yellow → orange → red
 * Cut points are symmetric about 0 at ±low and ±high, giving a neutral yellow
 * band around the average. Positive deviation = more burden = hotter.
 */
export function heatmapTempColor(deviation: number, t: EquityThresholds = DEFAULT_THRESHOLDS): string {
  if (deviation > t.high) return "#ef4444"; // red — hottest
  if (deviation > t.low) return "#f97316"; // orange
  if (deviation >= -t.low) return "#eab308"; // yellow — neutral
  if (deviation >= -t.high) return "#86efac"; // pale green
  return "#06b6d4"; // cyan — coldest
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
