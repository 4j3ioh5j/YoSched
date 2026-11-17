// Card #332: the Requests page shows a person's requests per day, grouped into lines of
// consecutive identical days, and moves a finished month's days into an Archive whose
// outcome (met / not met) is computed live from the schedule on every load. Pure: the browser
// and the server share it. Nothing here touches the live approval rule
// (assignmentSatisfiesRequestOnDate), auto-approval or the engines: the archive rules below
// judge a FINISHED day only.

import { eachDateInclusive, type ScheduleRequestData } from "./schedule-requests";
import { resolveZone, wallClock } from "./time-zone";

export type LineRequest = Pick<
  ScheduleRequestData,
  "id" | "staffId" | "startDate" | "endDate" | "kind" | "shiftTypeIds" | "leaveShiftTypeId" | "strength" | "status"
>;
export type ShiftFacts = { isOff: boolean; isLeave: boolean };
export type FactsOf = (shiftTypeId: string) => ShiftFacts | undefined;

// ── Settings ────────────────────────────────────────────────────────────────────────────

/** "When a month is archived, a leave request counts as met by …" */
export type ArchiveLeaveRule = "exact" | "any-leave" | "any-off";
export const ARCHIVE_LEAVE_RULES: readonly ArchiveLeaveRule[] = ["exact", "any-leave", "any-off"];
export const DEFAULT_ARCHIVE_LEAVE_RULE: ArchiveLeaveRule = "any-off";
export function isArchiveLeaveRule(v: unknown): v is ArchiveLeaveRule {
  return typeof v === "string" && (ARCHIVE_LEAVE_RULES as readonly string[]).includes(v);
}
export function parseArchiveLeaveRule(v: unknown): ArchiveLeaveRule {
  return isArchiveLeaveRule(v) ? v : DEFAULT_ARCHIVE_LEAVE_RULE;
}

/** "Archive a month's requests N days after it ends." */
export const ARCHIVE_DAYS_MAX = 60;
export const DEFAULT_ARCHIVE_DAYS = 0;
export function isValidArchiveDays(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= ARCHIVE_DAYS_MAX;
}
export function parseArchiveDays(v: unknown): number {
  return isValidArchiveDays(v) ? v : DEFAULT_ARCHIVE_DAYS;
}

// ── Archive membership ──────────────────────────────────────────────────────────────────

const pad2 = (n: number) => (n < 10 ? "0" + n : String(n));

/** Today's calendar date ("YYYY-MM-DD") in the Settings time zone (invalid → UTC). */
export function dateInZone(now: Date, zone: unknown): string {
  const w = wallClock(now, resolveZone(zone));
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
}

/** "YYYY-MM-DD" of the last day of `date`'s month plus `days`. */
function archiveFrom(date: string, days: number): string {
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7);
  // Day 0 of the next month = last day of this month; then add the wait.
  return new Date(Date.UTC(y, m, days)).toISOString().slice(0, 10);
}

/** A day is archived once today is later than its month's last day plus `days`. */
export function isArchivedDay(date: string, today: string, days: number): boolean {
  return today > archiveFrom(date, days);
}

/** The months ("YYYY-MM") that have at least one archived requested day, newest first. */
export function archivedMonths(requests: Pick<LineRequest, "startDate" | "endDate">[], today: string, days: number): string[] {
  const months = new Set<string>();
  for (const r of requests) {
    // Walk month by month (a long request must not cost one step per day).
    let cur = r.startDate.slice(0, 7);
    const last = r.endDate.slice(0, 7);
    while (cur <= last) {
      const firstDay = cur === r.startDate.slice(0, 7) ? r.startDate : `${cur}-01`;
      if (isArchivedDay(firstDay, today, days)) months.add(cur);
      else break; // later months are not archived either
      const y = +cur.slice(0, 4);
      const m = +cur.slice(5, 7);
      cur = m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
    }
  }
  return [...months].sort().reverse();
}

// ── Archived outcome ────────────────────────────────────────────────────────────────────

export type DayOutcome = "met" | "unmet";

/** LEAVE, or a REQUEST_SHIFT whose wanted shifts are ALL leave types (My Requests saves leave
 *  this way). A mixed REQUEST_SHIFT keeps plain either-or semantics. */
export function isLeaveRequest(req: Pick<LineRequest, "kind" | "shiftTypeIds">, factsOf: FactsOf): boolean {
  if (req.kind === "LEAVE") return true;
  return req.kind === "REQUEST_SHIFT" && req.shiftTypeIds.length > 0 && req.shiftTypeIds.every((id) => !!factsOf(id)?.isLeave);
}

/** Was this request met on a FINISHED day? `got` is the day's shift (null = nothing
 *  scheduled, which in a finished month means not working). Archive only: the live
 *  approval rule is unchanged. */
export function archivedDayOutcome(
  req: Pick<LineRequest, "kind" | "shiftTypeIds" | "leaveShiftTypeId">,
  got: string | null,
  factsOf: FactsOf,
  rule: ArchiveLeaveRule,
): DayOutcome {
  const facts = got ? factsOf(got) : undefined;
  const notWorking = got === null || !!facts?.isOff || !!facts?.isLeave;
  const ok = (b: boolean): DayOutcome => (b ? "met" : "unmet");
  if (isLeaveRequest(req, factsOf)) {
    const asked = req.kind === "LEAVE" ? (req.leaveShiftTypeId ? [req.leaveShiftTypeId] : []) : req.shiftTypeIds;
    if (got !== null && asked.includes(got)) return "met";
    if (rule === "exact") return "unmet";
    if (rule === "any-leave") return ok(!!facts?.isLeave);
    return ok(notWorking);
  }
  switch (req.kind) {
    case "NEGATE_SHIFT":
      return ok(got === null || !req.shiftTypeIds.includes(got));
    case "OFF":
      return ok(notWorking);
    case "REQUEST_SHIFT":
      return ok(got !== null && req.shiftTypeIds.includes(got));
    default:
      return "unmet";
  }
}

// ── Lines ───────────────────────────────────────────────────────────────────────────────

export type PartOutcome = DayOutcome | "withdrawn";

export type LinePart = {
  key: string;
  kind: LineRequest["kind"];
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  strength: LineRequest["strength"];
  status: LineRequest["status"];
  /** Archived lines only. */
  outcome?: PartOutcome;
  /** Every request this part stands for, across all the line's days. */
  requestIds: string[];
};

export type RequestLine = {
  key: string;
  staffId: string;
  startDate: string;
  endDate: string;
  dates: string[];
  parts: LinePart[];
  /** Archived lines with a part not met: the day's shift (null = nothing scheduled). */
  got?: string | null;
};

export type ArchivedContext = {
  cellOf: (staffId: string, date: string) => string | null;
  factsOf: FactsOf;
  rule: ArchiveLeaveRule;
};

const KIND_ORDER: Record<LineRequest["kind"], number> = { OFF: 0, LEAVE: 1, REQUEST_SHIFT: 2, NEGATE_SHIFT: 3 };

type DayPart = Omit<LinePart, "requestIds" | "key"> & { requestIds: Set<string> };

function partKey(p: Omit<LinePart, "requestIds" | "key">): string {
  return [p.kind, p.shiftTypeIds.join(","), p.leaveShiftTypeId ?? "", p.strength, p.status, p.outcome ?? ""].join("|");
}

function nextDate(d: string): string {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Group requests into lines: one person, a run of consecutive days with the same parts
 *  (kind, shifts, leave, strength, status and, when archived, outcome). NEGATE parts that
 *  agree on everything else are shown as one ("not ORC, ORL"); nothing else is merged. Only
 *  days for which `includeDate` holds are used. Display only: no request is changed. */
export function groupRequestLines(
  requests: LineRequest[],
  opts: { includeDate: (date: string) => boolean; archived?: ArchivedContext },
): RequestLine[] {
  // staffId → date → parts of that day
  const days = new Map<string, Map<string, DayPart[]>>();
  const gotByDay = new Map<string, string | null>();
  for (const r of requests) {
    for (const date of eachDateInclusive(r.startDate, r.endDate)) {
      if (!opts.includeDate(date)) continue;
      let outcome: PartOutcome | undefined;
      if (opts.archived) {
        const got = opts.archived.cellOf(r.staffId, date);
        gotByDay.set(`${r.staffId}|${date}`, got);
        outcome = r.status === "withdrawn" ? "withdrawn" : archivedDayOutcome(r, got, opts.archived.factsOf, opts.archived.rule);
      }
      let byDate = days.get(r.staffId);
      if (!byDate) days.set(r.staffId, (byDate = new Map()));
      let parts = byDate.get(date);
      if (!parts) byDate.set(date, (parts = []));
      const base = {
        kind: r.kind,
        shiftTypeIds: [...r.shiftTypeIds].sort(),
        leaveShiftTypeId: r.leaveShiftTypeId,
        strength: r.strength,
        status: r.status,
        ...(outcome !== undefined && { outcome }),
      };
      const merge = parts.find(
        (p) =>
          p.kind === base.kind &&
          p.strength === base.strength &&
          p.status === base.status &&
          p.outcome === outcome &&
          (base.kind === "NEGATE_SHIFT" || (p.shiftTypeIds.join(",") === base.shiftTypeIds.join(",") && p.leaveShiftTypeId === base.leaveShiftTypeId)),
      );
      if (merge) {
        if (base.kind === "NEGATE_SHIFT") merge.shiftTypeIds = [...new Set([...merge.shiftTypeIds, ...base.shiftTypeIds])].sort();
        merge.requestIds.add(r.id);
      } else {
        parts.push({ ...base, requestIds: new Set([r.id]) });
      }
    }
  }

  const lines: RequestLine[] = [];
  for (const staffId of [...days.keys()].sort()) {
    const byDate = days.get(staffId)!;
    let cur: { line: RequestLine; sig: string; ids: Map<string, Set<string>> } | null = null;
    const flush = () => {
      if (!cur) return;
      cur.line.parts = cur.line.parts.map((p) => ({ ...p, requestIds: [...cur!.ids.get(p.key)!].sort() }));
      lines.push(cur.line);
      cur = null;
    };
    for (const date of [...byDate.keys()].sort()) {
      const parts = byDate.get(date)!
        .map((p) => {
          const { requestIds, ...rest } = p;
          return { ...rest, key: partKey(rest), requestIds };
        })
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.key.localeCompare(b.key));
      const anyUnmet = parts.some((p) => p.outcome === "unmet");
      const got = anyUnmet ? gotByDay.get(`${staffId}|${date}`) ?? null : undefined;
      const sig = parts.map((p) => p.key).join("#") + (anyUnmet ? `@${got ?? ""}` : "");
      if (cur && cur.sig === sig && nextDate(cur.line.endDate) === date) {
        cur.line.endDate = date;
        cur.line.dates.push(date);
        for (const p of parts) for (const id of p.requestIds) cur.ids.get(p.key)!.add(id);
        continue;
      }
      flush();
      const ids = new Map(parts.map((p) => [p.key, new Set(p.requestIds)]));
      cur = {
        sig,
        ids,
        line: {
          key: `${staffId}|${date}`,
          staffId,
          startDate: date,
          endDate: date,
          dates: [date],
          parts: parts.map((p) => ({ ...p, requestIds: [] })),
          ...(anyUnmet && { got }),
        },
      };
    }
    flush();
  }
  return lines;
}
