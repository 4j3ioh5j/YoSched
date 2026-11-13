import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db, ymd } from "@/lib/__tests__/fake-prisma";

// Card #175: approving leave may pin X on some covered days and AL on others. Deleting or
// declining the request releases BOTH — request-placed and unlocked only — and keeps an X
// another approved request still relies on.

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u1" } }, userId: "u1", permissions: ["schedule:edit", "requests:view"], staffId: null }) }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));
vi.mock("@/lib/request-sync", () => ({ syncRequestApprovals: async () => [], syncRequestApprovalsAfterCommit: async () => [] }));

import { DELETE, PATCH } from "../[id]/route";

const MON = "2026-11-09", TUE = "2026-11-10", WED = "2026-11-11", THU = "2026-11-12";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const body = (b: unknown) => ({ json: async () => b }) as unknown as NextRequest;
const left = () => db.rows.filter((r) => r.staffId === "s1").map((r) => `${ymd(r.date)}:${r.shiftTypeId}:${r.source}`).sort();

beforeEach(() => {
  db.reset();
  db.shifts = [{ id: "al", code: "AL", color: null, isOffShift: false }, { id: "off", code: "X", color: null, isOffShift: true }, { id: "or", code: "OR", color: null, isOffShift: false }];
  db.seedRequest({ id: "r1", staffId: "s1", startDate: MON, endDate: THU, kind: "LEAVE", leaveShiftTypeId: "al", status: "approved" });
  db.seed([
    { staffId: "s1", date: MON, shiftTypeId: "al", source: "request" },
    { staffId: "s1", date: TUE, shiftTypeId: "al", source: "request" },
    { staffId: "s1", date: WED, shiftTypeId: "off", source: "request" },
    { staffId: "s1", date: THU, shiftTypeId: "off", source: "manual" }, // typed by hand: never released
  ]);
});

describe("card #175 — releasing a leave request's mixed AL/X cells", () => {
  it("DELETE releases the request-placed AL and X, never a hand-typed X", async () => {
    const res = await DELETE(body({}), ctx("r1"));
    expect(res.status).toBe(200);
    expect(left()).toEqual([`${THU}:off:manual`]);
  });

  it("decline releases them too", async () => {
    const res = await PATCH(body({ status: "declined" }), ctx("r1"));
    expect(res.status).toBe(200);
    expect(left()).toEqual([`${THU}:off:manual`]);
  });

  it("an X another approved OFF request still claims is kept", async () => {
    db.seedRequest({ id: "r2", staffId: "s1", startDate: WED, endDate: WED, kind: "OFF", status: "approved" });
    await DELETE(body({}), ctx("r1"));
    expect(left()).toEqual([`${WED}:off:request`, `${THU}:off:manual`]);
  });

  it("a locked request-placed X is never released", async () => {
    db.rows.find((r) => ymd(r.date) === WED)!.isLocked = true;
    await DELETE(body({}), ctx("r1"));
    expect(left()).toEqual([`${WED}:off:request`, `${THU}:off:manual`]);
  });
});

describe("card #175 — releasing an OFF that overlaps an approved LEAVE", () => {
  it("deleting the OFF keeps the X the LEAVE still relies on", async () => {
    db.seedRequest({ id: "r2", staffId: "s1", startDate: WED, endDate: WED, kind: "OFF", status: "approved" });
    await DELETE(body({}), ctx("r2"));
    expect(left()).toContain(`${WED}:off:request`);
  });
  it("declining the OFF keeps it too", async () => {
    db.seedRequest({ id: "r2", staffId: "s1", startDate: WED, endDate: WED, kind: "OFF", status: "approved" });
    await PATCH(body({ status: "declined" }), ctx("r2"));
    expect(left()).toContain(`${WED}:off:request`);
  });
});
