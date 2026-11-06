// Card #67 — "a maximum is never broken": approving a request on a full day either
// re-arranges the grid legally or flags the request.
//
// `decideApproval` is the PURE decision (no prisma / next / fs). Given the engine
// input for the covering range, the request, its resolved placement and the policy,
// it either returns the exact assignment writes that honour the request without
// breaking any hard rule, or a plain-language reason why that is impossible.
//
// Shape of the decision:
//   A. the request is folded into the input as approved;
//   B. every covered day becomes a PIN (the requested shift, locked) unless the cell
//      is locked and already satisfies the request; a locked, unsatisfied cell and a
//      contradiction with one of the requester's OTHER approvals are impossible at once;
//   E. required followers of a working pin are pinned too (the engine only generates
//      followers for shifts it places itself);
//   F. a ladder of ever-wider free sets (the full day's holders, the day, the pay
//      period — the policy is the ceiling) is handed to the constrained re-solve
//      (`applyScenario`); only auto-placed cells may ever be freed;
//   G. the written grid is VERIFIED rule by rule, cell by cell, target by target —
//      caps, eligibility/availability, follow rules and required followers, the
//      conditional-availability dependents of every changed cell, per-staff hard
//      targets (rolling max / per-window min may not get worse) and every approved
//      request touching a written date. No aggregate score is trusted.
// Hand-placed, imported, locked and request-placed cells, and any cell covered by
// an approved request, are NEVER written (the never-write set NW); the write set is
// an allow-list of pins, frees and the engine's own follower placements.

import { type AutoScheduleInput, type ScheduleShiftType } from "./auto-scheduler";
import { applyScenario, freesForRing, pinHardLegality, type ScenarioFree, type ScenarioPin, type ScenarioPinRejection } from "./scenario";
import { buildDayCapLookup, type DayCapLookup } from "./day-cap";
import { dayCapViolations } from "./max-per-day";
import { buildFollowRuleMap, isShiftAllowedAfter } from "./follow-rules";
import { evaluateAvailability, type PayPeriodRange } from "./availability";
import { getWindowBounds, checkMinimumTargetMet, isAtRollingMaximum } from "./shift-eligibility";
import {
  assignmentSatisfiesRequestOnDate,
  coversDate,
  describeRequest,
  eachDateInclusive,
  parseOffStrategyOrder,
  type ApprovalConflictPolicy,
  type PendingRequestMode,
  type RequestKind,
  type RequestStrength,
  type ScheduleRequestData,
} from "./schedule-requests";

export type ApprovalRequest = {
  id: string;
  staffId: string;
  kind: RequestKind;
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  startDate: string; // "YYYY-MM-DD" inclusive
  endDate: string;
  strength?: RequestStrength;
  offStrategyOrder?: string[];
};

/** A FIXED cell outside the engine's date range (the padding the server loads so
 *  windowed rules see the real neighbours): present in the verified grid, never
 *  freed, never written. */
export type ContextCell = { staffId: string; date: string; shiftTypeId: string; isLocked: boolean; source?: string };

export type ApprovalWrite = {
  staffId: string;
  date: string;
  shiftTypeId: string | null; // null = delete the cell
  source: "request" | "auto";
};

export type ApprovalDecision =
  | { ok: true; writes: ApprovalWrite[]; warnings: string[]; ring: number }
  | { ok: false; reason: string };

type Cell = { shiftTypeId: string; isLocked: boolean; source?: string };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon 11/9" — the day as the reason sentences name it (UTC calendar date). */
export function dayLabel(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return `${DOW[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** `date` moved by `days` whole days (UTC; "YYYY-MM-DD" in and out). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const keyOf = (staffId: string, date: string) => `${staffId}:${date}`;
function splitKey(k: string): [string, string] {
  const i = k.indexOf(":");
  return [k.slice(0, i), k.slice(i + 1)];
}

/** The plain sentence for a pin the constrained re-solve refused. */
export function reasonFromRejection(
  rej: ScenarioPinRejection,
  names: { initialsOf: (staffId: string) => string; codeOf: (shiftTypeId: string) => string; capOf: DayCapLookup },
): string {
  const day = dayLabel(rej.date);
  const ini = names.initialsOf(rej.staffId);
  const code = names.codeOf(rej.shiftTypeId);
  switch (rej.reason) {
    case "day-full": {
      const cap = names.capOf(rej.shiftTypeId, rej.date) ?? 0;
      return cap === 0 ? `${code} is not allowed on ${day}` : `${day} already has its ${cap} ${code}`;
    }
    case "ineligible":
      return `${ini} is not eligible for ${code} on ${day}`;
    case "unavailable":
      return `${ini} is unavailable on ${day}`;
    case "request-blocked":
      return `an approved off or leave request already covers ${day} for ${ini}`;
    case "manual-locked":
      return `${day} is locked for ${ini}`;
    case "unknown-staff":
      return "the staff member is not on the active roster";
    case "unknown-shift":
      return "the requested shift no longer exists";
  }
}

export function decideApproval(
  input: AutoScheduleInput,
  req: ApprovalRequest,
  placement: string,
  policy: ApprovalConflictPolicy,
  context: readonly ContextCell[] = [],
): ApprovalDecision {
  const impossible = (reason: string): ApprovalDecision => ({ ok: false, reason });

  const stById = new Map(input.shiftTypes.map((s) => [s.id, s] as const));
  const staffById = new Map(input.staff.map((s) => [s.id, s] as const));
  const codeOf = (id: string) => stById.get(id)?.code ?? "?";
  const initialsOf = (id: string) => staffById.get(id)?.initials ?? "?";
  const isOff = (id: string) => !!stById.get(id)?.isOffShift;
  const isAway = (id: string) => {
    const st = stById.get(id);
    return !!st && (st.isOffShift || st.isLeave);
  };
  const isWorkingShift = (st: ScheduleShiftType) => !st.isOffShift && !st.isLeave;
  const ppRanges: PayPeriodRange[] = input.payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
  const pendingMode: PendingRequestMode = input.schedulingPreferences.pendingRequestMode ?? "off";
  const holidaySet = new Set(input.holidays.map((h) => h.date));
  const capOf = buildDayCapLookup(input.staffingRequirements, holidaySet);
  const dateSet = new Set(input.dates);
  const names = { initialsOf, codeOf, capOf };

  const requester = staffById.get(req.staffId);
  if (!requester) return impossible("the staff member is not on the active roster");
  const placementSt = stById.get(placement);
  if (!placementSt) return impossible("the requested shift no longer exists");
  const offShiftId = input.shiftTypes.find((s) => s.isOffShift)?.id ?? null;

  // ── A. the input copy: this request present as a human-approved hard request ──
  const approvedReq: ScheduleRequestData = {
    id: req.id,
    staffId: req.staffId,
    startDate: req.startDate,
    endDate: req.endDate,
    kind: req.kind,
    shiftTypeIds: req.shiftTypeIds,
    leaveShiftTypeId: req.leaveShiftTypeId,
    strength: "hard",
    status: "approved",
    autoApproved: false,
    receivedAt: null,
    offStrategyOrder: req.offStrategyOrder ?? [],
  };
  const requests: ScheduleRequestData[] = [...(input.scheduleRequests ?? []).filter((r) => r.id !== req.id), approvedReq];
  const copy: AutoScheduleInput = { ...input, scheduleRequests: requests };
  const approved = requests.filter((r) => r.status === "approved");
  const approvedCovering = (staffId: string, date: string, excludeId?: string) =>
    approved.filter((r) => r.staffId === staffId && r.id !== excludeId && coversDate(r, date));

  // The engine's heldDayOffOrder: an effective-hard PURE day-off request with a
  // fulfilment order holds the day off for WORK placements (auto-scheduler.ts:644).
  const heldDayOff = (staffId: string, date: string): boolean => {
    for (const r of requests) {
      if (r.staffId !== staffId || !coversDate(r, date)) continue;
      const active = r.status === "approved" || (r.status === "pending" && pendingMode !== "off");
      if (!active || r.strength !== "hard") continue;
      if (r.status === "pending" && pendingMode === "soft") continue;
      if (parseOffStrategyOrder(r.offStrategyOrder).length === 0) continue;
      const pureOff =
        r.kind === "OFF" ||
        (r.kind === "REQUEST_SHIFT" && offShiftId !== null && r.shiftTypeIds.length === 1 && r.shiftTypeIds[0] === offShiftId);
      if (pureOff) return true;
    }
    return false;
  };

  // ── grids: baseline (engine range), context (fixed neighbours), base = both ──
  const baseline = new Map<string, Cell>();
  for (const a of input.existingAssignments) baseline.set(keyOf(a.staffId, a.date), { shiftTypeId: a.shiftTypeId, isLocked: a.isLocked, source: a.source });
  const contextMap = new Map<string, Cell>();
  const knownDates = new Set(input.dates);
  for (const c of context) {
    if (dateSet.has(c.date)) continue; // the engine range is the baseline's, never the context's
    contextMap.set(keyOf(c.staffId, c.date), { shiftTypeId: c.shiftTypeId, isLocked: c.isLocked, source: c.source });
    knownDates.add(c.date);
  }
  const base = new Map<string, Cell>([...contextMap, ...baseline]);

  // ── B. covered days → pins ──
  const covered = eachDateInclusive(req.startDate, req.endDate);
  const coveredKeys = new Set(covered.map((d) => keyOf(req.staffId, d)));
  const pins: ScenarioPin[] = [];
  const pinnedKeys = new Set<string>();
  const coveredPinned: string[] = [];
  for (const d of covered) {
    if (!dateSet.has(d)) return impossible(`${dayLabel(d)} is outside the scheduling range`);
    const cell = baseline.get(keyOf(req.staffId, d));
    if (cell?.isLocked) {
      if (assignmentSatisfiesRequestOnDate(req, cell.shiftTypeId, isOff)) continue; // untouched
      return impossible(`${dayLabel(d)} is locked and holds ${codeOf(cell.shiftTypeId)} for ${requester.initials}`);
    }
    // V4-1: the requester's OTHER approvals on this day are hard rules too.
    for (const R of approvedCovering(req.staffId, d, req.id)) {
      if (!assignmentSatisfiesRequestOnDate(R, placement, isOff)) {
        return impossible(`${requester.initials} is already approved for ${describeRequest(R, codeOf)} on ${dayLabel(d)}`);
      }
    }
    pins.push({ staffId: req.staffId, date: d, shiftTypeId: placement, away: isAway(placement) });
    pinnedKeys.add(keyOf(req.staffId, d));
    coveredPinned.push(d);
  }

  // ── D. never-write / never-free ──
  const isNW = (staffId: string, date: string): boolean => {
    const k = keyOf(staffId, date);
    if (coveredKeys.has(k)) return false; // the requester's covered keys are governed by B
    const cell = baseline.get(k);
    if (cell && (cell.isLocked || cell.source === "manual" || cell.source === "imported" || cell.source === "request")) return true;
    return approvedCovering(staffId, date).length > 0;
  };
  const isNF = (staffId: string, date: string): boolean => {
    const k = keyOf(staffId, date);
    if (pinnedKeys.has(k) || isNW(staffId, date)) return true;
    const cell = baseline.get(k);
    return !cell || cell.source !== "auto"; // undefined provenance is not freeable
  };

  // ── E. required followers of the pinned source ──
  const followerBySource = new Map<string, { follower: ScheduleShiftType; scope: string }>();
  for (const r of input.requiredFollowers ?? []) {
    const f = stById.get(r.followerShiftId);
    if (f) followerBySource.set(r.sourceShiftId, { follower: f, scope: r.scope });
  }
  const w0 = new Map<string, Cell>(base);
  for (const p of pins) w0.set(keyOf(p.staffId, p.date), { shiftTypeId: p.shiftTypeId, isLocked: true, source: "request" });
  const pinSpec = followerBySource.get(placement);
  if (pinSpec && isWorkingShift(placementSt)) {
    const F = pinSpec.follower;
    const workFollower = isWorkingShift(F);
    const followerDates = new Set<string>();
    for (const p of pins) {
      if (pinSpec.scope === "each_day") followerDates.add(shiftDate(p.date, 1));
      else if (pinSpec.scope === "each_run") {
        let end = p.date;
        while (w0.get(keyOf(req.staffId, shiftDate(end, 1)))?.shiftTypeId === placement) end = shiftDate(end, 1);
        followerDates.add(shiftDate(end, 1));
      }
    }
    for (const fd of [...followerDates].sort()) {
      const fail = (why: string) => impossible(`a required ${F.code} after ${placementSt.code} could not be placed on ${dayLabel(fd)} (${why})`);
      const k = keyOf(req.staffId, fd);
      if (!dateSet.has(fd)) {
        if (contextMap.get(k)?.shiftTypeId === F.id) continue; // already there, outside the range
        return fail("outside the scheduling range");
      }
      const cell = w0.get(k);
      if (cell?.shiftTypeId === F.id) {
        // Already holds the follower: pin the same value so no free can take it.
        if (!pinnedKeys.has(k)) { pins.push({ staffId: req.staffId, date: fd, shiftTypeId: F.id, away: isAway(F.id) }); pinnedKeys.add(k); }
        continue;
      }
      if (pinnedKeys.has(k)) return fail(`that day is requested as ${codeOf(cell!.shiftTypeId)}`);
      if (isNW(req.staffId, fd)) return fail(cell ? `that day holds ${codeOf(cell.shiftTypeId)}` : "that day is held by another approved request");
      if (cell && cell.source !== "auto") return fail(`that day holds ${codeOf(cell.shiftTypeId)}`);
      if (workFollower && holidaySet.has(fd)) return fail("holiday");
      if (workFollower && heldDayOff(req.staffId, fd)) return fail("that day is requested off");
      pins.push({ staffId: req.staffId, date: fd, shiftTypeId: F.id, away: isAway(F.id) });
      pinnedKeys.add(k);
    }
  }

  // ── F0. holders of a pinned shift on a day at its Max ──
  const frees0 = new Map<string, ScenarioFree>();
  for (const p of pins) {
    const cap = capOf(p.shiftTypeId, p.date);
    if (cap == null) continue;
    const code = codeOf(p.shiftTypeId);
    // A Max of 0 means the shift is not allowed that day at all: no holder to move, no policy
    // can help (review #328: this used to dereference an absent holder).
    if (cap === 0) return impossible(`${code} is not allowed on ${dayLabel(p.date)}`);
    const holders = input.existingAssignments.filter((a) => a.date === p.date && a.shiftTypeId === p.shiftTypeId && a.staffId !== p.staffId);
    if (holders.length < cap) continue;
    if (policy === "flag") return impossible(`${dayLabel(p.date)} already has its ${cap} ${code}`);
    const immovable = holders.filter((h) => isNF(h.staffId, h.date));
    if (immovable.length >= cap) {
      const h = immovable[0];
      const cell = baseline.get(keyOf(h.staffId, h.date))!;
      const why = cell.isLocked
        ? `locked for ${initialsOf(h.staffId)}`
        : approvedCovering(h.staffId, h.date).length > 0
          ? `held by ${initialsOf(h.staffId)} for another approved request`
          : `set by hand for ${initialsOf(h.staffId)}`;
      return impossible(`${dayLabel(p.date)} already has its ${cap} ${code} (${why})`);
    }
    const freeable = holders.filter((h) => !isNF(h.staffId, h.date));
    for (const h of freeable) frees0.set(keyOf(h.staffId, h.date), { staffId: h.staffId, date: h.date });
  }

  const followMap = buildFollowRuleMap(input.followRules ?? []);

  // ── G. verify the written grid, rule by rule ──
  function verify(W: Map<string, Cell>, writes: ApprovalWrite[]): string | null {
    const isAssignedW = (s: string, d: string): boolean => {
      const c = W.get(keyOf(s, d));
      return !!c && !isAway(c.shiftTypeId);
    };
    const writtenKeys = new Set(writes.map((w) => keyOf(w.staffId, w.date)));

    // 1. the allow-list held
    for (const w of writes) {
      if (isNW(w.staffId, w.date)) return `a protected shift for ${initialsOf(w.staffId)} on ${dayLabel(w.date)} would change`;
      if (baseline.get(keyOf(w.staffId, w.date))?.isLocked) return `${dayLabel(w.date)} is locked for ${initialsOf(w.staffId)}`;
    }

    // 2. per-day Max, every kind (leave included), on the grid as it will be saved
    const proposed = writes.filter((w) => w.shiftTypeId !== null).map((w) => ({ staffId: w.staffId, date: w.date, shiftTypeId: w.shiftTypeId! }));
    const current = [...W.entries()].map(([k, c]) => {
      const [staffId, date] = splitKey(k);
      return { staffId, date, shiftTypeId: c.shiftTypeId };
    });
    const v = dayCapViolations(proposed, current, capOf)[0];
    if (v) return reasonFromRejection({ ...v, reason: "day-full" }, names);

    // 3. every written WORKING cell: eligibility, request block, availability on W
    for (const w of writes) {
      if (!w.shiftTypeId) continue;
      const st = stById.get(w.shiftTypeId);
      const staff = staffById.get(w.staffId);
      if (!st) return "the requested shift no longer exists";
      if (!staff) return `${w.staffId} is not on the active roster`;
      if (!isWorkingShift(st)) continue;
      const legality = pinHardLegality(staff, st, w.date, ppRanges, isAssignedW, requests, pendingMode, isAway);
      if (legality !== "ok") return reasonFromRejection({ staffId: w.staffId, date: w.date, shiftTypeId: w.shiftTypeId, reason: legality }, names);
      if (heldDayOff(w.staffId, w.date)) return `an approved off request already covers ${dayLabel(w.date)} for ${staff.initials}`;
    }

    // 4. follow rules across every written boundary; required followers present
    const sourceCells = new Map<string, Cell>(); // written working cells with a spec, and the day-before cells of every write
    for (const w of writes) {
      const k = keyOf(w.staffId, w.date);
      const cell = W.get(k);
      if (cell && followerBySource.has(cell.shiftTypeId)) sourceCells.set(k, cell);
      const pk = keyOf(w.staffId, shiftDate(w.date, -1));
      const prev = W.get(pk);
      if (prev && followerBySource.has(prev.shiftTypeId)) sourceCells.set(pk, prev);
    }
    for (const w of writes) {
      if (!w.shiftTypeId) continue;
      const ini = initialsOf(w.staffId);
      const prev = W.get(keyOf(w.staffId, shiftDate(w.date, -1)));
      if (prev && !isShiftAllowedAfter(followMap, prev.shiftTypeId, w.shiftTypeId, isOff(w.shiftTypeId))) {
        return `${codeOf(w.shiftTypeId)} cannot follow ${codeOf(prev.shiftTypeId)} for ${ini} on ${dayLabel(w.date)}`;
      }
      const nd = shiftDate(w.date, 1);
      const next = W.get(keyOf(w.staffId, nd));
      if (next && !isShiftAllowedAfter(followMap, w.shiftTypeId, next.shiftTypeId, isOff(next.shiftTypeId))) {
        return `${codeOf(next.shiftTypeId)} cannot follow ${codeOf(w.shiftTypeId)} for ${ini} on ${dayLabel(nd)}`;
      }
    }
    for (const [k, cell] of sourceCells) {
      const st = stById.get(cell.shiftTypeId);
      const spec = followerBySource.get(cell.shiftTypeId);
      if (!st || !spec || !isWorkingShift(st)) continue;
      const [staffId, date] = splitKey(k);
      const nd = shiftDate(date, 1);
      if (!knownDates.has(nd)) continue; // beyond what is loaded: the engine never looks there either
      const next = W.get(keyOf(staffId, nd));
      const runEnd = spec.scope === "each_day" || next?.shiftTypeId !== cell.shiftTypeId;
      if (!runEnd) continue;
      const F = spec.follower;
      // A work follower must be there; an off/leave follower is satisfied by any non-working next day.
      const satisfied = next?.shiftTypeId === F.id || (!isWorkingShift(F) && (!next || isAway(next.shiftTypeId)));
      if (!satisfied) return `a required ${F.code} after ${st.code} is missing for ${initialsOf(staffId)} on ${dayLabel(nd)}`;
    }

    // 5. conditional-availability dependents of every changed cell
    const changedByDate = new Map<string, Set<string>>();
    for (const w of writes) {
      let s = changedByDate.get(w.date);
      if (!s) changedByDate.set(w.date, (s = new Set()));
      s.add(w.staffId);
    }
    for (const [d, changed] of changedByDate) {
      for (const S of input.staff) {
        if (changed.has(S.id)) continue;
        if (!S.availabilityRules.some((r) => r.conditionStaffId && changed.has(r.conditionStaffId))) continue;
        const c = W.get(keyOf(S.id, d));
        if (!c) continue;
        const st = stById.get(c.shiftTypeId);
        if (!st || !isWorkingShift(st) || st.ignoresWorkingDays) continue;
        if (!evaluateAvailability(S.availabilityRules, d, ppRanges, isAssignedW).available) {
          return `${S.initials} would no longer be available to work on ${dayLabel(d)}`;
        }
      }
    }

    // 6. per-staff HARD targets: no new rolling-max overage, no deeper per-window min shortfall
    const writtenStaff = new Set(writes.map((w) => w.staffId));
    for (const sid of writtenStaff) {
      const staff = staffById.get(sid);
      if (!staff) continue;
      for (const t of staff.shiftMinimumTargets ?? []) {
        if ((t.strength ?? "rule") !== "rule") continue;
        const heldIn = (G: Map<string, Cell>): string[] =>
          [...G.entries()]
            .filter(([k, c]) => c.shiftTypeId === t.shiftTypeId && splitKey(k)[0] === sid)
            .map(([k]) => splitKey(k)[1])
            .sort();
        const hb = heldIn(base);
        const hw = heldIn(W);
        if (t.maxCount != null) {
          const over = (held: string[]) => new Set(held.filter((d) => isAtRollingMaximum(t, d, held.filter((x) => x !== d), ppRanges)));
          const ob = over(hb);
          for (const d of over(hw)) {
            if (!ob.has(d)) return `${staff.initials} would be over their ${codeOf(t.shiftTypeId)} maximum on ${dayLabel(d)}`;
          }
        }
        if (t.minCount > 0) {
          const windows = new Map<string, { start: string; end: string }>();
          for (const d of input.dates) {
            const b = getWindowBounds(t, d, ppRanges);
            if (b) windows.set(`${b.start}|${b.end}`, b);
          }
          for (const b of windows.values()) {
            const shortfall = (held: string[]) => Math.max(0, t.minCount - checkMinimumTargetMet(t, held.filter((d) => d >= b.start && d <= b.end)).current);
            if (shortfall(hw) > shortfall(hb)) return `${staff.initials} would fall short of their ${codeOf(t.shiftTypeId)} minimum`;
          }
        }
      }
    }

    // 8. approved requests (anyone's) touching a written date
    for (const R of approved) {
      const days = eachDateInclusive(R.startDate, R.endDate);
      if (!days.some((d) => writtenKeys.has(keyOf(R.staffId, d)))) continue;
      const cellOn = (G: Map<string, Cell>, d: string) => G.get(keyOf(R.staffId, d))?.shiftTypeId ?? null;
      if (R.id === req.id) {
        for (const d of days) {
          if (!assignmentSatisfiesRequestOnDate(R, cellOn(W, d), isOff)) return `the request would not be honoured on ${dayLabel(d)}`;
        }
        continue;
      }
      for (const d of days) {
        if (!knownDates.has(d)) continue;
        if (assignmentSatisfiesRequestOnDate(R, cellOn(base, d), isOff) && !assignmentSatisfiesRequestOnDate(R, cellOn(W, d), isOff)) {
          return `${initialsOf(R.staffId)}'s approved ${describeRequest(R, codeOf)} on ${dayLabel(d)} would be broken`;
        }
      }
    }
    return null;
  }

  // ── F. the ladder ──
  const ceiling = policy === "flag" ? 0 : policy === "resolve-day" ? 1 : 2;
  const touched = new Set(pins.map((p) => p.date));
  let lastReason: string | null = null;
  for (let ring = 0; ring <= ceiling; ring++) {
    const frees = new Map(frees0);
    for (const f of freesForRing(copy, pinnedKeys, touched, ring)) {
      if (!isNF(f.staffId, f.date)) frees.set(keyOf(f.staffId, f.date), f);
    }
    const outcome = applyScenario(copy, pins, [...frees.values()]);
    if (!outcome.applied) return impossible(reasonFromRejection(outcome.rejected[0], names));

    // Allowed writes: pins ∪ frees ∪ the engine's follower placements for cells that are
    // THEMSELVES kept (pins or frees). A follower of a fill the engine made elsewhere is
    // discarded with its source (review #328: deriving it from every change wrote unrelated
    // follower cells even under the "never move anyone" policy).
    const retained = new Set<string>([...pinnedKeys, ...frees.keys()]);
    const allowed = new Set<string>(retained);
    const resultMap = new Map(outcome.grid.map((c) => [keyOf(c.staffId, c.date), c.shiftTypeId] as const));
    for (const ch of outcome.changes) {
      if (!ch.after) continue;
      if (!retained.has(keyOf(ch.staffId, ch.date))) continue;
      const spec = followerBySource.get(ch.after.shiftTypeId);
      const st = stById.get(ch.after.shiftTypeId);
      if (!spec || !st || !isWorkingShift(st)) continue;
      let fd: string;
      if (spec.scope === "each_day") fd = shiftDate(ch.date, 1);
      else if (spec.scope === "each_run") {
        let end = ch.date;
        while (resultMap.get(keyOf(ch.staffId, shiftDate(end, 1))) === ch.after.shiftTypeId) end = shiftDate(end, 1);
        fd = shiftDate(end, 1);
      } else continue;
      if (isNW(ch.staffId, fd)) continue;
      const b = baseline.get(keyOf(ch.staffId, fd));
      if (b && b.source !== "auto") continue;
      allowed.add(keyOf(ch.staffId, fd));
    }

    const writes: ApprovalWrite[] = [];
    const written = new Set<string>();
    for (const ch of outcome.changes) {
      const k = keyOf(ch.staffId, ch.date);
      if (!allowed.has(k)) continue; // an engine blank fill elsewhere is never written
      writes.push({ staffId: ch.staffId, date: ch.date, shiftTypeId: ch.after?.shiftTypeId ?? null, source: coveredKeys.has(k) ? "request" : "auto" });
      written.add(k);
    }
    // A covered cell that already holds the shift is still re-sourced as request-placed
    // (what approval has always done), so a later auto run never treats it as its own.
    for (const d of coveredPinned) {
      const k = keyOf(req.staffId, d);
      if (written.has(k)) continue;
      const b = baseline.get(k);
      if (b && b.shiftTypeId === placement && b.source === "request") continue;
      writes.push({ staffId: req.staffId, date: d, shiftTypeId: placement, source: "request" });
      written.add(k);
    }

    const W = new Map<string, Cell>(base);
    for (const w of writes) {
      const k = keyOf(w.staffId, w.date);
      if (w.shiftTypeId === null) W.delete(k);
      else W.set(k, { shiftTypeId: w.shiftTypeId, isLocked: baseline.get(k)?.isLocked ?? false, source: w.source });
    }
    const reason = verify(W, writes);
    if (reason === null) return { ok: true, writes, warnings: outcome.softWarnings, ring };
    lastReason = reason;
  }
  return impossible(lastReason ?? `no legal re-arrangement within the ${ceiling >= 2 ? "pay period" : "day"}`);
}
