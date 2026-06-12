import { describe, it, expect } from "vitest";
import {
  coversDate,
  requestsForStaffDate,
  foldRequestsForDate,
  hasActiveRequest,
  checkRequestConflict,
  describeRequest,
  isValidDateStr,
  validateRequestInput,
  buildRequestPayloads,
  groupCellsIntoTargets,
  requestCategory,
  summarizeCellRequests,
  buildSelfRequestInput,
  canWithdrawOwnRequest,
  summarizeLeaveQueue,
  eachDateInclusive,
  assignmentSatisfiesRequestOnDate,
  isRequestSatisfied,
  lockedBlockingDates,
  resolveRequestPlacement,
  reconcileApprovalAction,
  releasableDates,
  isRequestVisibleToViewer,
  isPendingRequestMode,
  parsePendingRequestMode,
  detectRequestConflicts,
  PENDING_REQUEST_MODES,
  DEFAULT_PENDING_REQUEST_MODE,
  type LeaveQueueRequest,
  type ScheduleRequestData,
} from "../schedule-requests";

// Shift ids → codes for readable conflict messages in tests.
const CODES: Record<string, string> = { orc: "ORC", orl: "ORL", al: "AL", call: "CALL", off: "OFF" };
const codeOf = (id: string) => CODES[id] ?? id;

// Builder with sensible defaults; override per test.
function req(p: Partial<ScheduleRequestData>): ScheduleRequestData {
  return {
    id: p.id ?? "r1",
    staffId: p.staffId ?? "P",
    startDate: p.startDate ?? "2026-07-04",
    endDate: p.endDate ?? p.startDate ?? "2026-07-04",
    kind: p.kind ?? "OFF",
    shiftTypeIds: p.shiftTypeIds ?? [],
    leaveShiftTypeId: p.leaveShiftTypeId ?? null,
    strength: p.strength ?? "hard",
    status: p.status ?? "approved",
  };
}

describe("coversDate", () => {
  it("includes both range endpoints (inclusive)", () => {
    const r = { startDate: "2026-08-01", endDate: "2026-08-05" };
    expect(coversDate(r, "2026-08-01")).toBe(true);
    expect(coversDate(r, "2026-08-05")).toBe(true);
    expect(coversDate(r, "2026-08-03")).toBe(true);
  });
  it("excludes dates outside the range", () => {
    const r = { startDate: "2026-08-01", endDate: "2026-08-05" };
    expect(coversDate(r, "2026-07-31")).toBe(false);
    expect(coversDate(r, "2026-08-06")).toBe(false);
  });
  it("handles single-date requests (start==end)", () => {
    const r = { startDate: "2026-07-04", endDate: "2026-07-04" };
    expect(coversDate(r, "2026-07-04")).toBe(true);
    expect(coversDate(r, "2026-07-05")).toBe(false);
  });
});

describe("requestsForStaffDate", () => {
  const reqs = [
    req({ id: "a", staffId: "P", startDate: "2026-07-04" }),
    req({ id: "b", staffId: "Q", startDate: "2026-07-04" }),
    req({ id: "c", staffId: "P", startDate: "2026-07-10" }),
    req({ id: "d", staffId: "P", startDate: "2026-07-04", status: "pending" }),
  ];
  it("returns only approved requests for the staff+date by default", () => {
    const r = requestsForStaffDate(reqs, "P", "2026-07-04");
    expect(r.map((x) => x.id)).toEqual(["a"]); // not b (other staff), c (other date), d (pending)
  });
  it("includes pending requests when asked (grid display)", () => {
    const r = requestsForStaffDate(reqs, "P", "2026-07-04", { includePending: true });
    expect(r.map((x) => x.id).sort()).toEqual(["a", "d"]);
  });

  it("never returns terminal statuses (declined/withdrawn/fulfilled), even with includePending", () => {
    const terminal = [
      req({ id: "x", status: "declined" }),
      req({ id: "y", status: "withdrawn" }),
      req({ id: "z", status: "fulfilled" }),
    ];
    expect(requestsForStaffDate(terminal, "P", "2026-07-04", { includePending: true })).toEqual([]);
    expect(requestsForStaffDate(terminal, "P", "2026-07-04")).toEqual([]);
  });
});

describe("foldRequestsForDate", () => {
  it("hard OFF forbids working; soft OFF only avoids", () => {
    const hard = foldRequestsForDate([req({ kind: "OFF", strength: "hard" })], "P", "2026-07-04");
    expect(hard.forbidWorking).toBe(true);
    expect(hard.avoidWorking).toBe(false);

    const soft = foldRequestsForDate([req({ kind: "OFF", strength: "soft" })], "P", "2026-07-04");
    expect(soft.forbidWorking).toBe(false);
    expect(soft.avoidWorking).toBe(true);
  });

  it("LEAVE sets leaveShiftTypeId (first approved wins)", () => {
    const folded = foldRequestsForDate(
      [
        req({ id: "x", kind: "LEAVE", leaveShiftTypeId: "al" }),
        req({ id: "y", kind: "LEAVE", leaveShiftTypeId: "call" }),
      ],
      "P",
      "2026-07-04"
    );
    expect(folded.leaveShiftTypeId).toBe("al");
  });

  it("NEGATE_SHIFT with multiple shift ids forbids all (hard) — 'no ORC or ORL'", () => {
    const folded = foldRequestsForDate(
      [req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc", "orl"] })],
      "P",
      "2026-07-04"
    );
    expect([...folded.forbiddenShiftIds].sort()).toEqual(["orc", "orl"]);
    expect(folded.avoidedShiftIds.size).toBe(0);
  });

  it("soft NEGATE_SHIFT down-weights instead of forbidding", () => {
    const folded = foldRequestsForDate(
      [req({ kind: "NEGATE_SHIFT", strength: "soft", shiftTypeIds: ["orc"] })],
      "P",
      "2026-07-04"
    );
    expect(folded.forbiddenShiftIds.size).toBe(0);
    expect([...folded.avoidedShiftIds]).toEqual(["orc"]);
  });

  it("REQUEST_SHIFT routes to forced (hard) vs preferred (soft)", () => {
    const hard = foldRequestsForDate(
      [req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"] })],
      "P",
      "2026-07-04"
    );
    expect([...hard.forcedShiftIds]).toEqual(["orc"]);

    const soft = foldRequestsForDate(
      [req({ kind: "REQUEST_SHIFT", strength: "soft", shiftTypeIds: ["call"] })],
      "P",
      "2026-07-04"
    );
    expect([...soft.preferredShiftIds]).toEqual(["call"]);
  });

  it("soft REQUEST_SHIFT for an away (off/leave) shift also sets avoidWorking (== old soft OFF)", () => {
    const isAway = (id: string) => id === "al" || id === "x";
    const soft = foldRequestsForDate(
      [req({ kind: "REQUEST_SHIFT", strength: "soft", shiftTypeIds: ["al"] })],
      "P", "2026-07-04", isAway
    );
    expect(soft.avoidWorking).toBe(true);
    expect([...soft.preferredShiftIds]).toEqual(["al"]);
  });

  it("soft REQUEST_SHIFT for work-only shifts does NOT set avoidWorking", () => {
    const isAway = (id: string) => id === "al" || id === "x";
    const soft = foldRequestsForDate(
      [req({ kind: "REQUEST_SHIFT", strength: "soft", shiftTypeIds: ["orc"] })],
      "P", "2026-07-04", isAway
    );
    expect(soft.avoidWorking).toBe(false);
    expect([...soft.preferredShiftIds]).toEqual(["orc"]);
  });

  it("soft mixed work+away ask: prefers both AND avoids working (net work-bias pin)", () => {
    // OR ask [ORC work + AL away]: requested work gets +1 (preferred) and -1 (avoidWorking)
    // = net 0, while non-requested work gets only -1 — so the requested work shift stays
    // favored over alternatives. Pins the intended OR behavior (see auto-scheduler requestBias).
    const isAway = (id: string) => id === "al";
    const soft = foldRequestsForDate(
      [req({ kind: "REQUEST_SHIFT", strength: "soft", shiftTypeIds: ["orc", "al"] })],
      "P", "2026-07-04", isAway
    );
    expect(soft.avoidWorking).toBe(true);
    expect([...soft.preferredShiftIds].sort()).toEqual(["al", "orc"]);
  });

  it("hard REQUEST_SHIFT with an away shift leaves avoidWorking false (placed authoritatively)", () => {
    const isAway = (id: string) => id === "al";
    const hard = foldRequestsForDate(
      [req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["al"] })],
      "P", "2026-07-04", isAway
    );
    expect(hard.avoidWorking).toBe(false);
    expect([...hard.forcedShiftIds]).toEqual(["al"]);
  });

  it("without an isAwayShift predicate, away detection defaults off (back-compat)", () => {
    const soft = foldRequestsForDate(
      [req({ kind: "REQUEST_SHIFT", strength: "soft", shiftTypeIds: ["al"] })],
      "P", "2026-07-04"
    );
    expect(soft.avoidWorking).toBe(false);
  });

  it("pending requests exert NO force (approval gate)", () => {
    const folded = foldRequestsForDate(
      [req({ kind: "OFF", strength: "hard", status: "pending" })],
      "P",
      "2026-07-04"
    );
    expect(folded.forbidWorking).toBe(false);
    expect(folded.requestIds).toEqual([]);
  });

  it("records contributing request ids", () => {
    const folded = foldRequestsForDate(
      [
        req({ id: "a", kind: "OFF" }),
        req({ id: "b", kind: "NEGATE_SHIFT", shiftTypeIds: ["orc"] }),
      ],
      "P",
      "2026-07-04"
    );
    expect(folded.requestIds.sort()).toEqual(["a", "b"]);
  });

  it("applies across a date range, not just the start", () => {
    const folded = foldRequestsForDate(
      [req({ kind: "OFF", startDate: "2026-08-01", endDate: "2026-08-05" })],
      "P",
      "2026-08-03"
    );
    expect(folded.forbidWorking).toBe(true);
  });
});

describe("describeRequest", () => {
  it("labels each kind, hard vs soft", () => {
    expect(describeRequest(req({ kind: "OFF" }), codeOf)).toBe("Off");
    expect(describeRequest(req({ kind: "OFF", strength: "soft" }), codeOf)).toBe("Prefers off");
    expect(describeRequest(req({ kind: "LEAVE", leaveShiftTypeId: "al" }), codeOf)).toBe("AL leave");
    expect(describeRequest(req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc", "orl"] }), codeOf)).toBe("No ORC, ORL");
    expect(describeRequest(req({ kind: "NEGATE_SHIFT", strength: "soft", shiftTypeIds: ["orc"] }), codeOf)).toBe("Avoid ORC");
    expect(describeRequest(req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["call"] }), codeOf)).toBe("Wants CALL");
    expect(describeRequest(req({ kind: "REQUEST_SHIFT", strength: "soft", shiftTypeIds: ["call"] }), codeOf)).toBe("Prefers CALL");
  });
  it("falls back to 'Leave' when leaveShiftTypeId is null", () => {
    expect(describeRequest(req({ kind: "LEAVE", leaveShiftTypeId: null }), codeOf)).toBe("Leave");
  });
});

describe("hasActiveRequest", () => {
  it("true only when an approved request covers the date", () => {
    const reqs = [req({ kind: "OFF" })];
    expect(hasActiveRequest(reqs, "P", "2026-07-04")).toBe(true);
    expect(hasActiveRequest(reqs, "P", "2026-07-05")).toBe(false);
  });
});

describe("checkRequestConflict", () => {
  const base = { staffId: "P", date: "2026-07-04", isOffShift: false, codeOf };

  it("no assignment → no conflict", () => {
    const c = checkRequestConflict({
      ...base,
      requests: [req({ kind: "OFF" })],
      assignedShiftTypeId: null,
    });
    expect(c).toEqual([]);
  });

  it("hard OFF + working shift → conflict", () => {
    const c = checkRequestConflict({
      ...base,
      requests: [req({ kind: "OFF" })],
      assignedShiftTypeId: "orc",
    });
    expect(c).toHaveLength(1);
    expect(c[0].message).toContain("Requested OFF");
    expect(c[0].message).toContain("ORC");
  });

  it("hard OFF + off-shift assignment → no conflict", () => {
    const c = checkRequestConflict({
      ...base,
      isOffShift: true,
      requests: [req({ kind: "OFF" })],
      assignedShiftTypeId: "al",
    });
    expect(c).toEqual([]);
  });

  it("soft OFF never conflicts", () => {
    const c = checkRequestConflict({
      ...base,
      requests: [req({ kind: "OFF", strength: "soft" })],
      assignedShiftTypeId: "orc",
    });
    expect(c).toEqual([]);
  });

  it("NEGATE_SHIFT conflicts only when the negated shift is assigned", () => {
    const reqs = [req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc", "orl"] })];
    const hit = checkRequestConflict({ ...base, requests: reqs, assignedShiftTypeId: "orl" });
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain("no ORL");

    const miss = checkRequestConflict({ ...base, requests: reqs, assignedShiftTypeId: "call" });
    expect(miss).toEqual([]);
  });

  it("LEAVE conflicts with a working shift that isn't the leave shift", () => {
    const reqs = [req({ kind: "LEAVE", leaveShiftTypeId: "al" })];
    const hit = checkRequestConflict({ ...base, requests: reqs, assignedShiftTypeId: "orc" });
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain("AL leave");

    // Placing the leave shift itself is fine.
    const ok = checkRequestConflict({
      ...base,
      isOffShift: true,
      requests: reqs,
      assignedShiftTypeId: "al",
    });
    expect(ok).toEqual([]);
  });

  it("LEAVE flags a DIFFERENT off/leave shift, not just working shifts", () => {
    // Requested AL leave but placed a different off-shift (OFF) — must still conflict.
    const reqs = [req({ kind: "LEAVE", leaveShiftTypeId: "al" })];
    const hit = checkRequestConflict({
      ...base,
      isOffShift: true,
      requests: reqs,
      assignedShiftTypeId: "off",
    });
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain("AL leave");
  });

  it("REQUEST_SHIFT conflicts when a different working shift is assigned", () => {
    const reqs = [req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"] })];
    const hit = checkRequestConflict({ ...base, requests: reqs, assignedShiftTypeId: "call" });
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain("Requested ORC");

    const ok = checkRequestConflict({ ...base, requests: reqs, assignedShiftTypeId: "orc" });
    expect(ok).toEqual([]);
  });

  it("REQUEST_SHIFT conflicts even when handed an off/leave shift", () => {
    // Wanted to work ORC but given OFF — still a conflict.
    const reqs = [req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"] })];
    const hit = checkRequestConflict({
      ...base,
      isOffShift: true,
      requests: reqs,
      assignedShiftTypeId: "off",
    });
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain("Requested ORC");
  });

  it("pending hard requests never conflict (approval gate)", () => {
    const c = checkRequestConflict({
      ...base,
      requests: [req({ kind: "OFF", status: "pending" })],
      assignedShiftTypeId: "orc",
    });
    expect(c).toEqual([]);
  });

  it("surfaces conflicts from multiple requests at once", () => {
    const reqs = [
      req({ id: "a", kind: "OFF" }),
      req({ id: "b", kind: "NEGATE_SHIFT", shiftTypeIds: ["orc"] }),
    ];
    const c = checkRequestConflict({ ...base, requests: reqs, assignedShiftTypeId: "orc" });
    expect(c.map((x) => x.requestId).sort()).toEqual(["a", "b"]);
  });
});

describe("isValidDateStr", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(isValidDateStr("2026-07-04")).toBe(true);
    expect(isValidDateStr("2026-02-28")).toBe(true);
    expect(isValidDateStr("2024-02-29")).toBe(true); // leap year
  });
  it("rejects malformed strings", () => {
    expect(isValidDateStr("2026-7-4")).toBe(false);
    expect(isValidDateStr("07/04/2026")).toBe(false);
    expect(isValidDateStr("nope")).toBe(false);
    expect(isValidDateStr("")).toBe(false);
    expect(isValidDateStr(20260704)).toBe(false);
    expect(isValidDateStr(null)).toBe(false);
    expect(isValidDateStr(undefined)).toBe(false);
  });
  it("rejects impossible dates JS would silently roll over", () => {
    expect(isValidDateStr("2026-02-31")).toBe(false); // would become Mar 3
    expect(isValidDateStr("2026-13-01")).toBe(false); // month 13
    expect(isValidDateStr("2026-00-10")).toBe(false); // month 0
    expect(isValidDateStr("2025-02-29")).toBe(false); // not a leap year
  });
});

describe("validateRequestInput", () => {
  const ok = {
    staffId: "P",
    startDate: "2026-07-04",
    endDate: "2026-07-04",
    kind: "OFF",
  };

  it("accepts a minimal valid OFF request and defaults strength/source", () => {
    const r = validateRequestInput(ok);
    expect("value" in r).toBe(true);
    if ("value" in r) {
      expect(r.value.strength).toBe("hard");
      expect(r.value.source).toBe("scheduler");
      expect(r.value.shiftTypeIds).toEqual([]);
      expect(r.value.leaveShiftTypeId).toBeNull();
    }
  });

  it("defaults endDate to startDate when omitted", () => {
    const r = validateRequestInput({ ...ok, endDate: undefined });
    expect("value" in r && r.value.endDate).toBe("2026-07-04");
  });

  it("rejects missing staffId", () => {
    expect(validateRequestInput({ ...ok, staffId: "" })).toEqual({ error: "staffId required" });
  });

  it("rejects malformed/impossible dates (no 500 reaches prisma)", () => {
    expect(validateRequestInput({ ...ok, startDate: "2026-02-31" })).toHaveProperty("error");
    expect(validateRequestInput({ ...ok, startDate: "7/4/2026" })).toHaveProperty("error");
    expect(validateRequestInput({ ...ok, endDate: "garbage" })).toHaveProperty("error");
  });

  it("rejects startDate after endDate", () => {
    const r = validateRequestInput({ ...ok, startDate: "2026-07-10", endDate: "2026-07-04" });
    expect(r).toHaveProperty("error");
  });

  it("rejects unknown kind/strength/source", () => {
    expect(validateRequestInput({ ...ok, kind: "VACATION" })).toHaveProperty("error");
    expect(validateRequestInput({ ...ok, strength: "kinda" })).toHaveProperty("error");
    expect(validateRequestInput({ ...ok, source: "carrier-pigeon" })).toHaveProperty("error");
  });

  it("requires shiftTypeIds for NEGATE_SHIFT / REQUEST_SHIFT", () => {
    expect(validateRequestInput({ ...ok, kind: "NEGATE_SHIFT", shiftTypeIds: [] })).toHaveProperty("error");
    const r = validateRequestInput({ ...ok, kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"] });
    expect("value" in r && r.value.shiftTypeIds).toEqual(["orc"]);
  });

  it("requires leaveShiftTypeId for LEAVE and drops irrelevant fields", () => {
    expect(validateRequestInput({ ...ok, kind: "LEAVE" })).toHaveProperty("error");
    const r = validateRequestInput({ ...ok, kind: "LEAVE", leaveShiftTypeId: "al", shiftTypeIds: ["orc"] });
    // shiftTypeIds not carried for LEAVE
    expect("value" in r && r.value.shiftTypeIds).toEqual([]);
    expect("value" in r && r.value.leaveShiftTypeId).toBe("al");
  });

  it("drops leaveShiftTypeId for non-LEAVE kinds", () => {
    const r = validateRequestInput({ ...ok, kind: "NEGATE_SHIFT", shiftTypeIds: ["orc"], leaveShiftTypeId: "al" });
    expect("value" in r && r.value.leaveShiftTypeId).toBeNull();
  });

  it("filters non-string entries out of shiftTypeIds", () => {
    const r = validateRequestInput({ ...ok, kind: "NEGATE_SHIFT", shiftTypeIds: ["orc", 5, null, "orl"] });
    expect("value" in r && r.value.shiftTypeIds).toEqual(["orc", "orl"]);
  });

  it("handles non-object body without throwing", () => {
    expect(validateRequestInput(null)).toHaveProperty("error");
    expect(validateRequestInput(undefined)).toHaveProperty("error");
    expect(validateRequestInput("string")).toHaveProperty("error");
  });
});

describe("groupCellsIntoTargets", () => {
  it("one target per staff spanning earliest→latest selected date", () => {
    const targets = groupCellsIntoTargets([
      { staffId: "P", date: "2026-07-06" },
      { staffId: "P", date: "2026-07-04" },
      { staffId: "P", date: "2026-07-08" },
      { staffId: "Q", date: "2026-07-05" },
    ]);
    expect(targets).toEqual([
      { staffId: "P", startDate: "2026-07-04", endDate: "2026-07-08" },
      { staffId: "Q", startDate: "2026-07-05", endDate: "2026-07-05" },
    ]);
  });
  it("single cell → single-date target", () => {
    expect(groupCellsIntoTargets([{ staffId: "P", date: "2026-07-04" }])).toEqual([
      { staffId: "P", startDate: "2026-07-04", endDate: "2026-07-04" },
    ]);
  });
});

describe("buildRequestPayloads", () => {
  const target = [{ staffId: "P", startDate: "2026-07-04", endDate: "2026-07-04" }];

  it("merges like-kind like-strength shift marks into one row", () => {
    const out = buildRequestPayloads(
      {
        shiftMarks: [
          { shiftTypeId: "orc", polarity: "negate", strength: "hard" },
          { shiftTypeId: "orl", polarity: "negate", strength: "hard" },
        ],
        offStrength: null,
        leaveShiftTypeIds: [],
      },
      target
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "NEGATE_SHIFT", strength: "hard", shiftTypeIds: ["orc", "orl"] });
  });

  it("splits by polarity and strength", () => {
    const out = buildRequestPayloads(
      {
        shiftMarks: [
          { shiftTypeId: "orc", polarity: "negate", strength: "hard" },
          { shiftTypeId: "orl", polarity: "negate", strength: "soft" },
          { shiftTypeId: "call", polarity: "accept", strength: "hard" },
          { shiftTypeId: "icu", polarity: "accept", strength: "soft" },
        ],
        offStrength: null,
        leaveShiftTypeIds: [],
      },
      target
    );
    const byKey = out.map((p) => `${p.kind}:${p.strength}:${p.shiftTypeIds.join(",")}`).sort();
    expect(byKey).toEqual([
      "NEGATE_SHIFT:hard:orc",
      "NEGATE_SHIFT:soft:orl",
      "REQUEST_SHIFT:hard:call",
      "REQUEST_SHIFT:soft:icu",
    ]);
  });

  it("emits OFF and one LEAVE per leave shift", () => {
    const out = buildRequestPayloads(
      { shiftMarks: [], offStrength: "hard", leaveShiftTypeIds: ["al", "sl"] },
      target
    );
    expect(out.filter((p) => p.kind === "OFF")).toHaveLength(1);
    const leaves = out.filter((p) => p.kind === "LEAVE");
    expect(leaves.map((l) => l.leaveShiftTypeId).sort()).toEqual(["al", "sl"]);
    expect(leaves.every((l) => l.strength === "hard")).toBe(true);
  });

  it("applies every mark to every target (multi-staff)", () => {
    const out = buildRequestPayloads(
      { shiftMarks: [{ shiftTypeId: "orc", polarity: "negate", strength: "hard" }], offStrength: null, leaveShiftTypeIds: [] },
      [
        { staffId: "P", startDate: "2026-07-04", endDate: "2026-07-04" },
        { staffId: "Q", startDate: "2026-07-05", endDate: "2026-07-06" },
      ]
    );
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.staffId).sort()).toEqual(["P", "Q"]);
    expect(out.find((p) => p.staffId === "Q")).toMatchObject({ startDate: "2026-07-05", endDate: "2026-07-06" });
  });

  it("empty marks → no payloads", () => {
    expect(buildRequestPayloads({ shiftMarks: [], offStrength: null, leaveShiftTypeIds: [] }, target)).toEqual([]);
  });

  it("payloads pass validateRequestInput", () => {
    const out = buildRequestPayloads(
      {
        shiftMarks: [{ shiftTypeId: "orc", polarity: "negate", strength: "hard" }],
        offStrength: "soft",
        leaveShiftTypeIds: ["al"],
      },
      target
    );
    for (const p of out) {
      expect(validateRequestInput(p)).toHaveProperty("value");
    }
  });
});

describe("requestCategory / summarizeCellRequests", () => {
  it("maps kind → category", () => {
    expect(requestCategory("LEAVE")).toBe("leave");
    expect(requestCategory("NEGATE_SHIFT")).toBe("restricted");
    expect(requestCategory("REQUEST_SHIFT")).toBe("want");
    expect(requestCategory("OFF")).toBe("off");
  });

  it("returns null for no requests", () => {
    expect(summarizeCellRequests([], codeOf)).toBeNull();
  });

  it("single LEAVE → leave color + leave code letters", () => {
    const s = summarizeCellRequests([req({ kind: "LEAVE", leaveShiftTypeId: "al" })], codeOf);
    expect(s).toMatchObject({ category: "leave", label: "AL", single: true, count: 1, hasApproved: true });
  });

  it("single OFF → off color + 'OFF'", () => {
    const s = summarizeCellRequests([req({ kind: "OFF" })], codeOf);
    expect(s).toMatchObject({ category: "off", label: "OFF" });
  });

  it("single NEGATE with multiple shifts → restricted color, joined codes", () => {
    const s = summarizeCellRequests([req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc", "orl"] })], codeOf);
    expect(s).toMatchObject({ category: "restricted", label: "ORC,ORL" });
  });

  it("single REQUEST_SHIFT → want color, shift code", () => {
    const s = summarizeCellRequests([req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["call"] })], codeOf);
    expect(s).toMatchObject({ category: "want", label: "CALL" });
  });

  it("multiple same-category requests → category kept, label is the count", () => {
    const s = summarizeCellRequests(
      [req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc"] }), req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orl"] })],
      codeOf
    );
    expect(s).toMatchObject({ category: "restricted", label: "2", single: false, count: 2 });
  });

  it("mixed categories → 'mixed' + count", () => {
    const s = summarizeCellRequests(
      [req({ kind: "LEAVE", leaveShiftTypeId: "al" }), req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc"] })],
      codeOf
    );
    expect(s).toMatchObject({ category: "mixed", label: "2" });
  });

  it("hasApproved false when all pending", () => {
    const s = summarizeCellRequests([req({ kind: "OFF", status: "pending" })], codeOf);
    expect(s?.hasApproved).toBe(false);
  });
});

describe("buildSelfRequestInput", () => {
  it("forces staffId and source=staff, ignoring spoofed client values", () => {
    const out = buildSelfRequestInput(
      { staffId: "someone-else", source: "scheduler", startDate: "2026-07-01", kind: "OFF" },
      "me"
    );
    expect("value" in out).toBe(true);
    if ("value" in out) {
      expect(out.value.staffId).toBe("me");
      expect(out.value.source).toBe("staff");
    }
  });

  it("still applies field validation (bad kind rejected)", () => {
    const out = buildSelfRequestInput({ startDate: "2026-07-01", kind: "NONSENSE" }, "me");
    expect("error" in out).toBe(true);
  });

  it("validates kind-specific fields (LEAVE needs a leave shift)", () => {
    const out = buildSelfRequestInput({ startDate: "2026-07-01", kind: "LEAVE" }, "me");
    expect("error" in out).toBe(true);
  });
});

describe("canWithdrawOwnRequest", () => {
  it("allows withdrawing your own pending request", () => {
    expect(canWithdrawOwnRequest({ staffId: "me", status: "pending" }, "me")).toBe(true);
  });
  it("rejects another staff's request", () => {
    expect(canWithdrawOwnRequest({ staffId: "other", status: "pending" }, "me")).toBe(false);
  });
  it("rejects a non-pending (already approved/declined) request", () => {
    expect(canWithdrawOwnRequest({ staffId: "me", status: "approved" }, "me")).toBe(false);
    expect(canWithdrawOwnRequest({ staffId: "me", status: "declined" }, "me")).toBe(false);
  });
  it("rejects a missing request", () => {
    expect(canWithdrawOwnRequest(null, "me")).toBe(false);
  });
});

describe("summarizeLeaveQueue", () => {
  function lr(o: Partial<LeaveQueueRequest> & { staffId: string; startDate: string; endDate: string }): LeaveQueueRequest {
    return { kind: "LEAVE", shiftTypeIds: [], status: "approved", receivedAt: "2026-06-01T00:00:00.000Z", ...o };
  }

  it("returns null when nobody else is away in the range", () => {
    const out = summarizeLeaveQueue({
      requests: [lr({ staffId: "me", startDate: "2026-07-03", endDate: "2026-07-03" })],
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    expect(out).toBeNull();
  });

  it("counts other staff' OFF and LEAVE, not the caller's own", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03", kind: "OFF" }),
        lr({ staffId: "b", startDate: "2026-07-03", endDate: "2026-07-03", kind: "LEAVE" }),
        lr({ staffId: "me", startDate: "2026-07-03", endDate: "2026-07-03" }),
      ],
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    expect(out?.othersOnPeak).toBe(2);
  });

  it("counts a REQUEST_SHIFT that covers an away (off/leave) shift — the new consolidated form", () => {
    const isAwayShift = (id: string) => id === "al" || id === "x";
    const out = summarizeLeaveQueue({
      requests: [
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03", kind: "REQUEST_SHIFT", shiftTypeIds: ["al"] }),
        lr({ staffId: "b", startDate: "2026-07-03", endDate: "2026-07-03", kind: "REQUEST_SHIFT", shiftTypeIds: ["x", "or"] }),
        lr({ staffId: "me", startDate: "2026-07-03", endDate: "2026-07-03" }),
      ],
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null, isAwayShift,
    });
    expect(out?.othersOnPeak).toBe(2);
  });

  it("does NOT count a REQUEST_SHIFT for work-only shifts as away", () => {
    const isAwayShift = (id: string) => id === "al";
    const out = summarizeLeaveQueue({
      requests: [
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03", kind: "REQUEST_SHIFT", shiftTypeIds: ["or", "orc"] }),
      ],
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null, isAwayShift,
    });
    expect(out).toBeNull();
  });

  it("ignores non-leave kinds and inactive statuses", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03", kind: "NEGATE_SHIFT" }),
        lr({ staffId: "b", startDate: "2026-07-03", endDate: "2026-07-03", status: "declined" }),
        lr({ staffId: "c", startDate: "2026-07-03", endDate: "2026-07-03", status: "withdrawn" }),
      ],
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    expect(out).toBeNull();
  });

  it("a new request queues last (position = others + 1)", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03" }),
        lr({ staffId: "b", startDate: "2026-07-03", endDate: "2026-07-03" }),
      ],
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    expect(out).toEqual({ peakDate: "2026-07-03", othersOnPeak: 2, positionOnPeak: 3 });
  });

  it("an existing request ranks first-come by receivedAt", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03", receivedAt: "2026-06-01T00:00:00.000Z" }),
        lr({ staffId: "b", startDate: "2026-07-03", endDate: "2026-07-03", receivedAt: "2026-06-10T00:00:00.000Z" }),
      ],
      // mine arrived between a and b → I'm #2 of 3
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: "2026-06-05T00:00:00.000Z",
    });
    expect(out?.positionOnPeak).toBe(2);
    expect(out?.othersOnPeak).toBe(2);
  });

  it("counts distinct staff, not rows (duplicate overlapping requests = one person)", () => {
    const out = summarizeLeaveQueue({
      requests: [
        // staff a has TWO overlapping leave rows on the same date
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03", receivedAt: "2026-06-02T00:00:00.000Z" }),
        lr({ staffId: "a", startDate: "2026-07-01", endDate: "2026-07-05", kind: "OFF", receivedAt: "2026-06-08T00:00:00.000Z" }),
        lr({ staffId: "b", startDate: "2026-07-03", endDate: "2026-07-03", receivedAt: "2026-06-04T00:00:00.000Z" }),
      ],
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    // a (counted once) + b = 2 distinct others, so a new request is #3 — not #4.
    expect(out?.othersOnPeak).toBe(2);
    expect(out?.positionOnPeak).toBe(3);
  });

  it("ranks first-come by a staff's EARLIEST request when they have several", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03", receivedAt: "2026-06-10T00:00:00.000Z" }),
        lr({ staffId: "a", startDate: "2026-07-03", endDate: "2026-07-03", receivedAt: "2026-06-01T00:00:00.000Z" }),
      ],
      // a's earliest is 06-01 (before mine 06-05) → a is ahead → I'm #2
      staffId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: "2026-06-05T00:00:00.000Z",
    });
    expect(out?.othersOnPeak).toBe(1);
    expect(out?.positionOnPeak).toBe(2);
  });

  it("reports the most-contended date across a range", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ staffId: "a", startDate: "2026-07-01", endDate: "2026-07-05" }), // covers whole range
        lr({ staffId: "b", startDate: "2026-07-03", endDate: "2026-07-03" }), // adds to the 3rd
        lr({ staffId: "c", startDate: "2026-07-03", endDate: "2026-07-04" }),
      ],
      staffId: "me", start: "2026-07-01", end: "2026-07-05", receivedAtIso: null,
    });
    // 07-03 has a, b, c = 3 others (the peak)
    expect(out?.peakDate).toBe("2026-07-03");
    expect(out?.othersOnPeak).toBe(3);
  });
});

// ---- Assignment ⇆ request reconciliation ---------------------------------

const isOff = (id: string) => id === "off";

describe("eachDateInclusive", () => {
  it("returns a single date when start == end", () => {
    expect(eachDateInclusive("2026-08-03", "2026-08-03")).toEqual(["2026-08-03"]);
  });
  it("includes both endpoints and every day between", () => {
    expect(eachDateInclusive("2026-08-30", "2026-09-02")).toEqual([
      "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02",
    ]);
  });
  it("returns empty when end precedes start", () => {
    expect(eachDateInclusive("2026-08-05", "2026-08-01")).toEqual([]);
  });
});

describe("assignmentSatisfiesRequestOnDate", () => {
  it("a blank cell never satisfies any kind", () => {
    for (const kind of ["OFF", "LEAVE", "REQUEST_SHIFT", "NEGATE_SHIFT"] as const) {
      const r = req({ kind, shiftTypeIds: ["orc"], leaveShiftTypeId: "al" });
      expect(assignmentSatisfiesRequestOnDate(r, null, isOff)).toBe(false);
    }
  });

  it("LEAVE: satisfied only by the requested leave shift", () => {
    const r = req({ kind: "LEAVE", leaveShiftTypeId: "al" });
    expect(assignmentSatisfiesRequestOnDate(r, "al", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(r, "orc", isOff)).toBe(false);
    expect(assignmentSatisfiesRequestOnDate(r, "off", isOff)).toBe(false);
  });

  it("OFF: satisfied by any off shift, not by a working shift", () => {
    const r = req({ kind: "OFF" });
    expect(assignmentSatisfiesRequestOnDate(r, "off", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(r, "orc", isOff)).toBe(false);
  });

  it("REQUEST_SHIFT: satisfied when the assigned shift is one of the wanted", () => {
    const r = req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["ild", "al"] });
    expect(assignmentSatisfiesRequestOnDate(r, "ild", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(r, "al", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(r, "orc", isOff)).toBe(false);
  });

  it("NEGATE_SHIFT: satisfied by any placed shift that is not negated", () => {
    const r = req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc", "orl"] });
    expect(assignmentSatisfiesRequestOnDate(r, "ild", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(r, "off", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(r, "orc", isOff)).toBe(false);
    expect(assignmentSatisfiesRequestOnDate(r, "orl", isOff)).toBe(false);
  });

  it("the user's example: assigning ILD satisfies both 'ILD or AL' and 'no ORC/ORL'", () => {
    const want = req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["ild", "al"] });
    const negate = req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc", "orl"] });
    expect(assignmentSatisfiesRequestOnDate(want, "ild", isOff)).toBe(true);
    expect(assignmentSatisfiesRequestOnDate(negate, "ild", isOff)).toBe(true);
  });
});

describe("isRequestSatisfied (multi-day = all days)", () => {
  const assigned = (m: Record<string, string>) => (d: string) => m[d] ?? null;

  it("single-day satisfied", () => {
    const r = req({ kind: "LEAVE", leaveShiftTypeId: "al", startDate: "2026-08-01", endDate: "2026-08-01" });
    expect(isRequestSatisfied(r, assigned({ "2026-08-01": "al" }), isOff)).toBe(true);
  });

  it("multi-day satisfied only when EVERY covered day is satisfied", () => {
    const r = req({ kind: "LEAVE", leaveShiftTypeId: "al", startDate: "2026-08-01", endDate: "2026-08-03" });
    const full = { "2026-08-01": "al", "2026-08-02": "al", "2026-08-03": "al" };
    expect(isRequestSatisfied(r, assigned(full), isOff)).toBe(true);
    // one day missing → not satisfied
    expect(isRequestSatisfied(r, assigned({ "2026-08-01": "al", "2026-08-03": "al" }), isOff)).toBe(false);
    // one day wrong shift → not satisfied
    expect(isRequestSatisfied(r, assigned({ ...full, "2026-08-02": "orc" }), isOff)).toBe(false);
  });
});

describe("lockedBlockingDates", () => {
  // cell map: date → { shiftTypeId, isLocked }; missing date = blank cell (null)
  const cells = (m: Record<string, { shiftTypeId: string | null; isLocked: boolean }>) =>
    (d: string) => m[d] ?? null;

  it("no locked days → nothing blocks", () => {
    const r = req({ kind: "LEAVE", leaveShiftTypeId: "al", startDate: "2026-08-01", endDate: "2026-08-03" });
    expect(lockedBlockingDates(r, cells({ "2026-08-02": { shiftTypeId: "orc", isLocked: false } }), isOff)).toEqual([]);
  });

  it("locked day that does NOT satisfy → blocks", () => {
    const r = req({ kind: "LEAVE", leaveShiftTypeId: "al", startDate: "2026-08-01", endDate: "2026-08-01" });
    expect(lockedBlockingDates(r, cells({ "2026-08-01": { shiftTypeId: "orc", isLocked: true } }), isOff)).toEqual(["2026-08-01"]);
  });

  it("locked blank cell → blocks (nothing there to satisfy)", () => {
    const r = req({ kind: "LEAVE", leaveShiftTypeId: "al", startDate: "2026-08-01", endDate: "2026-08-01" });
    expect(lockedBlockingDates(r, cells({ "2026-08-01": { shiftTypeId: null, isLocked: true } }), isOff)).toEqual(["2026-08-01"]);
  });

  it("locked day that ALREADY satisfies the request → does not block", () => {
    const r = req({ kind: "LEAVE", leaveShiftTypeId: "al", startDate: "2026-08-01", endDate: "2026-08-01" });
    expect(lockedBlockingDates(r, cells({ "2026-08-01": { shiftTypeId: "al", isLocked: true } }), isOff)).toEqual([]);
  });

  it("OFF request: locked off-cell satisfies, locked working-cell blocks", () => {
    const r = req({ kind: "OFF", startDate: "2026-08-01", endDate: "2026-08-02" });
    const m = { "2026-08-01": { shiftTypeId: "off", isLocked: true }, "2026-08-02": { shiftTypeId: "orc", isLocked: true } };
    expect(lockedBlockingDates(r, cells(m), isOff)).toEqual(["2026-08-02"]);
  });

  it("multi-day: only the unsatisfied locked days are returned, in order", () => {
    const r = req({ kind: "LEAVE", leaveShiftTypeId: "al", startDate: "2026-08-01", endDate: "2026-08-03" });
    const m = {
      "2026-08-01": { shiftTypeId: "al", isLocked: true },   // locked + satisfies → ok
      "2026-08-02": { shiftTypeId: "orc", isLocked: true },  // locked + wrong → blocks
      "2026-08-03": { shiftTypeId: "orc", isLocked: false },  // unlocked → placeable, not a blocker
    };
    expect(lockedBlockingDates(r, cells(m), isOff)).toEqual(["2026-08-02"]);
  });

  it("NEGATE request: locked day blocks only when its shift is in the negated set", () => {
    const r = req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc", "orl"], startDate: "2026-08-01", endDate: "2026-08-02" });
    const m = {
      "2026-08-01": { shiftTypeId: "orc", isLocked: true },  // negated shift locked in → blocks
      "2026-08-02": { shiftTypeId: "call", isLocked: true },  // allowed shift → satisfies, ok
    };
    expect(lockedBlockingDates(r, cells(m), isOff)).toEqual(["2026-08-01"]);
  });
});

describe("resolveRequestPlacement", () => {
  it("LEAVE → its leave shift", () => {
    expect(resolveRequestPlacement(req({ kind: "LEAVE", leaveShiftTypeId: "ild" }), "off")).toBe("ild");
  });
  it("OFF → the supplied off shift id (or null when none defined)", () => {
    expect(resolveRequestPlacement(req({ kind: "OFF" }), "off")).toBe("off");
    expect(resolveRequestPlacement(req({ kind: "OFF" }), null)).toBe(null);
  });
  it("REQUEST_SHIFT → the sole option, null when ambiguous", () => {
    expect(resolveRequestPlacement(req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["ild"] }), "off")).toBe("ild");
    expect(resolveRequestPlacement(req({ kind: "REQUEST_SHIFT", shiftTypeIds: ["ild", "al"] }), "off")).toBe(null);
  });
  it("NEGATE_SHIFT → null (places nothing)", () => {
    expect(resolveRequestPlacement(req({ kind: "NEGATE_SHIFT", shiftTypeIds: ["orc"] }), "off")).toBe(null);
  });
});

describe("reconcileApprovalAction", () => {
  const row = (o: { id?: string; status: string; autoApproved?: boolean }) => ({
    id: o.id ?? "r1", status: o.status, autoApproved: o.autoApproved ?? false,
  });

  it("approves a pending request once satisfied", () => {
    expect(reconcileApprovalAction(row({ status: "pending" }), true)).toBe("approve");
    expect(reconcileApprovalAction(row({ status: "pending" }), false)).toBe("none");
  });

  it("reverts an auto-approval that is no longer satisfied", () => {
    expect(reconcileApprovalAction(row({ status: "approved", autoApproved: true }), false)).toBe("revert");
    expect(reconcileApprovalAction(row({ status: "approved", autoApproved: true }), true)).toBe("none");
  });

  it("never reverts a sticky (manual) approval", () => {
    expect(reconcileApprovalAction(row({ status: "approved", autoApproved: false }), false)).toBe("none");
  });

  it("leaves terminal states alone", () => {
    for (const status of ["declined", "withdrawn", "fulfilled"]) {
      expect(reconcileApprovalAction(row({ status }), true)).toBe("none");
    }
  });

  it("regression: the explicitly-transitioned request is excluded, so a manual " +
     "un-approve of a still-satisfied request is NOT instantly re-approved", () => {
    // request "r1" was just set to pending by the user; its cell still has a
    // satisfying shift. Without the exclusion this returns "approve" → instant
    // re-approval (the CRITICAL bug). With it, the manual transition stands.
    expect(reconcileApprovalAction(row({ id: "r1", status: "pending" }), true)).toBe("approve");
    expect(reconcileApprovalAction(row({ id: "r1", status: "pending" }), true, { excludeRequestId: "r1" })).toBe("none");
    // a DIFFERENT request on the same cell is still reconciled normally
    expect(reconcileApprovalAction(row({ id: "r2", status: "pending" }), true, { excludeRequestId: "r1" })).toBe("approve");
  });
});

describe("releasableDates", () => {
  it("releases every covered date when no other approved request claims the shift", () => {
    const target = { startDate: "2026-08-01", endDate: "2026-08-03" };
    expect(releasableDates(target, "ild", [], "off")).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  it("releases nothing when the request placed nothing", () => {
    expect(releasableDates({ startDate: "2026-08-01", endDate: "2026-08-03" }, null, [], "off")).toEqual([]);
  });

  it("regression: a date shared with another approved same-shift request is NOT released", () => {
    // Two ILD leaves: target covers 08-01..08-03, other covers 08-03..08-05. Both
    // placed ILD on 08-03 (one shared assignment). Releasing target must keep 08-03
    // because the other approved leave still relies on it.
    const target = { startDate: "2026-08-01", endDate: "2026-08-03" };
    const other = req({ kind: "LEAVE", leaveShiftTypeId: "ild", startDate: "2026-08-03", endDate: "2026-08-05" });
    expect(releasableDates(target, "ild", [other], "off")).toEqual(["2026-08-01", "2026-08-02"]);
  });

  it("ignores other approved requests that resolve to a DIFFERENT shift", () => {
    const target = { startDate: "2026-08-01", endDate: "2026-08-02" };
    const otherAL = req({ kind: "LEAVE", leaveShiftTypeId: "al", startDate: "2026-08-01", endDate: "2026-08-02" });
    expect(releasableDates(target, "ild", [otherAL], "off")).toEqual(["2026-08-01", "2026-08-02"]);
  });

  it("an OFF request claims its dates against another OFF removal (off shift id)", () => {
    const target = { startDate: "2026-08-01", endDate: "2026-08-01" };
    const otherOff = req({ kind: "OFF", startDate: "2026-08-01", endDate: "2026-08-01" });
    expect(releasableDates(target, "off", [otherOff], "off")).toEqual([]);
  });
});

describe("isRequestVisibleToViewer", () => {
  // requests:view holders see everything, regardless of owner or status.
  it("shows all requests to a viewer with requests:view", () => {
    const opts = { canViewAll: true, viewerStaffId: "me" };
    expect(isRequestVisibleToViewer(req({ staffId: "other", status: "pending" }), opts)).toBe(true);
    expect(isRequestVisibleToViewer(req({ staffId: "other", status: "approved" }), opts)).toBe(true);
  });

  // Without requests:view: only own requests + anyone's approved requests.
  it("hides OTHER staff's pending requests from a viewer without requests:view", () => {
    const opts = { canViewAll: false, viewerStaffId: "me" };
    expect(isRequestVisibleToViewer(req({ staffId: "other", status: "pending" }), opts)).toBe(false);
    expect(isRequestVisibleToViewer(req({ staffId: "other", status: "declined" }), opts)).toBe(false);
    expect(isRequestVisibleToViewer(req({ staffId: "other", status: "withdrawn" }), opts)).toBe(false);
  });

  it("shows the viewer's OWN requests of any status without requests:view", () => {
    const opts = { canViewAll: false, viewerStaffId: "me" };
    expect(isRequestVisibleToViewer(req({ staffId: "me", status: "pending" }), opts)).toBe(true);
    expect(isRequestVisibleToViewer(req({ staffId: "me", status: "declined" }), opts)).toBe(true);
  });

  it("shows anyone's APPROVED requests without requests:view (honored as real shifts)", () => {
    const opts = { canViewAll: false, viewerStaffId: "me" };
    expect(isRequestVisibleToViewer(req({ staffId: "other", status: "approved" }), opts)).toBe(true);
  });

  it("a viewer not linked to any staff (null) sees only approved requests without requests:view", () => {
    const opts = { canViewAll: false, viewerStaffId: null };
    expect(isRequestVisibleToViewer(req({ staffId: "other", status: "approved" }), opts)).toBe(true);
    expect(isRequestVisibleToViewer(req({ staffId: "other", status: "pending" }), opts)).toBe(false);
  });
});

describe("pendingRequestMode parsing", () => {
  it("isPendingRequestMode accepts only the three valid modes (strict, for writes)", () => {
    for (const m of PENDING_REQUEST_MODES) expect(isPendingRequestMode(m)).toBe(true);
    for (const bad of ["", "FULL", "none", "approved", null, undefined, 1, {}]) {
      expect(isPendingRequestMode(bad)).toBe(false);
    }
  });

  it("parsePendingRequestMode is lenient (for reads): unknown/null → default", () => {
    expect(DEFAULT_PENDING_REQUEST_MODE).toBe("full");
    expect(parsePendingRequestMode("off")).toBe("off");
    expect(parsePendingRequestMode("soft")).toBe("soft");
    expect(parsePendingRequestMode("full")).toBe("full");
    expect(parsePendingRequestMode("garbage")).toBe("full");
    expect(parsePendingRequestMode(null)).toBe("full");
    expect(parsePendingRequestMode(undefined)).toBe("full");
  });
});

describe("foldRequestsForDate — pendingRequestMode", () => {
  const pendingHardOff = () => req({ id: "p1", kind: "OFF", strength: "hard", status: "pending" });
  const pendingHardWant = () =>
    req({ id: "p2", kind: "REQUEST_SHIFT", strength: "hard", status: "pending", shiftTypeIds: ["orc"] });

  it("off mode (default): pending exerts no force, contributes nothing", () => {
    const folded = foldRequestsForDate([pendingHardOff(), pendingHardWant()], "P", "2026-07-04");
    expect(folded.forbidWorking).toBe(false);
    expect([...folded.forcedShiftIds]).toEqual([]);
    expect(folded.contributing).toHaveLength(0);
  });

  it("full mode: pending hard applies at declared strength (forbidWorking + forced)", () => {
    const folded = foldRequestsForDate([pendingHardOff(), pendingHardWant()], "P", "2026-07-04", () => false, "full");
    expect(folded.forbidWorking).toBe(true);
    expect([...folded.forcedShiftIds]).toEqual(["orc"]);
    // provenance records EFFECTIVE strength = hard and the pending status
    expect(folded.contributing.map((c) => [c.id, c.status, c.effective])).toEqual([
      ["p1", "pending", "hard"],
      ["p2", "pending", "hard"],
    ]);
  });

  it("soft mode: pending hard is DOWNGRADED to soft (avoidWorking + preferred, no hard buckets)", () => {
    const folded = foldRequestsForDate([pendingHardOff(), pendingHardWant()], "P", "2026-07-04", () => false, "soft");
    expect(folded.forbidWorking).toBe(false);
    expect(folded.avoidWorking).toBe(true);
    expect([...folded.forcedShiftIds]).toEqual([]);
    expect([...folded.preferredShiftIds]).toEqual(["orc"]);
    expect(folded.contributing.every((c) => c.effective === "soft")).toBe(true);
    // declared strength is preserved for audit even though effective was downgraded
    expect(folded.contributing.map((c) => c.declaredStrength)).toEqual(["hard", "hard"]);
  });

  it("APPROVED requests keep declared strength even in soft mode (only pending downgrades)", () => {
    const approvedHardOff = req({ kind: "OFF", strength: "hard", status: "approved" });
    const folded = foldRequestsForDate([approvedHardOff], "P", "2026-07-04", () => false, "soft");
    expect(folded.forbidWorking).toBe(true);
    expect(folded.contributing[0].effective).toBe("hard");
  });

  it("soft mode: a pending LEAVE does NOT authoritatively pre-place — becomes preferred + avoidWorking", () => {
    const pendingLeave = req({ kind: "LEAVE", strength: "hard", status: "pending", leaveShiftTypeId: "al" });
    const folded = foldRequestsForDate([pendingLeave], "P", "2026-07-04", (id) => id === "al", "soft");
    expect(folded.leaveShiftTypeId).toBeNull();
    expect([...folded.preferredShiftIds]).toEqual(["al"]);
    expect(folded.avoidWorking).toBe(true);
  });

  it("full mode: a pending LEAVE pre-places like an approved one", () => {
    const pendingLeave = req({ kind: "LEAVE", strength: "hard", status: "pending", leaveShiftTypeId: "al" });
    const folded = foldRequestsForDate([pendingLeave], "P", "2026-07-04", () => false, "full");
    expect(folded.leaveShiftTypeId).toBe("al");
  });
});

describe("detectRequestConflicts", () => {
  const isWorking = (id: string) => id !== "off" && id !== "al";

  it("flags a hard OFF together with a hard request to work", () => {
    const folded = foldRequestsForDate(
      [req({ id: "a", kind: "OFF", strength: "hard" }), req({ id: "b", kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["orc"] })],
      "P", "2026-07-04", () => false, "full",
    );
    const msgs = detectRequestConflicts(folded, isWorking, codeOf);
    expect(msgs.some((m) => m.includes("hard OFF") && m.includes("ORC"))).toBe(true);
  });

  it("flags the same shift both requested and hard-excluded", () => {
    const folded = foldRequestsForDate(
      [req({ id: "a", kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["orc"] }), req({ id: "b", kind: "NEGATE_SHIFT", strength: "hard", shiftTypeIds: ["orc"] })],
      "P", "2026-07-04", () => false, "full",
    );
    const msgs = detectRequestConflicts(folded, isWorking, codeOf);
    expect(msgs.some((m) => m.includes("ORC") && m.includes("exclude"))).toBe(true);
  });

  it("flags a hard leave together with a hard request to work", () => {
    const folded = foldRequestsForDate(
      [req({ id: "a", kind: "LEAVE", strength: "hard", leaveShiftTypeId: "al" }), req({ id: "b", kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["orc"] })],
      "P", "2026-07-04", () => false, "full",
    );
    const msgs = detectRequestConflicts(folded, isWorking, codeOf);
    expect(msgs.some((m) => m.includes("leave") && m.includes("ORC"))).toBe(true);
  });

  it("phrases the conflict as 'pending' when a pending request drives a hard bucket", () => {
    const folded = foldRequestsForDate(
      [req({ id: "a", kind: "OFF", strength: "hard", status: "approved" }), req({ id: "b", kind: "REQUEST_SHIFT", strength: "hard", status: "pending", shiftTypeIds: ["orc"] })],
      "P", "2026-07-04", () => false, "full",
    );
    const msgs = detectRequestConflicts(folded, isWorking, codeOf);
    expect(msgs.some((m) => m.includes("pending"))).toBe(true);
  });

  it("a downgraded pending-soft request raises NO hard conflict (effective strength)", () => {
    // In soft mode the pending hard 'want ORC' is downgraded → not a hard conflict with the approved OFF.
    const folded = foldRequestsForDate(
      [req({ id: "a", kind: "OFF", strength: "hard", status: "approved" }), req({ id: "b", kind: "REQUEST_SHIFT", strength: "hard", status: "pending", shiftTypeIds: ["orc"] })],
      "P", "2026-07-04", () => false, "soft",
    );
    expect(detectRequestConflicts(folded, isWorking, codeOf)).toEqual([]);
  });

  it("no conflicts for a clean single request", () => {
    const folded = foldRequestsForDate([req({ kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["orc"] })], "P", "2026-07-04", () => false, "full");
    expect(detectRequestConflicts(folded, isWorking, codeOf)).toEqual([]);
  });

  it("flags two DISTINCT hard work requests with disjoint options (only one placeable)", () => {
    const folded = foldRequestsForDate(
      [req({ id: "a", kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["orc"] }), req({ id: "b", kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["call"] })],
      "P", "2026-07-04", () => false, "full",
    );
    const msgs = detectRequestConflicts(folded, isWorking, codeOf);
    expect(msgs.some((m) => m.includes("only one can be placed") && m.includes("ORC") && m.includes("CALL"))).toBe(true);
  });

  it("does NOT flag a single OR request listing several work shifts (any one satisfies it)", () => {
    const folded = foldRequestsForDate(
      [req({ id: "a", kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["orc", "call"] })],
      "P", "2026-07-04", () => false, "full",
    );
    expect(detectRequestConflicts(folded, isWorking, codeOf).some((m) => m.includes("only one can be placed"))).toBe(false);
  });

  it("does NOT flag two hard work requests that SHARE a satisfiable shift", () => {
    const folded = foldRequestsForDate(
      [req({ id: "a", kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["orc", "call"] }), req({ id: "b", kind: "REQUEST_SHIFT", strength: "hard", shiftTypeIds: ["call"] })],
      "P", "2026-07-04", () => false, "full",
    );
    // CALL satisfies both → no "only one can be placed" conflict.
    expect(detectRequestConflicts(folded, isWorking, codeOf).some((m) => m.includes("only one can be placed"))).toBe(false);
  });
});
