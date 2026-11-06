import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db, at } from "@/lib/__tests__/fake-prisma";
import type { ApprovalDecision, RippleCell } from "@/lib/request-approval-outcome";

// Card #70, the route wiring: the approval stores the ripple its resolve hands back; only an
// explicit Undo (undoApproval: true, from approved) asks to restore it; every other status
// write clears it; a stale Undo is a 409 "reload"; the response says whether it was restored.
// The transaction itself (locks, compare-and-set, verifier) is src/lib/__tests__/request-unapprove.test.ts.

const ctl = vi.hoisted(() => ({
  ripple: null as RippleCell[] | null,
  calls: [] as { ripple: RippleCell[] | null; storedRipple: unknown; coveredDates: readonly string[] }[],
  restore: null as { restored: boolean; reason: string | null; cells: { staffId: string; date: string }[] } | null,
  stale: false,
}));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u1" } }, userId: "u1", permissions: ["schedule:edit", "requests:view"], staffId: null }) }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));
vi.mock("@/lib/request-sync", () => ({ syncRequestApprovals: async () => [], syncRequestApprovalsAfterCommit: async () => [] }));
vi.mock("@/lib/request-approval-resolve", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/request-approval-resolve")>();
  const { prisma } = await import("@/lib/__tests__/fake-prisma");
  return {
    ApprovalRetry: real.ApprovalRetry,
    resolveApproval: async (_r: unknown, _p: string, _u: string | null, finish: (tx: unknown, o: ApprovalDecision, ripple: RippleCell[] | null) => Promise<unknown>) => {
      const outcome: ApprovalDecision = { ok: true, writes: [{ staffId: "s1", date: "2026-11-09", shiftTypeId: "orc", source: "request" }], warnings: [], ring: 1 };
      return prisma.$transaction(async (tx) => {
        await tx.assignment.upsert({ where: { staffId_date: { staffId: "s1", date: at("2026-11-09") } }, update: { shiftTypeId: "orc", source: "request" }, create: { staffId: "s1", date: at("2026-11-09"), shiftTypeId: "orc", source: "request" } });
        const result = await finish(tx, outcome, ctl.ripple);
        return { outcome, result, range: { start: "2026-11-08", end: "2026-11-21", pad: 1 } };
      });
    },
  };
});
vi.mock("@/lib/request-unapprove", async () => {
  const { prisma } = await import("@/lib/__tests__/fake-prisma");
  class RippleStale extends Error {}
  return {
    RippleStale,
    unapproveUnderLocks: async (o: { ripple: RippleCell[] | null; storedRipple: unknown; coveredDates: readonly string[]; release: (tx: unknown) => Promise<void>; setStatus: (tx: unknown) => Promise<unknown> }) => {
      ctl.calls.push({ ripple: o.ripple, storedRipple: o.storedRipple, coveredDates: o.coveredDates });
      if (ctl.stale) throw new RippleStale();
      const updated = await prisma.$transaction(async (tx) => {
        const u = await o.setStatus(tx);
        await o.release(tx); // the stub does not model the restore (request-unapprove.test.ts does)
        return u;
      });
      return { updated, ripple: o.ripple && o.ripple.length ? ctl.restore : null };
    },
  };
});

import { PATCH } from "../[id]/route";

const MON = "2026-11-09";
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const RIPPLE: RippleCell[] = [{ staffId: "s2", date: MON, before: { shiftTypeId: "orc", source: "auto", autoMonth: "2026-11" }, after: { shiftTypeId: "free", source: "auto" } }];
const isNull = (v: unknown) => v === null || v === undefined || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) || String(v) === "DbNull";

beforeEach(() => {
  db.reset();
  ctl.ripple = RIPPLE;
  ctl.calls = [];
  ctl.restore = { restored: true, reason: null, cells: [{ staffId: "s2", date: MON }] };
  ctl.stale = false;
  db.shifts = [{ id: "orc", code: "ORC", color: null, isOffShift: false }, { id: "free", code: "OR", color: null, isOffShift: false }, { id: "off", code: "X", color: null, isOffShift: true }];
  db.seedRequest({ id: "r1", staffId: "s1", startDate: MON, endDate: MON, kind: "REQUEST_SHIFT", shiftTypeIds: ["orc"] });
});

describe("card #70 — PATCH /api/requests/[id] and the approval's ripple", () => {
  it("an approval stores the ripple its resolve hands back, in the same row update", async () => {
    await PATCH(req({ status: "approved" }), ctx("r1"));
    expect(db.requests[0]).toMatchObject({ status: "approved", approvalRipple: RIPPLE });
  });

  it("an approval with no ripple stores none", async () => {
    ctl.ripple = null;
    await PATCH(req({ status: "approved" }), ctx("r1"));
    expect(isNull(db.requests[0].approvalRipple)).toBe(true);
  });

  it("Undo (undoApproval: true) from approved hands the stored ripple to the locked transaction and reports the outcome", async () => {
    await PATCH(req({ status: "approved" }), ctx("r1"));
    const res = await PATCH(req({ status: "pending", undoApproval: true }), ctx("r1"));
    expect(res.status).toBe(200);
    expect(ctl.calls).toEqual([{ ripple: RIPPLE, storedRipple: RIPPLE, coveredDates: [MON] }]);
    const body = await res.json();
    expect(body).toMatchObject({ status: "pending", rippleRestored: true, rippleReason: null });
    expect(isNull(db.requests[0].approvalRipple)).toBe(true); // cleared with the un-approval
    // (the restore itself, own cell included, is the lib's job: request-unapprove.test.ts)
  });

  it("a refused restore still un-approves and says why", async () => {
    await PATCH(req({ status: "approved" }), ctx("r1"));
    ctl.restore = { restored: false, reason: "CD's Mon 11/9 was changed after the approval, so the other staff were left as they are", cells: [{ staffId: "s2", date: MON }] };
    const body = await (await PATCH(req({ status: "pending", undoApproval: true }), ctx("r1"))).json();
    expect(body).toMatchObject({ status: "pending", rippleRestored: false, rippleReason: ctl.restore.reason });
  });

  it("a plain reset / decline (no undoApproval) never restores, and clears the stored ripple", async () => {
    await PATCH(req({ status: "approved" }), ctx("r1"));
    const body = await (await PATCH(req({ status: "declined" }), ctx("r1"))).json();
    expect(ctl.calls).toEqual([{ ripple: null, storedRipple: RIPPLE, coveredDates: [MON] }]);
    expect(body.rippleRestored).toBeUndefined();
    expect(isNull(db.requests[0].approvalRipple)).toBe(true);
  });

  it("undoApproval on a request that is not approved restores nothing", async () => {
    db.requests[0].approvalRipple = RIPPLE; // pending with a leftover value: never trusted
    await PATCH(req({ status: "declined", undoApproval: true }), ctx("r1"));
    expect(ctl.calls[0].ripple).toBeNull();
  });

  it("a malformed stored ripple is treated as nothing to restore", async () => {
    await PATCH(req({ status: "approved" }), ctx("r1"));
    db.requests[0].approvalRipple = [{ staffId: "s2" }];
    await PATCH(req({ status: "pending", undoApproval: true }), ctx("r1"));
    expect(ctl.calls[0].ripple).toBeNull();
  });

  it("a stale Undo is a 409 reload, and the request stays approved", async () => {
    await PATCH(req({ status: "approved" }), ctx("r1"));
    ctl.stale = true;
    const res = await PATCH(req({ status: "pending", undoApproval: true }), ctx("r1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "stale" });
    expect(db.requests[0].status).toBe("approved");
  });

  it("fulfilled clears the stored ripple too", async () => {
    await PATCH(req({ status: "approved" }), ctx("r1"));
    await PATCH(req({ status: "fulfilled" }), ctx("r1"));
    expect(isNull(db.requests[0].approvalRipple)).toBe(true);
  });
});
