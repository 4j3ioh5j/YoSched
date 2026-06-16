// Unified recurrence model — the "WHEN" axis: which occurrences a rule lands on.
//
// This is the shared representation behind availability rules, shift-eligibility
// rules, and (later) standing commitments. It supersedes the scattered
// `dayOfWeek + pattern(every|pp_week_1|pp_week_2|every_n) + cycleLength +
// cycleOffset` fields. Slice 2 ships the pure model + evaluator + legacy bridge
// with exhaustive tests; wiring into the scheduler/UI lands in later slices.
//
// Two orthogonal axes exist overall — this file is the WHEN axis. The HOW-OFTEN
// axis (min/max/exactly per N windows) lives in shift-eligibility.ts
// (getWindowBounds / windowCount).

// Pay-period helpers live here (the lowest-level recurrence module) rather than
// in availability.ts, so availability.ts can delegate to matchesWhen without a
// circular import. availability.ts re-exports these for existing callers.
export type PayPeriodRange = { startDate: string; endDate: string };

export function ppWeekForDate(dateStr: string, payPeriods: PayPeriodRange[]): 1 | 2 | null {
  for (const pp of payPeriods) {
    if (dateStr >= pp.startDate && dateStr <= pp.endDate) {
      const start = new Date(pp.startDate + "T12:00:00");
      const d = new Date(dateStr + "T12:00:00");
      const dayIndex = Math.round((d.getTime() - start.getTime()) / 86400000);
      return dayIndex < 7 ? 1 : 2;
    }
  }
  return null;
}

export function ppIndexForDate(dateStr: string, payPeriods: PayPeriodRange[]): number {
  for (let i = 0; i < payPeriods.length; i++) {
    if (dateStr >= payPeriods[i].startDate && dateStr <= payPeriods[i].endDate) {
      return i;
    }
  }
  return -1;
}

export type OccurrenceKind =
  | "every" // every occurrence of the chosen weekday(s)
  | "ppWeek" // only week 1 or week 2 of the pay period
  | "ordinalMonth" // the Nth occurrence of the weekday within the calendar month (-1 = last)
  | "ordinalPayPeriod" // the Nth occurrence of the weekday within the pay period (-1 = last)
  | "cycle"; // every Nth week-slot or pay-period, with an offset (parity / "every other")

export type WhenPattern = {
  // 0=Sun..6=Sat. [] = any day (the occurrence qualifier still applies).
  daysOfWeek: number[];
  kind: OccurrenceKind;

  // kind="ppWeek"
  ppWeek?: 1 | 2 | null;

  // kind="ordinalMonth" | "ordinalPayPeriod". Values 1..N pick that occurrence;
  // -1 means "the last occurrence of this weekday" in the month/pay period.
  // Multi-select drives "1st & 3rd" etc.
  ords?: number[] | null;

  // kind="cycle"
  cycleUnit?: "week" | "payPeriod" | null;
  cycleN?: number | null; // >= 1
  cycleOffset?: number | null; // 0 .. cycleN-1
};

function dowOf(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

// True when a pattern is the trivial "every occurrence of one specific weekday"
// — i.e. semantically identical to a legacy `pattern="every"` single-day rule.
// This is what the staff "Working days" quick-toggle manages; anything richer
// (multi-day, ordinal, pp-week, cycle) is an advanced rule edited in the picker.
// Routed through ruleToWhen so legacy (whenKind=null) and explicit rows agree.
export function isPlainWeekdayWhen(w: WhenPattern): boolean {
  return w.kind === "every" && (w.daysOfWeek?.length ?? 0) === 1;
}

// Nth occurrence of this date's own weekday within its calendar month (1-indexed).
// e.g. the 3rd Tuesday returns 3. Independent of any daysOfWeek filter.
export function monthOrdinalForDate(dateStr: string): number {
  const day = Number(dateStr.split("-")[2]);
  return Math.floor((day - 1) / 7) + 1;
}

// True when this date is the LAST occurrence of its weekday in the month
// (i.e. there is no same-weekday date 7 days later in the same month).
export function isLastWeekdayOccurrenceInMonth(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return d + 7 > daysInMonth;
}

// Day offset + length of the pay period containing dateStr (null if none).
function ppDayInfo(
  dateStr: string,
  payPeriods: PayPeriodRange[],
): { dayIndex: number; lengthDays: number } | null {
  for (const pp of payPeriods) {
    if (dateStr >= pp.startDate && dateStr <= pp.endDate) {
      const start = new Date(pp.startDate + "T12:00:00");
      const end = new Date(pp.endDate + "T12:00:00");
      const d = new Date(dateStr + "T12:00:00");
      const dayIndex = Math.round((d.getTime() - start.getTime()) / 86400000);
      const lengthDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      return { dayIndex, lengthDays };
    }
  }
  return null;
}

// Nth occurrence of this date's weekday within its pay period (1-indexed), or
// null if the date is in no pay period. For the standard 14-day PP this is 1 or 2.
export function ppOrdinalForDate(dateStr: string, payPeriods: PayPeriodRange[]): number | null {
  const info = ppDayInfo(dateStr, payPeriods);
  return info ? Math.floor(info.dayIndex / 7) + 1 : null;
}

// True when this date is the LAST occurrence of its weekday in its pay period.
export function isLastWeekdayOccurrenceInPP(dateStr: string, payPeriods: PayPeriodRange[]): boolean {
  const info = ppDayInfo(dateStr, payPeriods);
  return info ? info.dayIndex + 7 >= info.lengthDays : false;
}

// Does `dateStr` match the WHEN pattern? Pure; depends only on the date and the
// pay-period grid. The weekday gate is applied here (unlike legacy matchesPattern,
// where callers pre-filter by dayOfWeek).
export function matchesWhen(
  p: WhenPattern,
  dateStr: string,
  payPeriods: PayPeriodRange[],
): boolean {
  // 1. Weekday gate ([] = any day).
  if (p.daysOfWeek && p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(dowOf(dateStr))) {
    return false;
  }

  // 2. Occurrence qualifier.
  switch (p.kind) {
    case "every":
      return true;

    case "ppWeek":
      return ppWeekForDate(dateStr, payPeriods) === p.ppWeek;

    case "ordinalMonth": {
      const ords = p.ords ?? [];
      if (ords.length === 0) return true;
      if (ords.includes(monthOrdinalForDate(dateStr))) return true;
      return ords.includes(-1) && isLastWeekdayOccurrenceInMonth(dateStr);
    }

    case "ordinalPayPeriod": {
      const ords = p.ords ?? [];
      if (ords.length === 0) return true;
      const ord = ppOrdinalForDate(dateStr, payPeriods);
      if (ord === null) return false; // outside known PPs — a PP-anchored rule can't apply
      if (ords.includes(ord)) return true;
      return ords.includes(-1) && isLastWeekdayOccurrenceInPP(dateStr, payPeriods);
    }

    case "cycle": {
      const n = Math.max(1, Math.floor(p.cycleN ?? 1));
      const offset = p.cycleOffset ?? 0;
      const ppIdx = ppIndexForDate(dateStr, payPeriods);
      if (ppIdx < 0) {
        // "payPeriod" is PP-anchored → can't apply outside known PPs. "week" keeps
        // the legacy every_n behavior (ppIdx<0 → match) so the slice-3 migration of
        // every_n rules is byte-identical even for out-of-PP dates.
        return p.cycleUnit !== "payPeriod";
      }
      // "week" = the across-PP week-slot index used by legacy every_n; "payPeriod"
      // = the pay-period index (enables every-other-PP parity).
      const idx =
        p.cycleUnit === "payPeriod"
          ? ppIdx
          : ppIdx * 2 + (ppWeekForDate(dateStr, payPeriods) === 2 ? 1 : 0);
      return idx % n === offset;
    }

    default:
      // Unknown/corrupt explicit kind → fail closed (don't silently broaden a
      // rule). All valid OccurrenceKind values are handled above; ruleToWhen's
      // legacy fallback only ever produces every/ppWeek/cycle.
      return false;
  }
}

// Bridge legacy `dayOfWeek + pattern + cycleLength + cycleOffset` to the new
// model. Used by Slice 3's migration backfill and by the wiring layer to read
// old rows. Equivalence (proven in tests): for any legacy rule R and date D,
//   matchesWhen(legacyPatternToWhen(R), D) === (dow(D) === R.dayOfWeek && matchesPattern(R, D))
export function legacyPatternToWhen(rule: {
  dayOfWeek: number;
  pattern: string;
  cycleLength?: number | null;
  cycleOffset?: number | null;
}): WhenPattern {
  const daysOfWeek = [rule.dayOfWeek];
  switch (rule.pattern) {
    case "pp_week_1":
      return { daysOfWeek, kind: "ppWeek", ppWeek: 1 };
    case "pp_week_2":
      return { daysOfWeek, kind: "ppWeek", ppWeek: 2 };
    case "every_n":
      return {
        daysOfWeek,
        kind: "cycle",
        cycleUnit: "week",
        cycleN: rule.cycleLength ?? 2,
        cycleOffset: rule.cycleOffset ?? 0,
      };
    case "every":
    default:
      return { daysOfWeek, kind: "every" };
  }
}

// A rule row carrying either the new normalized WHEN columns or the legacy ones.
// During the dual-column transition both may be present; `whenKind` is the sole
// discriminator (nullable, no default) — null means "this row predates / was not
// written by a WHEN-aware path", so we fall back to the legacy columns.
export type RecurrenceRuleRow = {
  dayOfWeek: number;
  pattern: string;
  cycleLength?: number | null;
  cycleOffset?: number | null;
  whenKind?: string | null;
  whenDays?: number[] | null;
  whenPpWeek?: number | null;
  whenOrds?: number[] | null;
  whenCycleUnit?: string | null;
  whenCycleN?: number | null;
  whenCycleOffset?: number | null;
};

// Map the explicit new WHEN columns to a WhenPattern. Only called when
// whenKind != null. Malformed explicit rows are deterministic (and tested):
// kind="ppWeek" with null whenPpWeek matches nothing (ppWeek never equals null);
// kind="cycle" with null whenCycleN falls to n=1 in matchesWhen, i.e. every
// occurrence. Backfill (COALESCE) and the picker guarantee these don't occur.
export function buildWhenFromColumns(rule: RecurrenceRuleRow): WhenPattern {
  return {
    daysOfWeek: rule.whenDays ?? [],
    kind: rule.whenKind as OccurrenceKind,
    ppWeek: (rule.whenPpWeek ?? undefined) as 1 | 2 | undefined,
    ords: rule.whenOrds ?? [],
    cycleUnit: (rule.whenCycleUnit ?? undefined) as "week" | "payPeriod" | undefined,
    cycleN: rule.whenCycleN ?? undefined,
    cycleOffset: rule.whenCycleOffset ?? undefined,
  };
}

// The single entry point readers use: prefer the explicit WHEN columns, else the
// legacy bridge. Keeps the scheduler correct across the dual-column transition.
export function ruleToWhen(rule: RecurrenceRuleRow): WhenPattern {
  return rule.whenKind != null ? buildWhenFromColumns(rule) : legacyPatternToWhen(rule);
}

// The persisted shape of a WhenPattern — the new normalized DB columns. Inverse
// of buildWhenFromColumns. Used by write paths to derive/store the WHEN columns.
export type WhenColumns = {
  whenKind: string;
  whenDays: number[];
  whenPpWeek: number | null;
  whenOrds: number[];
  whenCycleUnit: string | null;
  whenCycleN: number | null;
  whenCycleOffset: number | null;
};

export function whenToColumns(w: WhenPattern): WhenColumns {
  return {
    whenKind: w.kind,
    whenDays: w.daysOfWeek ?? [],
    whenPpWeek: w.ppWeek ?? null,
    whenOrds: w.ords ?? [],
    whenCycleUnit: w.cycleUnit ?? null,
    whenCycleN: w.cycleN ?? null,
    whenCycleOffset: w.cycleOffset ?? null,
  };
}

// ── Human-readable + legacy back-projection (slice 4 picker) ─────────────────

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// "1st", "2nd", "3rd", "4th", "5th", and -1 → "last".
export function ordinalLabel(n: number): string {
  if (n === -1) return "last";
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

// "Mon", "Mon & Wed", "Mon, Wed & Fri".
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}`;
}

function weekdayPhrase(days: number[] | undefined): string {
  if (!days || days.length === 0) return "day";
  return joinList([...days].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]));
}

// A compact natural-language summary of a WHEN pattern, for the rule list / chips.
export function describeWhen(w: WhenPattern): string {
  const days = weekdayPhrase(w.daysOfWeek);
  switch (w.kind) {
    case "every":
      return `Every ${days}`;
    case "ppWeek":
      return w.ppWeek === 2 || w.ppWeek === 1
        ? `${days} — pay-period week ${w.ppWeek}`
        : `Every ${days}`;
    case "ordinalMonth": {
      const ords = w.ords ?? [];
      if (ords.length === 0) return `Every ${days}`;
      return `${joinList(ords.map(ordinalLabel))} ${days} of each month`;
    }
    case "ordinalPayPeriod": {
      const ords = w.ords ?? [];
      if (ords.length === 0) return `Every ${days}`;
      return `${joinList(ords.map(ordinalLabel))} ${days} of each pay period`;
    }
    case "cycle": {
      const n = Math.max(1, Math.floor(w.cycleN ?? 1));
      const unit = w.cycleUnit === "payPeriod" ? "pay period" : "week";
      const cadence = n === 1 ? "Every" : n === 2 ? "Every other" : `Every ${ordinalLabel(n)}`;
      const off = w.cycleOffset ?? 0;
      const offNote = n > 1 && off > 0 ? ` (offset ${off})` : "";
      return `${cadence} ${unit}${offNote}: ${days}`;
    }
    default:
      return `Every ${days}`;
  }
}

// Inert back-projection to the legacy NOT-NULL columns. Kept sensible so old
// readers / legacy summaries don't choke, but ignored by WHEN-aware readers
// (ruleToWhen prefers the explicit when* columns once whenKind is set). Patterns
// the legacy model can't express (ordinals, multi-day, every-other-pay-period)
// degrade to "every" — lossy on purpose; the when* columns hold the real shape.
export type LegacyColumns = {
  dayOfWeek: number;
  pattern: string;
  cycleLength: number | null;
  cycleOffset: number | null;
};

export function whenToLegacy(w: WhenPattern): LegacyColumns {
  const dayOfWeek = w.daysOfWeek?.[0] ?? 1;
  const plain: LegacyColumns = { dayOfWeek, pattern: "every", cycleLength: null, cycleOffset: null };
  switch (w.kind) {
    case "ppWeek":
      if (w.ppWeek === 1) return { ...plain, pattern: "pp_week_1" };
      if (w.ppWeek === 2) return { ...plain, pattern: "pp_week_2" };
      return plain;
    case "cycle":
      // Only the "week" cycle maps to legacy every_n; pay-period cycle is inexpressible.
      if (w.cycleUnit === "week") {
        return {
          dayOfWeek,
          pattern: "every_n",
          cycleLength: Math.max(1, Math.floor(w.cycleN ?? 2)),
          cycleOffset: w.cycleOffset ?? 0,
        };
      }
      return plain;
    default:
      // every, ordinalMonth, ordinalPayPeriod → legacy "every".
      return plain;
  }
}

// ── StandingCommitment WHEN bridge (slice 6) ─────────────────────────────────
// StandingCommitment's legacy columns are `dayOfWeek` (nullable) + `frequency`
// (weekly|biweekly|monthly), NOT the pattern/cycle* shape availability rules use,
// so it needs its own bridge (whenToLegacy / legacyPatternToWhen don't apply).

export type StandingCommitmentRow = {
  dayOfWeek: number | null;
  frequency: string;
  whenKind?: string | null;
  whenDays?: number[] | null;
  whenPpWeek?: number | null;
  whenOrds?: number[] | null;
  whenCycleUnit?: string | null;
  whenCycleN?: number | null;
  whenCycleOffset?: number | null;
};

// Read a standing commitment as a WhenPattern. Prefers the explicit when* columns
// (whenKind set); else maps the legacy dayOfWeek/frequency. A null dayOfWeek means
// "any applicable day" — kind "every" with no weekday filter — which preserves the
// legacy scheduler behavior (a day-null commitment fired on every available day
// regardless of frequency).
export function standingToWhen(sc: StandingCommitmentRow): WhenPattern {
  if (sc.whenKind != null) {
    return buildWhenFromColumns({
      dayOfWeek: sc.dayOfWeek ?? 0,
      pattern: "every",
      whenKind: sc.whenKind,
      whenDays: sc.whenDays,
      whenPpWeek: sc.whenPpWeek,
      whenOrds: sc.whenOrds,
      whenCycleUnit: sc.whenCycleUnit,
      whenCycleN: sc.whenCycleN,
      whenCycleOffset: sc.whenCycleOffset,
    });
  }
  const daysOfWeek = sc.dayOfWeek != null ? [sc.dayOfWeek] : [];
  if (sc.dayOfWeek == null) return { daysOfWeek, kind: "every" };
  switch (sc.frequency) {
    case "biweekly":
      return { daysOfWeek, kind: "cycle", cycleUnit: "week", cycleN: 2, cycleOffset: 0 };
    case "monthly":
      // "monthly on weekday W" = the 1st occurrence of W in the calendar month.
      return { daysOfWeek, kind: "ordinalMonth", ords: [1] };
    case "weekly":
    default:
      return { daysOfWeek, kind: "every" };
  }
}

// Inert back-projection of a WhenPattern to StandingCommitment's legacy columns.
// A single weekday maps to dayOfWeek; multi-day / any-day → null. Authoritative
// reads use the when* columns (standingToWhen), so this only keeps the legacy
// columns sensible.
export function whenToStandingLegacy(w: WhenPattern): { dayOfWeek: number | null; frequency: string } {
  const dayOfWeek = (w.daysOfWeek?.length ?? 0) === 1 ? w.daysOfWeek[0] : null;
  let frequency = "weekly";
  if (w.kind === "cycle" && w.cycleUnit === "week") frequency = "biweekly";
  else if (w.kind === "ordinalMonth") frequency = "monthly";
  return { dayOfWeek, frequency };
}
