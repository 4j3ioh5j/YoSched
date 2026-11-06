import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/lib/__tests__/fake-prisma";

// Card #67 — the "When an approved request lands on a full day" Setting: strict on write, lenient on read.

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u1" } }, userId: "u1", permissions: ["settings:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));

import { PUT } from "../scheduling-preferences/route";
import { parseApprovalConflictPolicy, isApprovalConflictPolicy, APPROVAL_CONFLICT_POLICIES } from "@/lib/schedule-requests";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  db.reset();
  db.prefs = { id: "default", approvalConflictPolicy: "resolve-pp", payPeriodLengthDays: 14 };
});

describe("PUT /api/settings/scheduling-preferences approvalConflictPolicy", () => {
  it("rejects an unknown policy with 400 naming the choices, writing nothing", async () => {
    const res = await PUT(req({ approvalConflictPolicy: "wing-it" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("approvalConflictPolicy must be one of resolve-pp, resolve-day, flag");
    expect(db.prefs?.approvalConflictPolicy).toBe("resolve-pp");
  });

  it("saves a valid policy", async () => {
    const res = await PUT(req({ approvalConflictPolicy: "flag" }));
    expect(res.status).toBe(200);
    expect((await res.json()).approvalConflictPolicy).toBe("flag");
    expect(db.prefs?.approvalConflictPolicy).toBe("flag");
  });

  it("leaves the policy alone when the body does not mention it", async () => {
    const res = await PUT(req({ prefer3DayWeekends: false }));
    expect(res.status).toBe(200);
    expect(db.prefs?.approvalConflictPolicy).toBe("resolve-pp");
  });

  it("creates the row with the policy when none exists yet", async () => {
    db.prefs = null;
    const res = await PUT(req({ approvalConflictPolicy: "resolve-day" }));
    expect(res.status).toBe(200);
    expect(db.prefs).toMatchObject({ id: "default", approvalConflictPolicy: "resolve-day" });
  });
});

describe("the policy helpers", () => {
  it("strict for writes, lenient (default resolve-pp) for reads", () => {
    expect(APPROVAL_CONFLICT_POLICIES).toEqual(["resolve-pp", "resolve-day", "flag"]);
    expect(isApprovalConflictPolicy("flag")).toBe(true);
    expect(isApprovalConflictPolicy("FLAG")).toBe(false);
    expect(isApprovalConflictPolicy(null)).toBe(false);
    expect(parseApprovalConflictPolicy("resolve-day")).toBe("resolve-day");
    expect(parseApprovalConflictPolicy("junk")).toBe("resolve-pp");
    expect(parseApprovalConflictPolicy(undefined)).toBe("resolve-pp");
  });
});
