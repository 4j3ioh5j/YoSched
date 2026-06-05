// Pure logic for schedule requests — date-specific, per-provider constraints
// ("off 7/4", "no ORC or ORL next week", "AL 8/1–8/5") that feed BOTH the manual
// scheduler (as cell warnings) and auto-schedule (as candidate gates).
//
// Two surfaces:
//   foldRequestsForDate()  — collapse a provider's APPROVED requests on a date into
//                            the gates/weights the scheduler & auto-scheduler consume.
//   checkRequestConflict() — given a placed assignment, flag where it contradicts an
//                            approved HARD request (drives the manual cell warning).
//
// Approval gate: only status==="approved" requests exert scheduling force. Pending
// requests still render in the grid (callers pass {includePending:true} for display),
// but never reach foldRequestsForDate / checkRequestConflict's force path.
//
// Dates are "YYYY-MM-DD" strings throughout — string comparison is correct for
// ISO dates, matching constraints.ts / dedicated-columns.ts conventions.

export type RequestKind = "OFF" | "LEAVE" | "NEGATE_SHIFT" | "REQUEST_SHIFT";
export type RequestStrength = "hard" | "soft";
export type RequestStatus = "pending" | "approved" | "declined" | "fulfilled" | "withdrawn";

export type ScheduleRequestData = {
  id: string;
  providerId: string;
  startDate: string; // inclusive, "YYYY-MM-DD"
  endDate: string; // inclusive, "YYYY-MM-DD"
  kind: RequestKind;
  shiftTypeIds: string[]; // NEGATE_SHIFT: shifts to exclude; REQUEST_SHIFT: shifts wanted
  leaveShiftTypeId: string | null; // LEAVE: the leave shift to pre-place
  strength: RequestStrength;
  status: RequestStatus;
};

// The collapsed effect of a provider's approved requests on a single date.
export type FoldedRequests = {
  forbidWorking: boolean; // hard OFF — cannot take any working (non-off) shift
  avoidWorking: boolean; // soft OFF — prefer not to work
  leaveShiftTypeId: string | null; // hard LEAVE — pre-place this leave shift
  forbiddenShiftIds: Set<string>; // hard NEGATE_SHIFT — exclude these shift ids
  avoidedShiftIds: Set<string>; // soft NEGATE_SHIFT — down-weight these
  forcedShiftIds: Set<string>; // hard REQUEST_SHIFT — provider wants one of these
  preferredShiftIds: Set<string>; // soft REQUEST_SHIFT — up-weight these
  requestIds: string[]; // the approved requests that contributed (for badge/audit)
};

export type RequestConflict = {
  requestId: string;
  message: string;
};

/** Inclusive date-range membership. Safe for "YYYY-MM-DD" lexical comparison. */
export function coversDate(
  req: { startDate: string; endDate: string },
  date: string
): boolean {
  return req.startDate <= date && date <= req.endDate;
}

/** All of one provider's requests covering `date`. By default only approved ones;
 *  pass includePending to also show pending ones (grid display). Terminal statuses
 *  (declined / withdrawn / fulfilled) are never returned — they don't belong on the grid. */
export function requestsForProviderDate<
  T extends { providerId: string; startDate: string; endDate: string; status: RequestStatus }
>(
  requests: T[],
  providerId: string,
  date: string,
  opts: { includePending?: boolean } = {}
): T[] {
  const visible: RequestStatus[] = opts.includePending ? ["approved", "pending"] : ["approved"];
  return requests.filter(
    (r) =>
      r.providerId === providerId && coversDate(r, date) && visible.includes(r.status)
  );
}

/** Collapse a provider's APPROVED requests on `date` into scheduling gates/weights. */
export function foldRequestsForDate(
  requests: ScheduleRequestData[],
  providerId: string,
  date: string
): FoldedRequests {
  const folded: FoldedRequests = {
    forbidWorking: false,
    avoidWorking: false,
    leaveShiftTypeId: null,
    forbiddenShiftIds: new Set(),
    avoidedShiftIds: new Set(),
    forcedShiftIds: new Set(),
    preferredShiftIds: new Set(),
    requestIds: [],
  };

  for (const r of requestsForProviderDate(requests, providerId, date)) {
    folded.requestIds.push(r.id);
    const hard = r.strength === "hard";
    switch (r.kind) {
      case "OFF":
        if (hard) folded.forbidWorking = true;
        else folded.avoidWorking = true;
        break;
      case "LEAVE":
        // Leave is inherently hard: pre-place the leave shift. First approved wins.
        if (r.leaveShiftTypeId && !folded.leaveShiftTypeId) {
          folded.leaveShiftTypeId = r.leaveShiftTypeId;
        }
        break;
      case "NEGATE_SHIFT":
        for (const id of r.shiftTypeIds) {
          (hard ? folded.forbiddenShiftIds : folded.avoidedShiftIds).add(id);
        }
        break;
      case "REQUEST_SHIFT":
        for (const id of r.shiftTypeIds) {
          (hard ? folded.forcedShiftIds : folded.preferredShiftIds).add(id);
        }
        break;
    }
  }

  return folded;
}

/** Does this provider have any approved request affecting `date`? (grid: show badge) */
export function hasActiveRequest(
  requests: ScheduleRequestData[],
  providerId: string,
  date: string
): boolean {
  return requestsForProviderDate(requests, providerId, date).length > 0;
}

/** Flag where a placed assignment contradicts an approved HARD request.
 *  `assignedShiftTypeId` is the shift placed in the cell (null = empty cell).
 *  `isOffShift` marks whether that shift is an off/non-working shift.
 *  `codeOf` resolves a shift id to its display code for human-readable messages. */
export function checkRequestConflict({
  requests,
  providerId,
  date,
  assignedShiftTypeId,
  isOffShift,
  codeOf,
}: {
  requests: ScheduleRequestData[];
  providerId: string;
  date: string;
  assignedShiftTypeId: string | null;
  isOffShift: boolean;
  codeOf: (shiftTypeId: string) => string;
}): RequestConflict[] {
  if (!assignedShiftTypeId) return [];
  const conflicts: RequestConflict[] = [];
  const working = !isOffShift;

  for (const r of requestsForProviderDate(requests, providerId, date)) {
    if (r.strength !== "hard") continue; // soft requests advise, never conflict
    switch (r.kind) {
      case "OFF":
        if (working) {
          conflicts.push({
            requestId: r.id,
            message: `Requested OFF on this date — assigned ${codeOf(assignedShiftTypeId)}`,
          });
        }
        break;
      case "LEAVE": {
        // Approved leave pre-places a specific leave shift; anything else conflicts.
        // When the leave shift is known, a mismatch conflicts regardless of off/working
        // (a *different* off/leave shift must not silently bypass). When unknown, only a
        // working shift is unambiguously wrong.
        const leaveId = r.leaveShiftTypeId;
        const mismatch = leaveId ? assignedShiftTypeId !== leaveId : working;
        if (mismatch) {
          const leaveCode = leaveId ? codeOf(leaveId) : "leave";
          conflicts.push({
            requestId: r.id,
            message: `On ${leaveCode} leave — assigned ${codeOf(assignedShiftTypeId)}`,
          });
        }
        break;
      }
      case "NEGATE_SHIFT":
        if (r.shiftTypeIds.includes(assignedShiftTypeId)) {
          conflicts.push({
            requestId: r.id,
            message: `Requested no ${codeOf(assignedShiftTypeId)} on this date`,
          });
        }
        break;
      case "REQUEST_SHIFT":
        // Wanted a specific shift but got something else — including an off/leave shift
        // (being handed OFF when you asked to work ORC is just as much a conflict).
        if (r.shiftTypeIds.length > 0 && !r.shiftTypeIds.includes(assignedShiftTypeId)) {
          const wanted = r.shiftTypeIds.map(codeOf).join(" or ");
          conflicts.push({
            requestId: r.id,
            message: `Requested ${wanted} — assigned ${codeOf(assignedShiftTypeId)}`,
          });
        }
        break;
    }
  }

  return conflicts;
}
