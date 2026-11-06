import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db, at } from "@/lib/__tests__/fake-prisma";
import type { ApprovalDecision } from "@/lib/request-approval-outcome";

// Card #67 — the two approval routes over a controllable resolve: an approval that could be
// re-arranged answers approved with its ripple; one that could not answers PENDING + flagged
// (HTTP 200/201, never an error), and the request row carries the flag; a busy/retry is 409.

const ctl = vi.hoisted(() => ({ outcome: null as ApprovalDecision | null, throws: null as unknown }));
const auth = vi.hoisted(() => ({ permissions: ["schedule:edit", "requests:view"] as string[], staffId: null as string | null }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u1" } }, userId: "u1", permissions: auth.permissions, staffId: auth.staffId }) }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));
vi.mock("@/lib/request-sync", () => ({ syncRequestApprovals: async () => [], syncRequestApprovalsAfterCommit: async () => [] }));
vi.mock("@/lib/request-approval-resolve", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/request-approval-resolve")>();
  const { prisma } = await import("@/lib/__tests__/fake-prisma");
  return {
    ApprovalRetry: real.ApprovalRetry,
    paddingDays: real.paddingDays,
    resolveApproval: async (_req: unknown, _placement: string, approverUserId: string | null, finish: (tx: unknown, outcome: ApprovalDecision) => Promise<unknown>) => {
      if (ctl.throws) throw ctl.throws;
      const outcome = ctl.outcome!;
      return prisma.$transaction(async (tx) => {
        if (outcome.ok) {
          for (const w of outcome.writes) {
            if (w.shiftTypeId === null) await tx.assignment.deleteMany({ where: { staffId: w.staffId, date: at(w.date) } });
            else await tx.assignment.upsert({ where: { staffId_date: { staffId: w.staffId, date: at(w.date) } }, update: { shiftTypeId: w.shiftTypeId, source: w.source, updatedBy: approverUserId }, create: { staffId: w.staffId, date: at(w.date), shiftTypeId: w.shiftTypeId, source: w.source, updatedBy: approverUserId } });
          }
        }
        const result = await finish(tx, outcome);
        return { outcome, result, range: { start: "2026-11-08", end: "2026-11-21", pad: 1 } };
      });
    },
  };
});

import { PATCH } from "../[id]/route";
import { PUT as restore } from "../[id]/restore/route";

const MON = "2026-11-09";
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const REASON = "Mon 11/9 already has its 1 ORC (set by hand for CD)";
const OK: ApprovalDecision = {
  ok: true,
  writes: [{ staffId: "s1", date: MON, shiftTypeId: "orc", source: "request" }, { staffId: "s2", date: MON, shiftTypeId: "free", source: "auto" }],
  warnings: ["coverage: Tue 11/10 short 1 OR"],
  ring: 1,
};
const FLAG: ApprovalDecision = { ok: false, reason: REASON };

beforeEach(() => {
  db.reset();
  ctl.outcome = null;
  ctl.throws = null;
  auth.permissions = ["schedule:edit", "requests:view"];
  auth.staffId = null;
  db.shifts = [{ id: "orc", code: "ORC", color: null, isOffShift: false }, { id: "free", code: "OR", color: null, isOffShift: false }, { id: "off", code: "X", color: null, isOffShift: true }];
  db.seedRequest({ id: "r1", staffId: "s1", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"] });
  db.seed([{ staffId: "s2", date: MON, shiftTypeId: "orc", source: "auto" }]);
});

describe("PATCH /api/requests/[id] status=approved", () => {
  it("re-arranged: 200 approved with the ripple, the warnings and the affected window including the other staff's cell", async () => {
    ctl.outcome = OK;
    const res = await PATCH(req({ status: "approved" }), ctx("r1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "r1", status: "approved", flaggedReason: null, ripple: OK.writes, warnings: OK.warnings });
    expect(body.flagged).toBeUndefined();
    expect(body.affected.cells.map((c: { staffId: string; date: string }) => `${c.staffId}:${c.date}`).sort()).toEqual([`s1:${MON}`, `s2:${MON}`]);
    const s2 = body.affected.cells.find((c: { staffId: string }) => c.staffId === "s2");
    expect(s2.assignment.shiftTypeId).toBe("free");
    expect(db.requests[0]).toMatchObject({ status: "approved", autoApproved: true, approvedBy: "u1", flaggedAt: null, flaggedReason: null });
    expect(db.requests[0].approvedAt).toBeInstanceOf(Date);
    expect(db.holders("orc", MON)).toEqual(["s1"]);
  });

  it("impossible: 200 with status pending + flagged + the reason; the row is pending and flagged; nothing placed", async () => {
    ctl.outcome = FLAG;
    const res = await PATCH(req({ status: "approved" }), ctx("r1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "r1", status: "pending", flagged: true, flaggedReason: REASON, approvedAt: null });
    expect(body.ripple).toBeUndefined();
    expect(body.affected.cells).toEqual([{ staffId: "s1", date: MON, assignment: null }]);
    expect(body.affected.requests).toEqual([expect.objectContaining({ id: "r1", status: "pending", flaggedReason: REASON })]);
    expect(db.requests[0]).toMatchObject({ status: "pending", autoApproved: false, approvedAt: null, approvedBy: null, flaggedReason: REASON });
    expect(db.requests[0].flaggedAt).toBeInstanceOf(Date);
    expect(db.holders("orc", MON)).toEqual(["s2"]);
  });

  it("a later approval that works clears the flag", async () => {
    ctl.outcome = FLAG;
    await PATCH(req({ status: "approved" }), ctx("r1"));
    ctl.outcome = OK;
    const res = await PATCH(req({ status: "approved" }), ctx("r1"));
    expect((await res.json()).flaggedReason).toBeNull();
    expect(db.requests[0]).toMatchObject({ status: "approved", flaggedAt: null, flaggedReason: null });
  });

  it("declining or re-opening a flagged request clears the flag too", async () => {
    ctl.outcome = FLAG;
    await PATCH(req({ status: "approved" }), ctx("r1"));
    const res = await PATCH(req({ status: "declined" }), ctx("r1"));
    expect(res.status).toBe(200);
    expect((await res.json()).flaggedReason).toBeNull();
    expect(db.requests[0]).toMatchObject({ status: "declined", flaggedAt: null, flaggedReason: null });
  });

  it("the rule windows changed under the locks (ApprovalRetry) → 409 busy, request untouched", async () => {
    const { ApprovalRetry } = await import("@/lib/request-approval-resolve");
    ctl.throws = new ApprovalRetry();
    const res = await PATCH(req({ status: "approved" }), ctx("r1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "busy" });
    expect(db.requests[0]).toMatchObject({ status: "pending", flaggedReason: null });
  });

  it("a lock wait that outlives the transaction (P2028) → 409 busy", async () => {
    ctl.throws = Object.assign(new Error("Transaction API error"), { code: "P2028" });
    const res = await PATCH(req({ status: "approved" }), ctx("r1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "busy" });
  });

  it("any other failure is not swallowed", async () => {
    ctl.throws = new Error("db down");
    await expect(PATCH(req({ status: "approved" }), ctx("r1"))).rejects.toThrow("db down");
  });

  it("unknown request → 404; bad status → 400", async () => {
    expect((await PATCH(req({ status: "approved" }), ctx("nope"))).status).toBe(404);
    expect((await PATCH(req({ status: "maybe" }), ctx("r1"))).status).toBe(400);
  });
});

describe("the affected window applies the request-visibility rule to the viewer (review #328)", () => {
  const ids = (body: { affected: { requests: { id: string }[] } }) => body.affected.requests.map((r) => r.id).sort();
  beforeEach(() => {
    // The ripple touches s2's Monday; s2 has a hidden PENDING request and a published APPROVED one there.
    db.seedRequest({ id: "r2", staffId: "s2", startDate: MON, endDate: MON, kind: "OFF", flaggedAt: new Date(), flaggedReason: "Mon 11/9 already has its 1 X" });
    db.seedRequest({ id: "r3", staffId: "s2", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["free"], status: "approved" });
    ctl.outcome = OK;
  });

  it("with requests:view every touched request is returned", async () => {
    const body = await (await PATCH(req({ status: "approved" }), ctx("r1"))).json();
    expect(ids(body)).toEqual(["r1", "r2", "r3"]);
  });

  it("without requests:view another staff's PENDING request (and its flagged reason) is withheld; approved ones are not", async () => {
    auth.permissions = ["schedule:edit"];
    const body = await (await PATCH(req({ status: "approved" }), ctx("r1"))).json();
    expect(ids(body)).toEqual(["r1", "r3"]); // r1 is approved by this call; r3 is published; r2 stays hidden
    expect(JSON.stringify(body)).not.toContain("already has its 1 X");
  });

  it("a viewer linked to that staff still sees their own pending request", async () => {
    auth.permissions = ["schedule:edit"];
    auth.staffId = "s2";
    const body = await (await PATCH(req({ status: "approved" }), ctx("r1"))).json();
    expect(ids(body)).toEqual(["r1", "r2", "r3"]);
  });

  it("the flagged (still pending) request itself is withheld from a viewer who may not see pending requests of others", async () => {
    auth.permissions = ["schedule:edit"];
    ctl.outcome = FLAG;
    const body = await (await PATCH(req({ status: "approved" }), ctx("r1"))).json();
    expect(body.flaggedReason).toBe(REASON); // the acted-on request's own result is the response itself
    expect(ids(body)).toEqual([]);
  });

  it("the restore route applies the same rule", async () => {
    auth.permissions = ["schedule:edit"];
    const body = await (await restore(req({ staffId: "s1", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"], status: "approved" }), ctx("r9"))).json();
    expect(ids(body)).toEqual(["r3", "r9"]);
  });

  it("the engine's free-text warnings are withheld too without requests:view (they can name a hidden pending request), on both routes", async () => {
    ctl.outcome = { ...OK, warnings: ["request: CD's pending OFF on Mon 11/9 conflicts with ORC", "coverage: Tue 11/10 short 1 OR"] };
    auth.permissions = ["schedule:edit"];
    const patched = await (await PATCH(req({ status: "approved" }), ctx("r1"))).json();
    expect(patched.warnings).toEqual([]);
    expect(JSON.stringify(patched)).not.toContain("pending OFF");
    const restored = await (await restore(req({ staffId: "s1", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"], status: "approved" }), ctx("r9"))).json();
    expect(restored.warnings).toEqual([]);
    expect(JSON.stringify(restored)).not.toContain("pending OFF");
    // The ripple itself (cells) is still reported: it is the saved grid, not request data.
    expect(patched.ripple).toEqual(OK.writes);
  });

  it("with requests:view the warnings come through unchanged", async () => {
    ctl.outcome = { ...OK, warnings: ["request: CD's pending OFF on Mon 11/9 conflicts with ORC"] };
    const patched = await (await PATCH(req({ status: "approved" }), ctx("r1"))).json();
    expect(patched.warnings).toEqual(["request: CD's pending OFF on Mon 11/9 conflicts with ORC"]);
  });
});

describe("PUT /api/requests/[id]/restore of an approved single-shift request", () => {
  const body = { staffId: "s1", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"], status: "approved", approvedBy: "u1", approvedAt: "2026-11-05T10:00:00.000Z" };

  it("impossible: 201 pending + flagged; the recreated row is pending with the reason, not an approved row with no shift", async () => {
    ctl.outcome = FLAG;
    const res = await restore(req(body), ctx("r9"));
    expect(res.status).toBe(201);
    expect(res.ok).toBe(true); // an old consumer that checks only `r.ok` still treats the undo as done
    const out = await res.json();
    expect(out).toMatchObject({ id: "r9", status: "pending", flagged: true, flaggedReason: REASON });
    expect(out.ripple).toBeUndefined();
    const row = db.requests.find((r) => r.id === "r9")!;
    expect(row).toMatchObject({ status: "pending", autoApproved: false, flaggedReason: REASON });
    expect(row.flaggedAt).toBeInstanceOf(Date);
    expect(db.holders("orc", MON)).toEqual(["s2"]);
  });

  it("re-arranged: 201 approved with the ripple and warnings; the row keeps its original stamp", async () => {
    ctl.outcome = OK;
    const res = await restore(req(body), ctx("r9"));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out).toMatchObject({ id: "r9", status: "approved", ripple: OK.writes, warnings: OK.warnings });
    expect(out.flagged).toBeUndefined();
    expect(out.affected.cells.map((c: { staffId: string }) => c.staffId).sort()).toEqual(["s1", "s2"]);
    const row = db.requests.find((r) => r.id === "r9")!;
    expect(row).toMatchObject({ status: "approved", autoApproved: true, approvedBy: "u1", flaggedAt: null, flaggedReason: null });
    expect(row.approvedAt?.toISOString()).toBe("2026-11-05T10:00:00.000Z");
    expect(db.holders("orc", MON)).toEqual(["s1"]);
  });

  it("busy → 409 and nothing recreated", async () => {
    const { ApprovalRetry } = await import("@/lib/request-approval-resolve");
    ctl.throws = new ApprovalRetry();
    const res = await restore(req(body), ctx("r9"));
    expect(res.status).toBe(409);
    expect(db.requests.find((r) => r.id === "r9")).toBeUndefined();
  });

  it("a pending restore never goes through the resolve", async () => {
    ctl.throws = new Error("must not resolve");
    const res = await restore(req({ ...body, status: "pending" }), ctx("r9"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "r9", status: "pending" });
  });
});
