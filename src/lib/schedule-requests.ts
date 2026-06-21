// Pure logic for schedule requests — date-specific, per-staff constraints
// ("off 7/4", "no ORC or ORL next week", "AL 8/1–8/5") that feed BOTH the manual
// scheduler (as cell warnings) and auto-schedule (as candidate gates).
//
// Two surfaces:
//   foldRequestsForDate()  — collapse a staff's APPROVED requests on a date into
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
export type RequestSource = "scheduler" | "staff" | "email";

// How the auto-scheduler treats PENDING (unapproved) requests:
//   "off"  — ignore pending; only approved requests exert force (pre-#147 behavior).
//   "soft" — honor pending, but force every pending request to SOFT (a preference /
//            bias, never a hard block); approving promotes it to its declared strength.
//   "full" — honor pending at its declared strength, exactly like an approved request.
// Approved requests always use their declared strength regardless of mode.
export type PendingRequestMode = "off" | "soft" | "full";

export const REQUEST_KINDS: readonly RequestKind[] = ["OFF", "LEAVE", "NEGATE_SHIFT", "REQUEST_SHIFT"];
export const REQUEST_STATUSES: readonly RequestStatus[] = ["pending", "approved", "declined", "fulfilled", "withdrawn"];
export const REQUEST_STRENGTHS: readonly RequestStrength[] = ["hard", "soft"];
export const REQUEST_SOURCES: readonly RequestSource[] = ["scheduler", "staff", "email"];
export const PENDING_REQUEST_MODES: readonly PendingRequestMode[] = ["off", "soft", "full"];
export const DEFAULT_PENDING_REQUEST_MODE: PendingRequestMode = "full";

/** STRICT membership check — use this to VALIDATE a user write (reject anything else
 *  with a 400). Do NOT use parsePendingRequestMode() for writes: it coerces unknown
 *  input to the default, which would silently turn a bad write into "full". */
export function isPendingRequestMode(v: unknown): v is PendingRequestMode {
  return typeof v === "string" && (PENDING_REQUEST_MODES as readonly string[]).includes(v);
}

/** LENIENT parse for PERSISTED reads — an unknown / null / legacy value falls back to
 *  the default so a corrupt stored value can never crash the scheduler. Reads only. */
export function parsePendingRequestMode(v: unknown): PendingRequestMode {
  return isPendingRequestMode(v) ? v : DEFAULT_PENDING_REQUEST_MODE;
}

// How the auto-scheduler resolves forced REQUEST_SHIFT placements that contend for a
// scarce slot or would push the requester over their pay-period hour cap:
//   "reconcile"    — place forced requests tentatively up front so the plan builds
//                    AROUND them, then at the end CONFIRM each only if conflict-free
//                    (within the requester's PP-hours cap, doesn't strand coverage,
//                    no earlier request claims the slot). Otherwise REVOKE it and
//                    backfill the freed slot to whoever needs it. First-come
//                    (receivedAt) wins. Mirrors the human process (#220 steps 1 & 10:
//                    requests are placed around, but granted last + conditionally).
//   "honor-always" — pre-#221 behavior: a forced request is placed first and kept,
//                    even if it pushes the requester past their hour cap.
// Human-approved placements (status "approved" AND NOT autoApproved) are authoritative
// in BOTH policies — placed locked and never revoked.
export type RequestConflictPolicy = "reconcile" | "honor-always";
export const REQUEST_CONFLICT_POLICIES: readonly RequestConflictPolicy[] = ["reconcile", "honor-always"];
export const DEFAULT_REQUEST_CONFLICT_POLICY: RequestConflictPolicy = "reconcile";

/** STRICT membership check — use to VALIDATE a user write (reject anything else 400). */
export function isRequestConflictPolicy(v: unknown): v is RequestConflictPolicy {
  return typeof v === "string" && (REQUEST_CONFLICT_POLICIES as readonly string[]).includes(v);
}

/** LENIENT parse for PERSISTED reads — unknown/legacy falls back to the default. */
export function parseRequestConflictPolicy(v: unknown): RequestConflictPolicy {
  return isRequestConflictPolicy(v) ? v : DEFAULT_REQUEST_CONFLICT_POLICY;
}

// ---- Day-off fulfillment strategies --------------------------------------
// A requested day off is an OUTCOME that can be manufactured several ways at
// different cost to the staff's leave pool. `offStrategyOrder` is an ORDERED
// list of how to produce it; the engine (slices 2–3) tries the order top-down,
// first feasible wins, ALL soft and at the LOWEST objective priority (it never
// disrupts coverage; the scheduler can override). Tokens:
//   ORC_ADJACENT       — place an ORC the day before; the existing post-call-off
//                        rule then frees the requested day. No leave-pool cost.
//   ORL_PAIR           — place 2 ORLs anywhere in the pay period; the freed 8h
//                        day lands on the requested date. No leave-pool cost.
//   LEAVE:<shiftTypeId> — pre-place that specific leave shift. Burns the pool.
//                        Staff may rank one-to-many distinct leave types.
// Order resolution: a request stores its OWN resolved order at submit time (so
// later default changes never reinterpret it); the My Requests widget is seeded
// from the staff override → department default.
export const OFF_STRATEGY_FIXED = ["ORC_ADJACENT", "ORL_PAIR"] as const;
export type OffStrategyFixed = (typeof OFF_STRATEGY_FIXED)[number];
export const LEAVE_STRATEGY_PREFIX = "LEAVE:";
/** Department fallback when neither the request nor the staff names an order. */
export const DEFAULT_OFF_STRATEGY_ORDER: readonly string[] = ["ORC_ADJACENT", "ORL_PAIR"];

/** The shiftTypeId carried by a `LEAVE:<id>` token, or null for anything else. */
export function leaveShiftIdOfStrategy(token: unknown): string | null {
  if (typeof token !== "string" || !token.startsWith(LEAVE_STRATEGY_PREFIX)) return null;
  const id = token.slice(LEAVE_STRATEGY_PREFIX.length);
  return id ? id : null;
}

/** STRICT single-token check for a user write. A `LEAVE:` token is only valid
 *  when its shift id is in `validLeaveShiftIds` (Codex #1180: validate against
 *  real eligible leave/off shifts, not just shape). Pass the set on every write. */
export function isOffStrategyToken(v: unknown, validLeaveShiftIds: ReadonlySet<string>): boolean {
  if (typeof v !== "string") return false;
  if ((OFF_STRATEGY_FIXED as readonly string[]).includes(v)) return true;
  const leaveId = leaveShiftIdOfStrategy(v);
  return leaveId !== null && validLeaveShiftIds.has(leaveId);
}

/** STRICT validation for a write: must be an array of known tokens, no duplicates,
 *  and every LEAVE token must reference a currently-eligible leave/off shift.
 *  Returns the normalized array (order preserved) or an error message. */
export function validateOffStrategyOrder(
  v: unknown,
  validLeaveShiftIds: ReadonlySet<string>
): { error: string } | { value: string[] } {
  if (v === undefined || v === null) return { value: [] };
  if (!Array.isArray(v)) return { error: "offStrategyOrder must be an array of strategy tokens" };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of v) {
    if (!isOffStrategyToken(token, validLeaveShiftIds)) {
      return { error: `unknown or ineligible day-off strategy token: ${JSON.stringify(token)}` };
    }
    if (seen.has(token as string)) return { error: `duplicate day-off strategy token: ${token}` };
    seen.add(token as string);
    out.push(token as string);
  }
  return { value: out };
}

/** LENIENT parse for PERSISTED reads — drops unknown/duplicate tokens, and (when
 *  `validLeaveShiftIds` is supplied) drops LEAVE tokens whose shift was since
 *  deleted, so a stale stored order never breaks the UI. When the set is omitted,
 *  any well-formed LEAVE token is kept (used where eligibility isn't loaded). */
export function parseOffStrategyOrder(
  v: unknown,
  validLeaveShiftIds?: ReadonlySet<string>
): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of v) {
    if (typeof token !== "string" || seen.has(token)) continue;
    if ((OFF_STRATEGY_FIXED as readonly string[]).includes(token)) {
      seen.add(token);
      out.push(token);
      continue;
    }
    const leaveId = leaveShiftIdOfStrategy(token);
    if (leaveId === null) continue;
    if (validLeaveShiftIds && !validLeaveShiftIds.has(leaveId)) continue; // stale shift → drop
    seen.add(token);
    out.push(token);
  }
  return out;
}

/** The order to seed/apply: the staff override if it has any tokens, else the
 *  department default. Both are parsed leniently against `validLeaveShiftIds`. */
export function resolveOffStrategyOrder(
  staffOrder: unknown,
  departmentDefault: unknown,
  validLeaveShiftIds?: ReadonlySet<string>
): string[] {
  const staff = parseOffStrategyOrder(staffOrder, validLeaveShiftIds);
  if (staff.length > 0) return staff;
  return parseOffStrategyOrder(departmentDefault, validLeaveShiftIds);
}

/** Human label for one strategy token. `codeOf` resolves a leave shift id to its
 *  display code (e.g. "AL"). Used by the My Requests widget, settings, /requests. */
export function describeOffStrategy(token: string, codeOf: (shiftTypeId: string) => string): string {
  if (token === "ORC_ADJACENT") return "ORC the day before";
  if (token === "ORL_PAIR") return "2 ORLs this pay period";
  const leaveId = leaveShiftIdOfStrategy(token);
  if (leaveId) return `${codeOf(leaveId)} leave`;
  return token;
}

export type ScheduleRequestData = {
  id: string;
  staffId: string;
  startDate: string; // inclusive, "YYYY-MM-DD"
  endDate: string; // inclusive, "YYYY-MM-DD"
  kind: RequestKind;
  shiftTypeIds: string[]; // NEGATE_SHIFT: shifts to exclude; REQUEST_SHIFT: shifts wanted
  leaveShiftTypeId: string | null; // LEAVE: the leave shift to pre-place
  strength: RequestStrength;
  status: RequestStatus;
  // Provenance used by the auto-scheduler's request reconciliation (policy
  // "reconcile"). Optional so existing callers/fixtures stay valid; absent ⇒
  // treated as a human decision with no timestamp (queues last).
  autoApproved?: boolean; // approval derived from a satisfying assignment (auto-revertible). human-approved = approved && !autoApproved
  receivedAt?: string | null; // ISO timestamp the request came in; first-come ordering
  // Day-off fulfillment order (slice 2-3 engine): ordered ORC_ADJACENT | ORL_PAIR |
  // LEAVE:<shiftTypeId> the engine tries top-down as a soft, lowest-priority bias.
  // Absent/empty ⇒ no preference. See the "Day-off fulfillment strategies" section.
  offStrategyOrder?: string[];
};

// One request that contributed to a fold, plus the strength it was applied at AFTER
// any pending→soft downgrade. Conflict flagging reads `effective` (NOT the request's
// declared strength) so a downgraded pending-soft request is never reported as a hard
// conflict, and `status` so a warning can name it "pending" vs "approved".
export type ContributingRequest = {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  declaredStrength: RequestStrength;
  effective: RequestStrength; // strength actually applied to the fold buckets
  shiftTypeIds: string[];
  leaveShiftTypeId: string | null;
  autoApproved: boolean; // human-approved = status "approved" && !autoApproved
  receivedAt: string | null; // ISO; first-come ordering for reconciliation
};

// The collapsed effect of a staff's in-scope requests on a single date. Every hard
// bucket below already reflects EFFECTIVE strength (a downgraded pending-soft request
// lands in the soft bucket), so consumers can trust the buckets directly.
export type FoldedRequests = {
  forbidWorking: boolean; // hard OFF — cannot take any working (non-off) shift
  avoidWorking: boolean; // soft OFF — prefer not to work
  leaveShiftTypeId: string | null; // hard LEAVE — pre-place this leave shift
  forbiddenShiftIds: Set<string>; // hard NEGATE_SHIFT — exclude these shift ids
  avoidedShiftIds: Set<string>; // soft NEGATE_SHIFT — down-weight these
  forcedShiftIds: Set<string>; // hard REQUEST_SHIFT — staff wants one of these
  preferredShiftIds: Set<string>; // soft REQUEST_SHIFT — up-weight these
  requestIds: string[]; // the requests that contributed (for badge/audit)
  contributing: ContributingRequest[]; // provenance for conflict flagging (see above)
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

/** All of one staff's requests covering `date`. By default only approved ones;
 *  pass includePending to also show pending ones (grid display). Terminal statuses
 *  (declined / withdrawn / fulfilled) are never returned — they don't belong on the grid. */
export function requestsForStaffDate<
  T extends { staffId: string; startDate: string; endDate: string; status: RequestStatus }
>(
  requests: T[],
  staffId: string,
  date: string,
  opts: { includePending?: boolean; statuses?: RequestStatus[] } = {}
): T[] {
  const visible: RequestStatus[] = opts.statuses ?? (opts.includePending ? ["approved", "pending"] : ["approved"]);
  return requests.filter(
    (r) =>
      r.staffId === staffId && coversDate(r, date) && visible.includes(r.status)
  );
}

/** Collapse a staff's in-scope requests on `date` into scheduling gates/weights.
 *
 *  `isAwayShift(id)` tells whether a shift is an off/leave ("away") shift; pass it
 *  so a SOFT REQUEST_SHIFT that wants an away shift also nudges the staff away from
 *  work (== the old soft-OFF avoidWorking bias).
 *
 *  `mode` controls whether PENDING (unapproved) requests are folded in:
 *    "off"  (default) — approved-only, declared strength. Byte-for-byte the old
 *                       behavior, so callers that don't pass `mode` are unaffected.
 *    "soft" — approved + pending; pending requests are forced to SOFT.
 *    "full" — approved + pending; pending requests use their declared strength.
 *  Approved requests always use their declared strength. */
export function foldRequestsForDate(
  requests: ScheduleRequestData[],
  staffId: string,
  date: string,
  isAwayShift: (shiftTypeId: string) => boolean = () => false,
  mode: PendingRequestMode = "off"
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
    contributing: [],
  };

  const statuses: RequestStatus[] = mode === "off" ? ["approved"] : ["approved", "pending"];

  for (const r of requestsForStaffDate(requests, staffId, date, { statuses })) {
    // A pending request is downgraded to soft only in "soft" mode; approved requests
    // and "full" mode keep the declared strength.
    const declaredHard = r.strength === "hard";
    const downgraded = r.status === "pending" && mode === "soft";
    const hard = declaredHard && !downgraded;

    folded.requestIds.push(r.id);
    folded.contributing.push({
      id: r.id,
      kind: r.kind,
      status: r.status,
      declaredStrength: r.strength,
      effective: hard ? "hard" : "soft",
      shiftTypeIds: r.shiftTypeIds,
      leaveShiftTypeId: r.leaveShiftTypeId,
      autoApproved: r.autoApproved ?? false,
      receivedAt: r.receivedAt ?? null,
    });

    switch (r.kind) {
      case "OFF":
        if (hard) folded.forbidWorking = true;
        else folded.avoidWorking = true;
        break;
      case "LEAVE":
        // A hard LEAVE pre-places its leave shift authoritatively (first one wins). A
        // downgraded (pending-soft) LEAVE can't claim the cell, so it becomes a
        // preference toward the leave shift plus an avoid-working nudge instead.
        if (r.leaveShiftTypeId) {
          if (hard) {
            if (!folded.leaveShiftTypeId) folded.leaveShiftTypeId = r.leaveShiftTypeId;
          } else {
            folded.preferredShiftIds.add(r.leaveShiftTypeId);
            folded.avoidWorking = true;
          }
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
        // A soft "I'd prefer Off / leave" (REQUEST_SHIFT covering an away shift)
        // should still discourage giving this staff work, exactly as the old soft
        // OFF did. Hard away needs no flag — it's placed authoritatively, which
        // marks the cell assigned so work can't land there.
        if (!hard && r.shiftTypeIds.some(isAwayShift)) folded.avoidWorking = true;
        break;
    }
  }

  return folded;
}

/** Flag logically contradictory requests folded onto one (staff, date) so the
 *  auto-scheduler can surface them (advisory — it never blocks placement). Reads the
 *  EFFECTIVE strength baked into the buckets, so a downgraded pending-soft request can
 *  never raise a hard conflict; `status` provenance only adjusts the wording. The
 *  caller prefixes the staff/date. `isWorkingShift(id)` = a non-away (real work) shift. */
export function detectRequestConflicts(
  folded: FoldedRequests,
  isWorkingShift: (shiftTypeId: string) => boolean,
  codeOf: (shiftTypeId: string) => string = (id) => id
): string[] {
  const msgs: string[] = [];
  const forced = [...folded.forcedShiftIds];
  const hardForcedWorking = forced.filter(isWorkingShift);
  const overlap = forced.filter((id) => folded.forbiddenShiftIds.has(id));

  // Did a PENDING request land in a hard bucket here? (only shapes the phrasing)
  const tag = folded.contributing.some((c) => c.effective === "hard" && c.status === "pending")
    ? "pending "
    : "";

  // (a) a hard OFF and a hard request to actually work.
  if (folded.forbidWorking && hardForcedWorking.length > 0) {
    msgs.push(`hard OFF conflicts with a ${tag}request to work ${hardForcedWorking.map(codeOf).join("/")}`);
  }
  // (b) the same shift both requested and hard-excluded.
  if (overlap.length > 0) {
    msgs.push(`${tag}request to work ${overlap.map(codeOf).join("/")} also has a hard request to exclude it`);
  }
  // (c) a hard leave pre-placement and a hard request to work the same day.
  if (folded.leaveShiftTypeId && hardForcedWorking.length > 0) {
    msgs.push(`hard leave (${codeOf(folded.leaveShiftTypeId)}) conflicts with a ${tag}request to work ${hardForcedWorking.map(codeOf).join("/")}`);
  }
  // (d) two+ DISTINCT hard REQUEST_SHIFT work requests that no single placement can
  // satisfy (no working shift common to all). A cell holds one shift, so STEP 0b
  // places just the first sorted candidate and the rest are silently dropped — flag
  // it. A single OR request (one entry listing several shifts) is fine: it stays one
  // contributing entry, so this needs ≥2 distinct requests with disjoint work options.
  const hardWorkReqs = folded.contributing.filter(
    (c) => c.kind === "REQUEST_SHIFT" && c.effective === "hard" && c.shiftTypeIds.some(isWorkingShift)
  );
  if (hardWorkReqs.length >= 2) {
    const workSets = hardWorkReqs.map((c) => new Set(c.shiftTypeIds.filter(isWorkingShift)));
    const common = [...workSets[0]].filter((id) => workSets.every((s) => s.has(id)));
    if (common.length === 0) {
      const dtag = hardWorkReqs.some((c) => c.status === "pending") ? "pending " : "";
      const opts = hardWorkReqs.map((c) => c.shiftTypeIds.filter(isWorkingShift).map(codeOf).join("/")).join(" and ");
      msgs.push(`multiple ${dtag}hard requests to work different shifts (${opts}) — only one can be placed`);
    }
  }
  return msgs;
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

// Visual category for a request cell — drives the grid's border/letter color.
export type RequestCategory = "leave" | "restricted" | "want" | "off";

export function requestCategory(kind: RequestKind): RequestCategory {
  switch (kind) {
    case "LEAVE":
      return "leave";
    case "NEGATE_SHIFT":
      return "restricted";
    case "REQUEST_SHIFT":
      return "want";
    case "OFF":
      return "off";
  }
}

// Who may see a given request. Viewing OTHER staff's requests requires the
// `requests:view` permission. A viewer without it (e.g. Staff) sees only:
//   - their OWN requests (any status), and
//   - APPROVED requests of anyone (an approved request is honored as a real shift,
//     i.e. the published schedule — not "viewing a request").
// Others' PENDING asks are hidden. Pure so the schedule page can filter props
// server-side (never shipping hidden requests to the client) with test coverage.
export function isRequestVisibleToViewer(
  req: { status: RequestStatus | string; staffId: string },
  opts: { canViewAll: boolean; viewerStaffId: string | null }
): boolean {
  return opts.canViewAll || req.status === "approved" || req.staffId === opts.viewerStaffId;
}

export type CellRequestSummary = {
  category: RequestCategory | "mixed"; // box/letter color; "mixed" when categories differ
  label: string; // letters to show when there's a single request, else the count
  single: boolean; // exactly one request on the cell
  count: number;
  hasApproved: boolean; // at least one approved → solid box; else faint (all pending)
  // The cell's approval state, driving the box treatment in the grid overlay:
  //   "approved" — every request on the cell is approved (honored) → solid box
  //   "pending"  — every request still awaiting a decision → faint box
  //   "denied"   — every request was declined → struck rose box
  //   "mixed"    — the cell carries requests of differing states (e.g. one approved,
  //                one denied) → solid box, lean on the tooltip for the breakdown
  statusKind: "approved" | "pending" | "denied" | "mixed";
};

/** Collapse a cell's requests into the grid's visual summary (box color + label).
 *  A single request shows its letters (AL / OFF / ORC / ORC,ORL); multiple show a
 *  count. Returns null when there are no requests. Pure. */
export function summarizeCellRequests(
  reqs: Array<Pick<ScheduleRequestData, "kind" | "shiftTypeIds" | "leaveShiftTypeId" | "status">>,
  codeOf: (shiftTypeId: string) => string
): CellRequestSummary | null {
  if (reqs.length === 0) return null;

  const cats = new Set(reqs.map((r) => requestCategory(r.kind)));
  const category: RequestCategory | "mixed" = cats.size === 1 ? [...cats][0] : "mixed";
  const single = reqs.length === 1;
  const hasApproved = reqs.some((r) => r.status === "approved");

  // Collapse the cell's request statuses into one display state. "declined" reads as
  // "denied"; anything not approved/declined (i.e. pending) folds into "pending". A
  // cell with more than one distinct state is "mixed".
  const stateOf = (s: RequestStatus): "approved" | "pending" | "denied" =>
    s === "approved" ? "approved" : s === "declined" ? "denied" : "pending";
  const states = new Set(reqs.map((r) => stateOf(r.status)));
  const statusKind: "approved" | "pending" | "denied" | "mixed" =
    states.size === 1 ? [...states][0] : "mixed";

  let label: string;
  if (single) {
    const r = reqs[0];
    switch (r.kind) {
      case "LEAVE":
        label = r.leaveShiftTypeId ? codeOf(r.leaveShiftTypeId) : "LV";
        break;
      case "OFF":
        label = "OFF";
        break;
      case "NEGATE_SHIFT":
      case "REQUEST_SHIFT":
        label = r.shiftTypeIds.map(codeOf).join(",");
        break;
    }
  } else {
    label = String(reqs.length);
  }

  return { category, label, single, count: reqs.length, hasApproved, statusKind };
}

/** Does this staff have any approved request affecting `date`? (grid: show badge) */
export function hasActiveRequest(
  requests: ScheduleRequestData[],
  staffId: string,
  date: string
): boolean {
  return requestsForStaffDate(requests, staffId, date).length > 0;
}

/** Flag where a placed assignment contradicts an approved HARD request.
 *  `assignedShiftTypeId` is the shift placed in the cell (null = empty cell).
 *  `isOffShift` marks whether that shift is an off/non-working shift.
 *  `codeOf` resolves a shift id to its display code for human-readable messages. */
export function checkRequestConflict({
  requests,
  staffId,
  date,
  assignedShiftTypeId,
  isOffShift,
  codeOf,
}: {
  requests: ScheduleRequestData[];
  staffId: string;
  date: string;
  assignedShiftTypeId: string | null;
  isOffShift: boolean;
  codeOf: (shiftTypeId: string) => string;
}): RequestConflict[] {
  if (!assignedShiftTypeId) return [];
  const conflicts: RequestConflict[] = [];
  const working = !isOffShift;

  for (const r of requestsForStaffDate(requests, staffId, date)) {
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

// ---- Assignment ⇆ request reconciliation ---------------------------------
// A request is "satisfied" when the schedule already honors it. Approving a
// request and assigning a satisfying shift are two routes to the same state, so
// these helpers drive both the approve→place path and the assign→auto-approve
// path. checkRequestConflict (above) is the contradiction view; this is its
// mirror — the satisfaction view.

/** Inclusive list of "YYYY-MM-DD" dates from start to end (both literal dates). */
export function eachDateInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (cur.getTime() <= last.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Does the shift assigned on a single date satisfy this request for that date?
 *  `assignedShiftTypeId` is the cell's shift (null = blank). A blank cell never
 *  satisfies — nothing is scheduled yet, including for NEGATE/OFF.
 *   - LEAVE         → the requested leave shift is placed
 *   - OFF           → an off shift is placed
 *   - REQUEST_SHIFT → one of the wanted shifts is placed
 *   - NEGATE_SHIFT  → some shift is placed and it is NOT a negated one */
export function assignmentSatisfiesRequestOnDate(
  req: Pick<ScheduleRequestData, "kind" | "shiftTypeIds" | "leaveShiftTypeId">,
  assignedShiftTypeId: string | null,
  isOffShift: (shiftTypeId: string) => boolean
): boolean {
  if (!assignedShiftTypeId) return false;
  switch (req.kind) {
    case "LEAVE":
      return req.leaveShiftTypeId != null && assignedShiftTypeId === req.leaveShiftTypeId;
    case "OFF":
      return isOffShift(assignedShiftTypeId);
    case "REQUEST_SHIFT":
      return req.shiftTypeIds.includes(assignedShiftTypeId);
    case "NEGATE_SHIFT":
      return !req.shiftTypeIds.includes(assignedShiftTypeId);
  }
}

/** Is the request satisfied across its WHOLE inclusive date range? A multi-day
 *  request needs every covered day satisfied (one unsatisfied day → not yet).
 *  `assignedShiftOnDate` returns the cell's shift id for a date (null = blank). */
export function isRequestSatisfied(
  req: Pick<ScheduleRequestData, "kind" | "shiftTypeIds" | "leaveShiftTypeId" | "startDate" | "endDate">,
  assignedShiftOnDate: (date: string) => string | null,
  isOffShift: (shiftTypeId: string) => boolean
): boolean {
  for (const date of eachDateInclusive(req.startDate, req.endDate)) {
    if (!assignmentSatisfiesRequestOnDate(req, assignedShiftOnDate(date), isOffShift)) return false;
  }
  return true;
}

/** Of a placement-backed request's covered dates, the ones that BLOCK direct
 *  approval: a day that is LOCKED and whose current assignment does not already
 *  satisfy the request. Approval can neither place its shift (the cell is locked)
 *  nor lean on what's there, so the request can't be fully honoured — the
 *  scheduler must resolve these first (unlock the day, or place the shift
 *  manually). Returns [] when nothing blocks. Only meaningful for requests that
 *  resolve to one concrete shift; multi-option / NEGATE approvals place nothing
 *  and so a lock never blocks them. `cellAt(date)` → the covered day's cell, or
 *  null for a blank cell. Pure. */
export function lockedBlockingDates(
  req: Pick<ScheduleRequestData, "kind" | "shiftTypeIds" | "leaveShiftTypeId" | "startDate" | "endDate">,
  cellAt: (date: string) => { shiftTypeId: string | null; isLocked: boolean } | null,
  isOffShift: (shiftTypeId: string) => boolean
): string[] {
  const blocked: string[] = [];
  for (const date of eachDateInclusive(req.startDate, req.endDate)) {
    const cell = cellAt(date);
    if (!cell?.isLocked) continue;
    if (!assignmentSatisfiesRequestOnDate(req, cell.shiftTypeId, isOffShift)) blocked.push(date);
  }
  return blocked;
}

/** The single shift to place when a request is approved directly (no assignment
 *  exists yet), or null when the request doesn't resolve to one concrete shift:
 *   - LEAVE         → its leave shift
 *   - OFF           → the off shift (caller supplies its id, or null if none)
 *   - REQUEST_SHIFT → the sole wanted shift, only when exactly one is named
 *   - NEGATE_SHIFT  → null (an exclusion places nothing)
 *  A null result means "approve as a sticky override; let the scheduler assign". */
export function resolveRequestPlacement(
  req: Pick<ScheduleRequestData, "kind" | "shiftTypeIds" | "leaveShiftTypeId">,
  offShiftTypeId: string | null
): string | null {
  switch (req.kind) {
    case "LEAVE":
      return req.leaveShiftTypeId ?? null;
    case "OFF":
      return offShiftTypeId;
    case "REQUEST_SHIFT":
      return req.shiftTypeIds.length === 1 ? req.shiftTypeIds[0] : null;
    case "NEGATE_SHIFT":
      return null;
  }
}

/** Of `target`'s covered dates, the ones whose request-placed shift can be safely
 *  cleared when target is unapproved/declined/deleted — i.e. NOT also claimed by
 *  another still-approved request that resolves to the SAME shift. Without this,
 *  two requests mapping to one shift on overlapping days would let removing one
 *  yank the shift the other still relies on. `placement` is target's resolved
 *  shift (null → it placed nothing, so nothing to release). Pure. */
export function releasableDates(
  target: { startDate: string; endDate: string },
  placement: string | null,
  otherApproved: Array<Pick<ScheduleRequestData, "kind" | "shiftTypeIds" | "leaveShiftTypeId" | "startDate" | "endDate">>,
  offShiftTypeId: string | null
): string[] {
  if (!placement) return [];
  const claimed = new Set<string>();
  for (const o of otherApproved) {
    if (resolveRequestPlacement(o, offShiftTypeId) !== placement) continue;
    for (const d of eachDateInclusive(o.startDate, o.endDate)) claimed.add(d);
  }
  return eachDateInclusive(target.startDate, target.endDate).filter((d) => !claimed.has(d));
}

/** What reconciliation should do to one request given whether the schedule now
 *  satisfies it. The sole writer of derived approval state, shared by the sync
 *  helper so the rule is unit-testable:
 *   - pending & satisfied                    → "approve"  (becomes autoApproved)
 *   - approved & autoApproved & !satisfied   → "revert"   (back to pending)
 *   - everything else (incl. sticky approvals) → "none"
 *  `excludeRequestId` pins a request the caller is explicitly transitioning
 *  (e.g. a manual un-approve): it must NOT be re-derived in the same pass, or
 *  un-approving a still-satisfied request would instantly re-approve it. */
export type ApprovalAction = "approve" | "revert" | "none";
export function reconcileApprovalAction(
  req: { id: string; status: string; autoApproved: boolean },
  satisfied: boolean,
  opts: { excludeRequestId?: string | null } = {}
): ApprovalAction {
  if (opts.excludeRequestId && req.id === opts.excludeRequestId) return "none";
  if (req.status === "pending" && satisfied) return "approve";
  if (req.status === "approved" && req.autoApproved && !satisfied) return "revert";
  return "none";
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

// One staff over an (inclusive) date range — the picker groups the cell
// selection into these before building payloads.
export type RequestTarget = { staffId: string; startDate: string; endDate: string };

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
      staffId: t.staffId,
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

/** Group a flat cell selection into one target per staff, spanning that
 *  staff's earliest→latest selected date (drag-select a week ⇒ a range). */
export function groupCellsIntoTargets(
  cells: { staffId: string; date: string }[]
): RequestTarget[] {
  const byStaff = new Map<string, { min: string; max: string }>();
  for (const c of cells) {
    const cur = byStaff.get(c.staffId);
    if (!cur) byStaff.set(c.staffId, { min: c.date, max: c.date });
    else {
      if (c.date < cur.min) cur.min = c.date;
      if (c.date > cur.max) cur.max = c.date;
    }
  }
  return [...byStaff.entries()].map(([staffId, r]) => ({
    staffId,
    startDate: r.min,
    endDate: r.max,
  }));
}

// ---- Keyboard request entry ----------------------------------------------
// In the grid's "request mode" (and on the popup's Request tab) a single
// keystroke resolves to one shift type plus modifiers — Shift = avoid, Alt =
// soft. keysToRequestIntent maps that to PickerMarks carrying exactly ONE mark
// so it flows through buildRequestPayloads on the same path as a popup
// selection (one shared save path for keyboard + click). Returns null when no
// shift is resolved (unmapped letter) so the caller can no-op.
//
// Per-kind rules — only the forms the model can actually represent:
//   - OFF shift   → OFF;   Alt honored (soft);  Shift (avoid) is meaningless → dropped.
//   - LEAVE shift → LEAVE; hard only          → Shift AND Alt dropped (buildRequestPayloads also forces leave hard).
//   - work-like   → REQUEST_SHIFT (want) or, with Shift, NEGATE_SHIFT (avoid); Alt honored for either polarity.
// "work-like" = any shift that is neither the off shift nor category "leave"
// (so imported/other shifts request as work, matching how they'd be assigned).

export type RequestKeyShift = {
  id: string;
  category: string; // "work" | "leave" | "imported" | "other"
  isOffShift: boolean;
};

export type RequestKeyMods = {
  avoid: boolean; // Shift held → negative polarity
  soft: boolean; // Alt/Option held → soft strength
};

/** Map one request-mode keystroke (resolved shift + modifiers) to PickerMarks
 *  with a single mark, or null if no shift resolved. Pure. */
export function keysToRequestIntent(
  shift: RequestKeyShift | null | undefined,
  mods: RequestKeyMods
): PickerMarks | null {
  if (!shift) return null;
  const strength: RequestStrength = mods.soft ? "soft" : "hard";

  if (shift.isOffShift) {
    // OFF: Alt → soft honored; Shift has no "anti-off" form → dropped.
    return { shiftMarks: [], offStrength: strength, leaveShiftTypeIds: [] };
  }
  if (shift.category === "leave") {
    // LEAVE: hard-only, no negative form → both modifiers dropped.
    return { shiftMarks: [], offStrength: null, leaveShiftTypeIds: [shift.id] };
  }
  // Work-like shift: want vs avoid, soft honored for either.
  const polarity: MarkPolarity = mods.avoid ? "negate" : "accept";
  return {
    shiftMarks: [{ shiftTypeId: shift.id, polarity, strength }],
    offStrength: null,
    leaveShiftTypeIds: [],
  };
}

// Validated, normalized POST input for creating a request.
export type RequestInput = {
  staffId: string;
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

  const staffId = b.staffId;
  if (typeof staffId !== "string" || !staffId) return { error: "staffId required" };

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
      staffId,
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

// ---- Undo restore --------------------------------------------------------
// Restoring an undeleted request must recreate it VERBATIM (same id, status,
// approval stamp) so the undo stack stays id-stable. validateRestoreInput
// reuses validateRequestInput for the shared fields, then layers the identity
// (id) and the full lifecycle state a plain create can't carry.

export type RestoreRequestInput = RequestInput & {
  id: string;
  status: RequestStatus;
  autoApproved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  receivedAt: string | null;
  offStrategyOrder: string[]; // recreated verbatim (was validated at original create)
};

/** Pure validation for the restore endpoint. `id` is required (the original,
 *  freed by the prior delete) and `status` defaults to "pending"; the rest of
 *  the field rules are delegated to validateRequestInput. Pure. */
export function validateRestoreInput(
  body: unknown
): { error: string } | { value: RestoreRequestInput } {
  const b = (body ?? {}) as Record<string, unknown>;

  const id = b.id;
  if (typeof id !== "string" || !id) return { error: "id required" };

  const base = validateRequestInput(b);
  if ("error" in base) return base;

  const status = b.status ?? "pending";
  if (!REQUEST_STATUSES.includes(status as RequestStatus)) {
    return { error: `status must be one of ${REQUEST_STATUSES.join(", ")}` };
  }
  // ISO timestamps are stored verbatim; a malformed one is dropped to null
  // rather than rejected (the stamp is informational, not load-bearing).
  const isoOrNull = (v: unknown): string | null =>
    typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;

  return {
    value: {
      ...base.value,
      id,
      status: status as RequestStatus,
      autoApproved: b.autoApproved === true,
      approvedAt: isoOrNull(b.approvedAt),
      approvedBy: typeof b.approvedBy === "string" ? b.approvedBy : null,
      receivedAt: isoOrNull(b.receivedAt),
      // Restore of an already-validated order. Lenient parse (drops unknown/dup
      // tokens) so a crafted schedule:edit restore can't smuggle junk past the
      // strict-write invariant; a stored bad value still never blocks the undo.
      offStrategyOrder: parseOffStrategyOrder(b.offStrategyOrder),
    },
  };
}

// ---- Staff self-service -----------------------------------------------
// A staff entering their own request can't be trusted to set staffId or
// source — both are forced server-side from the authenticated session.

/** Validate a self-service request, forcing it to belong to `staffId` and the
 *  "staff" source regardless of what the client sent. Reuses validateRequestInput
 *  for all field rules. Pure. */
export function buildSelfRequestInput(
  body: unknown,
  staffId: string
): { error: string } | { value: RequestInput } {
  const b = (body ?? {}) as Record<string, unknown>;
  return validateRequestInput({ ...b, staffId, source: "staff" });
}

/** A staff may withdraw only their own request, and only while it is still
 *  pending (approved/declined/etc. are terminal for self-service). Pure. */
export function canWithdrawOwnRequest(
  request: { staffId: string; status: string } | null,
  staffId: string
): boolean {
  return !!request && request.staffId === staffId && request.status === "pending";
}

// ---- Leave queue feedback -------------------------------------------------
// "How many people already requested leave on this date, and where do I stand?"
// A request means "away" for queueing when it's a legacy OFF/LEAVE, OR a
// REQUEST_SHIFT that wants an off/leave ("away") shift — staff now ask for time
// off by requesting the Off/leave shift. Only live requests count (pending or
// approved — declined/withdrawn don't hold a slot). Ordering is first-come by
// receivedAt. Everything here is COUNTS ONLY — never the other staff' names.

const LEAVE_QUEUE_STATUSES: ReadonlySet<RequestStatus> = new Set<RequestStatus>(["pending", "approved"]);

export type LeaveQueueRequest = {
  staffId: string;
  startDate: string;
  endDate: string;
  kind: RequestKind;
  shiftTypeIds: string[]; // REQUEST_SHIFT: needed to tell an "away" ask from a work ask
  status: RequestStatus;
  receivedAt: string; // ISO — first-come ordering
};

export type LeaveQueueSummary = {
  peakDate: string; // the most-contended date in the requested range
  othersOnPeak: number; // # of OTHER staff already away on peakDate
  positionOnPeak: number; // this staff's 1-based queue position on peakDate (first-come)
};

function isLeaveQueueRow(r: LeaveQueueRequest, isAwayShift: (shiftTypeId: string) => boolean): boolean {
  if (!LEAVE_QUEUE_STATUSES.has(r.status)) return false;
  if (r.kind === "OFF" || r.kind === "LEAVE") return true; // legacy "away" kinds
  if (r.kind === "REQUEST_SHIFT") return r.shiftTypeIds.some(isAwayShift);
  return false; // NEGATE_SHIFT never holds a leave slot
}

/** Summarize the leave queue a staff faces over an inclusive [start,end] range.
 *  Reports the single most-contended date (most other staff away) and where
 *  this staff stands on it, first-come by receivedAt.
 *
 *  `receivedAtIso = null` means an as-yet-unsubmitted request: they queue last on
 *  every date (position = others + 1). For an existing request pass its receivedAt
 *  so earlier submitters rank ahead. Returns null when no date in the range has any
 *  other leave. Pure — counts only, never identities. */
export function summarizeLeaveQueue({
  requests,
  staffId,
  start,
  end,
  receivedAtIso,
  isAwayShift = () => false,
}: {
  requests: LeaveQueueRequest[];
  staffId: string;
  start: string;
  end: string;
  receivedAtIso: string | null;
  isAwayShift?: (shiftTypeId: string) => boolean;
}): LeaveQueueSummary | null {
  if (start > end) return null;
  const others = requests.filter((r) => r.staffId !== staffId && isLeaveQueueRow(r, isAwayShift));

  let best: LeaveQueueSummary | null = null;
  // Walk each date in the inclusive range (ISO date strings, lexical-safe).
  for (let d = start; d <= end; d = nextIsoDate(d)) {
    // Count distinct PROVIDERS away, not rows — one person with two overlapping
    // requests is still one person off. Track each staff's earliest covering
    // request so first-come ordering uses when they first got in line.
    const earliestByStaff = new Map<string, string>();
    for (const r of others) {
      if (!coversDate(r, d)) continue;
      const prev = earliestByStaff.get(r.staffId);
      if (prev === undefined || r.receivedAt < prev) earliestByStaff.set(r.staffId, r.receivedAt);
    }
    const othersOnPeak = earliestByStaff.size;
    if (othersOnPeak === 0) continue;
    // First-come: how many distinct staff got in line ahead of this one.
    const ahead = receivedAtIso === null
      ? othersOnPeak // a new request is last
      : [...earliestByStaff.values()].filter((ra) => ra < receivedAtIso).length;
    const candidate: LeaveQueueSummary = { peakDate: d, othersOnPeak, positionOnPeak: ahead + 1 };
    if (!best || candidate.othersOnPeak > best.othersOnPeak) best = candidate;
  }
  return best;
}

/** Next calendar date for a valid "YYYY-MM-DD" string (UTC-safe). */
function nextIsoDate(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
