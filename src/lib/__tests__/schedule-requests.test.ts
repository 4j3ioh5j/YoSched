import { describe, it, expect } from "vitest";
import {
  coversDate,
  requestsForProviderDate,
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
    providerId: p.providerId ?? "P",
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

describe("requestsForProviderDate", () => {
  const reqs = [
    req({ id: "a", providerId: "P", startDate: "2026-07-04" }),
    req({ id: "b", providerId: "Q", startDate: "2026-07-04" }),
    req({ id: "c", providerId: "P", startDate: "2026-07-10" }),
    req({ id: "d", providerId: "P", startDate: "2026-07-04", status: "pending" }),
  ];
  it("returns only approved requests for the provider+date by default", () => {
    const r = requestsForProviderDate(reqs, "P", "2026-07-04");
    expect(r.map((x) => x.id)).toEqual(["a"]); // not b (other provider), c (other date), d (pending)
  });
  it("includes pending requests when asked (grid display)", () => {
    const r = requestsForProviderDate(reqs, "P", "2026-07-04", { includePending: true });
    expect(r.map((x) => x.id).sort()).toEqual(["a", "d"]);
  });

  it("never returns terminal statuses (declined/withdrawn/fulfilled), even with includePending", () => {
    const terminal = [
      req({ id: "x", status: "declined" }),
      req({ id: "y", status: "withdrawn" }),
      req({ id: "z", status: "fulfilled" }),
    ];
    expect(requestsForProviderDate(terminal, "P", "2026-07-04", { includePending: true })).toEqual([]);
    expect(requestsForProviderDate(terminal, "P", "2026-07-04")).toEqual([]);
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
  const base = { providerId: "P", date: "2026-07-04", isOffShift: false, codeOf };

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
    providerId: "P",
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

  it("rejects missing providerId", () => {
    expect(validateRequestInput({ ...ok, providerId: "" })).toEqual({ error: "providerId required" });
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
  it("one target per provider spanning earliest→latest selected date", () => {
    const targets = groupCellsIntoTargets([
      { providerId: "P", date: "2026-07-06" },
      { providerId: "P", date: "2026-07-04" },
      { providerId: "P", date: "2026-07-08" },
      { providerId: "Q", date: "2026-07-05" },
    ]);
    expect(targets).toEqual([
      { providerId: "P", startDate: "2026-07-04", endDate: "2026-07-08" },
      { providerId: "Q", startDate: "2026-07-05", endDate: "2026-07-05" },
    ]);
  });
  it("single cell → single-date target", () => {
    expect(groupCellsIntoTargets([{ providerId: "P", date: "2026-07-04" }])).toEqual([
      { providerId: "P", startDate: "2026-07-04", endDate: "2026-07-04" },
    ]);
  });
});

describe("buildRequestPayloads", () => {
  const target = [{ providerId: "P", startDate: "2026-07-04", endDate: "2026-07-04" }];

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

  it("applies every mark to every target (multi-provider)", () => {
    const out = buildRequestPayloads(
      { shiftMarks: [{ shiftTypeId: "orc", polarity: "negate", strength: "hard" }], offStrength: null, leaveShiftTypeIds: [] },
      [
        { providerId: "P", startDate: "2026-07-04", endDate: "2026-07-04" },
        { providerId: "Q", startDate: "2026-07-05", endDate: "2026-07-06" },
      ]
    );
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.providerId).sort()).toEqual(["P", "Q"]);
    expect(out.find((p) => p.providerId === "Q")).toMatchObject({ startDate: "2026-07-05", endDate: "2026-07-06" });
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
  it("forces providerId and source=provider, ignoring spoofed client values", () => {
    const out = buildSelfRequestInput(
      { providerId: "someone-else", source: "scheduler", startDate: "2026-07-01", kind: "OFF" },
      "me"
    );
    expect("value" in out).toBe(true);
    if ("value" in out) {
      expect(out.value.providerId).toBe("me");
      expect(out.value.source).toBe("provider");
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
    expect(canWithdrawOwnRequest({ providerId: "me", status: "pending" }, "me")).toBe(true);
  });
  it("rejects another provider's request", () => {
    expect(canWithdrawOwnRequest({ providerId: "other", status: "pending" }, "me")).toBe(false);
  });
  it("rejects a non-pending (already approved/declined) request", () => {
    expect(canWithdrawOwnRequest({ providerId: "me", status: "approved" }, "me")).toBe(false);
    expect(canWithdrawOwnRequest({ providerId: "me", status: "declined" }, "me")).toBe(false);
  });
  it("rejects a missing request", () => {
    expect(canWithdrawOwnRequest(null, "me")).toBe(false);
  });
});

describe("summarizeLeaveQueue", () => {
  function lr(o: Partial<LeaveQueueRequest> & { providerId: string; startDate: string; endDate: string }): LeaveQueueRequest {
    return { kind: "LEAVE", status: "approved", receivedAt: "2026-06-01T00:00:00.000Z", ...o };
  }

  it("returns null when nobody else is away in the range", () => {
    const out = summarizeLeaveQueue({
      requests: [lr({ providerId: "me", startDate: "2026-07-03", endDate: "2026-07-03" })],
      providerId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    expect(out).toBeNull();
  });

  it("counts other providers' OFF and LEAVE, not the caller's own", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ providerId: "a", startDate: "2026-07-03", endDate: "2026-07-03", kind: "OFF" }),
        lr({ providerId: "b", startDate: "2026-07-03", endDate: "2026-07-03", kind: "LEAVE" }),
        lr({ providerId: "me", startDate: "2026-07-03", endDate: "2026-07-03" }),
      ],
      providerId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    expect(out?.othersOnPeak).toBe(2);
  });

  it("ignores non-leave kinds and inactive statuses", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ providerId: "a", startDate: "2026-07-03", endDate: "2026-07-03", kind: "NEGATE_SHIFT" }),
        lr({ providerId: "b", startDate: "2026-07-03", endDate: "2026-07-03", status: "declined" }),
        lr({ providerId: "c", startDate: "2026-07-03", endDate: "2026-07-03", status: "withdrawn" }),
      ],
      providerId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    expect(out).toBeNull();
  });

  it("a new request queues last (position = others + 1)", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ providerId: "a", startDate: "2026-07-03", endDate: "2026-07-03" }),
        lr({ providerId: "b", startDate: "2026-07-03", endDate: "2026-07-03" }),
      ],
      providerId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: null,
    });
    expect(out).toEqual({ peakDate: "2026-07-03", othersOnPeak: 2, positionOnPeak: 3 });
  });

  it("an existing request ranks first-come by receivedAt", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ providerId: "a", startDate: "2026-07-03", endDate: "2026-07-03", receivedAt: "2026-06-01T00:00:00.000Z" }),
        lr({ providerId: "b", startDate: "2026-07-03", endDate: "2026-07-03", receivedAt: "2026-06-10T00:00:00.000Z" }),
      ],
      // mine arrived between a and b → I'm #2 of 3
      providerId: "me", start: "2026-07-03", end: "2026-07-03", receivedAtIso: "2026-06-05T00:00:00.000Z",
    });
    expect(out?.positionOnPeak).toBe(2);
    expect(out?.othersOnPeak).toBe(2);
  });

  it("reports the most-contended date across a range", () => {
    const out = summarizeLeaveQueue({
      requests: [
        lr({ providerId: "a", startDate: "2026-07-01", endDate: "2026-07-05" }), // covers whole range
        lr({ providerId: "b", startDate: "2026-07-03", endDate: "2026-07-03" }), // adds to the 3rd
        lr({ providerId: "c", startDate: "2026-07-03", endDate: "2026-07-04" }),
      ],
      providerId: "me", start: "2026-07-01", end: "2026-07-05", receivedAtIso: null,
    });
    // 07-03 has a, b, c = 3 others (the peak)
    expect(out?.peakDate).toBe("2026-07-03");
    expect(out?.othersOnPeak).toBe(3);
  });
});
