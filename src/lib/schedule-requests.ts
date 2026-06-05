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
export type RequestSource = "scheduler" | "provider" | "email";

export const REQUEST_KINDS: readonly RequestKind[] = ["OFF", "LEAVE", "NEGATE_SHIFT", "REQUEST_SHIFT"];
export const REQUEST_STRENGTHS: readonly RequestStrength[] = ["hard", "soft"];
export const REQUEST_SOURCES: readonly RequestSource[] = ["scheduler", "provider", "email"];

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

/** Short human label for a request — grid badge tooltip / picker summary.
 *  e.g. "Off", "No ORC, ORL", "Avoid CALL", "AL leave", "Wants ORC". */
export function describeRequest(
  r: Pick<ScheduleRequestData, "kind" | "shiftTypeIds" | "leaveShiftTypeId" | "strength">,
  codeOf: (shiftTypeId: string) => string
): string {
  const soft = r.strength === "soft";
  switch (r.kind) {
    case "OFF":
      return soft ? "Prefers off" : "Off";
    case "LEAVE":
      return r.leaveShiftTypeId ? `${codeOf(r.leaveShiftTypeId)} leave` : "Leave";
    case "NEGATE_SHIFT":
      return `${soft ? "Avoid" : "No"} ${r.shiftTypeIds.map(codeOf).join(", ")}`;
    case "REQUEST_SHIFT":
      return `${soft ? "Prefers" : "Wants"} ${r.shiftTypeIds.map(codeOf).join(", ")}`;
  }
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

/** Strict calendar-date check: must be literal "YYYY-MM-DD" AND a real date.
 *  Rejects malformed ("2026-6-1", "nope") and impossible dates that JS would
 *  silently roll over ("2026-02-31" → Mar 3, "2026-13-01"). */
export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ---- Picker → request payloads -------------------------------------------
// The manual picker records "marks" on work shifts (accept ○ / negate ✗, each
// hard or soft) plus an optional OFF and any leave shifts. buildRequestPayloads
// turns those marks, applied across the selected cells, into RequestInput rows.

export type MarkPolarity = "accept" | "negate";
export type ShiftMark = { shiftTypeId: string; polarity: MarkPolarity; strength: RequestStrength };

// One provider over an (inclusive) date range — the picker groups the cell
// selection into these before building payloads.
export type RequestTarget = { providerId: string; startDate: string; endDate: string };

export type PickerMarks = {
  shiftMarks: ShiftMark[]; // marks on work shifts
  offStrength: RequestStrength | null; // OFF requested (off-shift), or not
  leaveShiftTypeIds: string[]; // leave shifts requested (each → its own LEAVE)
};

/** Collapse picker marks into request payloads for every target. Like-kind,
 *  like-strength shift marks merge into one row (so "✗ORC ✗ORL" → one hard
 *  NEGATE_SHIFT [ORC,ORL]); each leave and OFF become their own rows. Pure. */
export function buildRequestPayloads(marks: PickerMarks, targets: RequestTarget[]): RequestInput[] {
  // Bucket work-shift marks by (kind, strength).
  const buckets = new Map<string, { kind: RequestKind; strength: RequestStrength; ids: string[] }>();
  for (const m of marks.shiftMarks) {
    const kind: RequestKind = m.polarity === "negate" ? "NEGATE_SHIFT" : "REQUEST_SHIFT";
    const key = `${kind}:${m.strength}`;
    let b = buckets.get(key);
    if (!b) {
      b = { kind, strength: m.strength, ids: [] };
      buckets.set(key, b);
    }
    if (!b.ids.includes(m.shiftTypeId)) b.ids.push(m.shiftTypeId);
  }

  const payloads: RequestInput[] = [];
  for (const t of targets) {
    const baseFor = (
      kind: RequestKind,
      strength: RequestStrength,
      shiftTypeIds: string[],
      leaveShiftTypeId: string | null
    ): RequestInput => ({
      providerId: t.providerId,
      startDate: t.startDate,
      endDate: t.endDate,
      kind,
      shiftTypeIds,
      leaveShiftTypeId,
      strength,
      source: "scheduler",
      notes: null,
    });

    for (const b of buckets.values()) {
      payloads.push(baseFor(b.kind, b.strength, [...b.ids], null));
    }
    if (marks.offStrength) {
      payloads.push(baseFor("OFF", marks.offStrength, [], null));
    }
    for (const leaveId of marks.leaveShiftTypeIds) {
      payloads.push(baseFor("LEAVE", "hard", [], leaveId));
    }
  }
  return payloads;
}

/** Group a flat cell selection into one target per provider, spanning that
 *  provider's earliest→latest selected date (drag-select a week ⇒ a range). */
export function groupCellsIntoTargets(
  cells: { providerId: string; date: string }[]
): RequestTarget[] {
  const byProvider = new Map<string, { min: string; max: string }>();
  for (const c of cells) {
    const cur = byProvider.get(c.providerId);
    if (!cur) byProvider.set(c.providerId, { min: c.date, max: c.date });
    else {
      if (c.date < cur.min) cur.min = c.date;
      if (c.date > cur.max) cur.max = c.date;
    }
  }
  return [...byProvider.entries()].map(([providerId, r]) => ({
    providerId,
    startDate: r.min,
    endDate: r.max,
  }));
}

// Validated, normalized POST input for creating a request.
export type RequestInput = {
  providerId: string;
  startDate: string;
  endDate: string;
  kind: RequestKind;
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  strength: RequestStrength;
  source: RequestSource;
  notes: string | null;
};

/** Pure validation for the create-request endpoint. Returns either an error
 *  message or a normalized value carrying only the fields the kind uses.
 *  Keeps the API route thin and lets the validation be unit-tested directly. */
export function validateRequestInput(
  body: unknown
): { error: string } | { value: RequestInput } {
  const b = (body ?? {}) as Record<string, unknown>;

  const providerId = b.providerId;
  if (typeof providerId !== "string" || !providerId) return { error: "providerId required" };

  const startDate = b.startDate;
  const endDate = b.endDate ?? b.startDate;
  if (!isValidDateStr(startDate)) return { error: "startDate must be a valid YYYY-MM-DD date" };
  if (!isValidDateStr(endDate)) return { error: "endDate must be a valid YYYY-MM-DD date" };
  if (startDate > endDate) return { error: "startDate must be on or before endDate" };

  const kind = b.kind;
  if (!REQUEST_KINDS.includes(kind as RequestKind)) {
    return { error: `kind must be one of ${REQUEST_KINDS.join(", ")}` };
  }
  const strength = b.strength ?? "hard";
  if (!REQUEST_STRENGTHS.includes(strength as RequestStrength)) {
    return { error: `strength must be one of ${REQUEST_STRENGTHS.join(", ")}` };
  }
  const source = b.source ?? "scheduler";
  if (!REQUEST_SOURCES.includes(source as RequestSource)) {
    return { error: `source must be one of ${REQUEST_SOURCES.join(", ")}` };
  }

  const shiftTypeIds = Array.isArray(b.shiftTypeIds)
    ? b.shiftTypeIds.filter((x): x is string => typeof x === "string")
    : [];
  const leaveShiftTypeId = typeof b.leaveShiftTypeId === "string" ? b.leaveShiftTypeId : null;
  const notes = typeof b.notes === "string" ? b.notes : null;

  const k = kind as RequestKind;
  if ((k === "NEGATE_SHIFT" || k === "REQUEST_SHIFT") && shiftTypeIds.length === 0) {
    return { error: `${k} requires at least one shiftTypeId` };
  }
  if (k === "LEAVE" && !leaveShiftTypeId) {
    return { error: "LEAVE requires leaveShiftTypeId" };
  }

  return {
    value: {
      providerId,
      startDate: startDate as string,
      endDate: endDate as string,
      kind: k,
      // Carry only the fields the kind actually uses.
      shiftTypeIds: k === "NEGATE_SHIFT" || k === "REQUEST_SHIFT" ? shiftTypeIds : [],
      leaveShiftTypeId: k === "LEAVE" ? leaveShiftTypeId : null,
      strength: strength as RequestStrength,
      source: source as RequestSource,
      notes,
    },
  };
}
